const pool = require("../config/db");
const { hasPermission, normalizeRole } = require("../../../shared/permissions");
const { ensureSchema } = require("../database/ensure");
const { logActivity, presentActivity } = require("../sheet/activityLog");
const { notifySheetEvent } = require("./notificationController");
const { readySchema } = require("../sheet/prepareSheet");
const { resolveSchema } = require("../sheet/resolveSchema");
const {
  appTimeZone,
  columnBySemantic,
  dateOnly,
  effectiveAmc,
  overlayData,
  readSemantic,
  summarize,
  todayISO,
  yesNo,
} = require("../sheet/rowRules");

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function loadDataset(datasetId) {
  const result = await pool.query(
    `
    SELECT id, name, description, source_file_name, row_count, column_count, schema,
           created_by, created_at, updated_at, is_deleted
    FROM datasets
    WHERE id = $1 AND is_deleted = FALSE
    `,
    [datasetId]
  );
  return result.rows[0] || null;
}

async function loadStoredRows(datasetId) {
  const result = await pool.query(
    `
    SELECT id, position, data
    FROM records
    WHERE dataset_id = $1 AND is_deleted = FALSE
    ORDER BY position ASC NULLS LAST, id ASC
    `,
    [datasetId]
  );
  return result.rows.map((row, index) => ({
    id: row.id,
    position: row.position == null ? index : row.position,
    data: row.data && typeof row.data === "object" ? row.data : {},
  }));
}

function assign(data, column, value) {
  if (!column) return;
  if (value == null || value === "") delete data[column.key];
  else data[column.key] = value;
}

function actor(req) {
  return {
    id: Number(req.user?.id) || null,
    name: req.user?.name || "User",
  };
}

async function saveRow(client, rowId, data, userId) {
  const updated = await client.query(
    `
    UPDATE records
    SET data = $1::jsonb, updated_by = $2, updated_at = CURRENT_TIMESTAMP
    WHERE id = $3
    RETURNING id, position, data
    `,
    [JSON.stringify(data), userId, rowId]
  );
  return updated.rows[0];
}

const getSummary = async (req, res) => {
  try {
    await ensureSchema();
    const dataset = await loadDataset(Number(req.params.id));
    if (!dataset) return res.status(404).json({ error: "Dataset not found" });
    const schema = await readySchema(dataset, resolveSchema);
    const today = todayISO();
    const rows = await loadStoredRows(dataset.id);
    res.json({ counts: summarize(rows.map((row) => row.data), schema, today), timezone: appTimeZone() });
  } catch (error) {
    console.error("Sheet summary error:", error);
    res.status(500).json({ error: "Unable to load sheet summary." });
  }
};

const getRowActivity = async (req, res) => {
  try {
    await ensureSchema();
    const dataset = await loadDataset(Number(req.params.id));
    if (!dataset) return res.status(404).json({ error: "Dataset not found" });
    const row = await pool.query(
      "SELECT id FROM records WHERE id = $1 AND dataset_id = $2 AND is_deleted = FALSE",
      [Number(req.params.rowId), dataset.id]
    );
    if (!row.rows.length) return res.status(404).json({ error: "Row not found" });
    const result = await pool.query(
      `
      SELECT id, dataset_id, row_id, actor_id, actor_name, action, column_key, from_value, to_value, at
      FROM activity_log
      WHERE dataset_id = $1 AND row_id = $2
      ORDER BY at DESC, id DESC
      LIMIT 200
      `,
      [dataset.id, Number(req.params.rowId)]
    );
    res.json({ activity: result.rows.map(presentActivity), timezone: appTimeZone() });
  } catch (error) {
    console.error("Activity log error:", error);
    res.status(500).json({ error: "Unable to load activity." });
  }
};

const validateRow = async (req, res) => {
  const result = req.body?.result;
  const person = actor(req);
  try {
    await ensureSchema();
    const dataset = await loadDataset(Number(req.params.id));
    if (!dataset) return res.status(404).json({ error: "Dataset not found" });
    const schema = await readySchema(dataset, resolveSchema);
    const today = todayISO();
    const rowResult = await pool.query(
      "SELECT id, position, data FROM records WHERE id = $1 AND dataset_id = $2 AND is_deleted = FALSE",
      [Number(req.params.rowId), dataset.id]
    );
    if (!rowResult.rows.length) return res.status(404).json({ error: "Row not found" });
    const stored = { ...(rowResult.rows[0].data || {}) };
    const validated = columnBySemantic(schema, "validated");
    if (!validated) return res.status(409).json({ error: "This sheet has no Validated column." });
    const previous = yesNo(stored[validated.key]);
    const clearing = result === "";
    if (clearing) {
      if (!hasPermission(req.user?.role, "canClearValidation")) {
        return res.status(403).json({
          error: "You cannot clear validation",
          code: "FORBIDDEN",
          requiredPermission: "canClearValidation",
        });
      }
      assign(stored, validated, "");
      assign(stored, columnBySemantic(schema, "validated_by"), "");
      assign(stored, columnBySemantic(schema, "validated_at"), "");
      assign(stored, columnBySemantic(schema, "rejection_reason"), "");
      assign(stored, columnBySemantic(schema, "validation_due"), "");
    } else if (result === "Yes") {
      assign(stored, validated, "Yes");
      assign(stored, columnBySemantic(schema, "validated_by"), person.name);
      assign(stored, columnBySemantic(schema, "validated_at"), new Date().toISOString());
      assign(stored, columnBySemantic(schema, "rejection_reason"), "");
      assign(stored, columnBySemantic(schema, "validation_due"), "");
    } else if (result === "No") {
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      const expectedDate = dateOnly(req.body?.expectedDate);
      if (reason.length < 5) return res.status(400).json({ error: "A reason of at least 5 characters is required." });
      if (!expectedDate || expectedDate < today) return res.status(400).json({ error: "Choose today or a later date." });
      assign(stored, validated, "No");
      assign(stored, columnBySemantic(schema, "validated_by"), person.name);
      assign(stored, columnBySemantic(schema, "validated_at"), new Date().toISOString());
      assign(stored, columnBySemantic(schema, "rejection_reason"), reason);
      assign(stored, columnBySemantic(schema, "validation_due"), expectedDate);
    } else {
      return res.status(400).json({ error: "result must be Yes, No, or blank." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const saved = await saveRow(client, rowResult.rows[0].id, stored, person.id);
      await logActivity(client, {
        datasetId: dataset.id,
        rowId: saved.id,
        actorId: person.id,
        actorName: person.name,
        action: "validation",
        columnKey: validated.key,
        fromValue: previous,
        toValue: clearing ? "" : result,
      });
      await client.query("COMMIT");
      if ((result === "Yes" || result === "No") && normalizeRole(req.user?.role) === "validator") {
        const customer = readSemantic(saved.data, schema, "customer_name") || "a customer";
        const detail = result === "No" ? `No (${String(req.body?.reason || "").trim()})` : "Yes";
        notifySheetEvent({
          actorId: person.id,
          actorName: person.name,
          datasetId: dataset.id,
          rowId: saved.id,
          customerName: customer,
          type: "validation",
          summary: `${person.name} marked validation ${detail} on ${customer}`,
        }).catch((error) => console.error("Notification error:", error));
      }
      res.json({
        row: {
          id: saved.id,
          position: saved.position,
          data: overlayData(saved.data, schema, today),
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const status = error.status || 500;
    console.error("Validate row error:", error);
    res.status(status).json({ error: status === 500 ? "Unable to save validation." : error.message });
  }
};

const verifyRow = async (req, res) => {
  const verified = req.body?.verified;
  const person = actor(req);
  if (typeof verified !== "boolean") return res.status(400).json({ error: "verified must be true or false." });
  try {
    await ensureSchema();
    const dataset = await loadDataset(Number(req.params.id));
    if (!dataset) return res.status(404).json({ error: "Dataset not found" });
    const schema = await readySchema(dataset, resolveSchema);
    const today = todayISO();
    const rowResult = await pool.query(
      "SELECT id, position, data FROM records WHERE id = $1 AND dataset_id = $2 AND is_deleted = FALSE",
      [Number(req.params.rowId), dataset.id]
    );
    if (!rowResult.rows.length) return res.status(404).json({ error: "Row not found" });
    const stored = { ...(rowResult.rows[0].data || {}) };
    const validatedColumn = columnBySemantic(schema, "validated");
    if (yesNo(readSemantic(stored, schema, "validated")) !== "Yes") {
      return res.status(409).json({ error: "Verification is available after validation is Yes." });
    }
    const verifiedColumn = columnBySemantic(schema, "verified");
    if (!verifiedColumn) throw fail(409, "This sheet has no Verified column.");
    const previous = String(stored[verifiedColumn.key] || "");
    if (verified) {
      assign(stored, verifiedColumn, "Verified OK");
      assign(stored, columnBySemantic(schema, "verified_by"), person.name);
      assign(stored, columnBySemantic(schema, "verified_at"), new Date().toISOString());
    } else {
      assign(stored, verifiedColumn, "Pending");
      assign(stored, columnBySemantic(schema, "verified_by"), "");
      assign(stored, columnBySemantic(schema, "verified_at"), "");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const saved = await saveRow(client, rowResult.rows[0].id, stored, person.id);
      await logActivity(client, {
        datasetId: dataset.id,
        rowId: saved.id,
        actorId: person.id,
        actorName: person.name,
        action: "verification",
        columnKey: verifiedColumn.key,
        fromValue: previous,
        toValue: stored[verifiedColumn.key],
      });
      await client.query("COMMIT");
      res.json({
        row: { id: saved.id, position: saved.position, data: overlayData(saved.data, schema, today) },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const status = error.status || 500;
    console.error("Verify row error:", error);
    res.status(status).json({ error: status === 500 ? "Unable to save verification." : error.message });
  }
};

const updateAmc = async (req, res) => {
  const action = req.body?.action;
  const person = actor(req);
  const allowed = new Set(["proposal_sent", "acknowledge", "decline", "reset"]);
  if (!allowed.has(action)) return res.status(400).json({ error: "Unknown AMC action." });
  if (action === "reset" && !hasPermission(req.user?.role, "canResetAmc")) {
    return res.status(403).json({
      error: "You cannot reset AMC status",
      code: "FORBIDDEN",
      requiredPermission: "canResetAmc",
    });
  }
  try {
    await ensureSchema();
    const dataset = await loadDataset(Number(req.params.id));
    if (!dataset) return res.status(404).json({ error: "Dataset not found" });
    const schema = await readySchema(dataset, resolveSchema);
    const today = todayISO();
    const rowResult = await pool.query(
      "SELECT id, position, data FROM records WHERE id = $1 AND dataset_id = $2 AND is_deleted = FALSE",
      [Number(req.params.rowId), dataset.id]
    );
    if (!rowResult.rows.length) return res.status(404).json({ error: "Row not found" });
    const stored = { ...(rowResult.rows[0].data || {}) };
    const current = effectiveAmc(stored, schema, today);
    const statusColumn = columnBySemantic(schema, "amc_status");
    if (!statusColumn) throw fail(409, "This sheet has no AMC Status column.");
    if (action === "proposal_sent" && current !== "AMC Due") {
      return res.status(409).json({ error: "A proposal can only be sent when AMC is due." });
    }
    if ((action === "acknowledge" || action === "decline") && current !== "Proposal Sent") {
      return res.status(409).json({ error: "Record the response only after a proposal is sent." });
    }
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    const date = dateOnly(req.body?.date) || today;
    if (action === "proposal_sent") {
      assign(stored, statusColumn, "Proposal Sent");
      assign(stored, columnBySemantic(schema, "proposal_sent_at"), date);
    } else if (action === "acknowledge" || action === "decline") {
      const next = action === "acknowledge" ? "Acknowledged" : "Declined";
      assign(stored, statusColumn, next);
      assign(stored, columnBySemantic(schema, "ack_response"), next);
      assign(stored, columnBySemantic(schema, "ack_note"), note);
      assign(stored, columnBySemantic(schema, "ack_at"), new Date().toISOString());
    } else {
      assign(stored, statusColumn, "");
      assign(stored, columnBySemantic(schema, "proposal_sent_at"), "");
      assign(stored, columnBySemantic(schema, "ack_response"), "");
      assign(stored, columnBySemantic(schema, "ack_note"), "");
      assign(stored, columnBySemantic(schema, "ack_at"), "");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const saved = await saveRow(client, rowResult.rows[0].id, stored, person.id);
      await logActivity(client, {
        datasetId: dataset.id,
        rowId: saved.id,
        actorId: person.id,
        actorName: person.name,
        action: "amc",
        columnKey: statusColumn.key,
        fromValue: current,
        toValue: effectiveAmc(saved.data, schema, today),
      });
      await client.query("COMMIT");
      res.json({
        row: { id: saved.id, position: saved.position, data: overlayData(saved.data, schema, today) },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const status = error.status || 500;
    console.error("AMC action error:", error);
    res.status(status).json({ error: status === 500 ? "Unable to update AMC status." : error.message });
  }
};

module.exports = {
  getSummary,
  getRowActivity,
  validateRow,
  verifyRow,
  updateAmc,
};
