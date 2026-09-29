const pool = require("../config/db");
const { ensureSchema } = require("../database/ensure");
const { ensureMasterFields, findMasterField } = require("../constants/masterFields");
const { notifyLeadership } = require("./notificationController");

function parseDate(value, label) {
  if (value == null || String(value).trim() === "") return "";
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { error: `${label} must be YYYY-MM-DD` };
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return { error: `${label} must be YYYY-MM-DD` };
  return text;
}

async function writeTrackedValue(client, recordId, field, nextValue, userId) {
  const stored = nextValue == null ? "" : String(nextValue);
  const currentResult = await client.query(
    `
    SELECT id, value
    FROM record_values
    WHERE record_id = $1 AND field_id = $2
    `,
    [recordId, field.id]
  );
  const current = currentResult.rows[0] || null;
  const previous = current && current.value != null && current.value !== "" ? String(current.value) : null;
  if ((previous ?? "") === stored) {
    return field.field_key;
  }

  if (current) {
    await client.query(
      `
      UPDATE record_values
      SET value = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      `,
      [stored, userId, current.id]
    );
  } else {
    await client.query(
      `
      INSERT INTO record_values (record_id, field_id, value, updated_by)
      VALUES ($1, $2, $3, $4)
      `,
      [recordId, field.id, stored, userId]
    );
  }

  await client.query(
    `
    INSERT INTO audit_logs (record_id, field_id, changed_by, old_value, new_value, changed_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    `,
    [recordId, field.id, userId, previous, stored === "" ? null : stored]
  );
  return field.field_key;
}

async function loadWorkflowContext(client, datasetId, recordId, userId) {
  const datasetResult = await client.query(
    "SELECT id FROM datasets WHERE id = $1 AND is_deleted = FALSE",
    [datasetId]
  );
  if (!datasetResult.rows.length) return { error: { status: 404, message: "Dataset not found" } };

  const recordResult = await client.query(
    "SELECT id FROM records WHERE id = $1 AND dataset_id = $2 AND is_deleted = FALSE",
    [recordId, datasetId]
  );
  if (!recordResult.rows.length) return { error: { status: 404, message: "Record not found" } };

  await ensureMasterFields(client, datasetId);
  const fieldsResult = await client.query(
    `
    SELECT id, name, field_key, field_type, is_deleted
    FROM fields
    WHERE dataset_id = $1 AND is_deleted = FALSE
    `,
    [datasetId]
  );
  const actorResult = await client.query("SELECT name, email FROM users WHERE id = $1", [userId]);
  const actor = actorResult.rows[0];
  const actorName = String(actor?.name || actor?.email || "").trim();
  if (!actorName) return { error: { status: 401, message: "Authentication required" } };

  const clock = await client.query(
    "SELECT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS') AS stamp, TO_CHAR(NOW(), 'YYYY-MM-DD') AS day"
  );

  return {
    fields: fieldsResult.rows,
    actorName,
    stamp: clock.rows[0].stamp,
    day: clock.rows[0].day,
  };
}

async function applyChanges(res, datasetId, recordId, userId, changes) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const context = await loadWorkflowContext(client, datasetId, recordId, userId);
    if (context.error) {
      await client.query("ROLLBACK");
      return res.status(context.error.status).json({ error: context.error.message });
    }

    const values = {};
    for (const change of changes(context)) {
      const field = findMasterField(context.fields, change.name);
      if (!field) {
        await client.query("ROLLBACK");
        return res.status(500).json({ error: `Column ${change.name} is not available` });
      }
      await writeTrackedValue(client, recordId, field, change.value, userId);
      values[field.field_key] = change.value == null ? "" : String(change.value);
    }

    await client.query(
      `
      UPDATE records
      SET updated_by = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      `,
      [userId, recordId]
    );
    await client.query(
      `
      UPDATE datasets
      SET updated_by = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      `,
      [userId, datasetId]
    );
    await client.query("COMMIT");
    return res.json({ success: true, values });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback error:", rollbackError);
    }
    console.error("Workflow update error:", error);
    return res.status(500).json({ error: "Unable to update this record" });
  } finally {
    client.release();
  }
}

function ids(req) {
  const datasetId = Number(req.params.id);
  const recordId = Number(req.params.recordId);
  const userId = Number(req.user?.id);
  if (!Number.isInteger(datasetId) || datasetId <= 0 || !Number.isInteger(recordId) || recordId <= 0) {
    return { error: { status: 400, message: "Invalid record id" } };
  }
  if (!Number.isInteger(userId) || userId <= 0) {
    return { error: { status: 401, message: "Authentication required" } };
  }
  return { datasetId, recordId, userId };
}

const validateRecord = async (req, res) => {
  const parsed = ids(req);
  if (parsed.error) return res.status(parsed.error.status).json({ error: parsed.error.message });
  const flag = String(req.body?.isValidated ?? "").trim().toLowerCase();
  const yes = flag === "yes" || req.body?.isValidated === true;
  const no = flag === "no" || req.body?.isValidated === false;
  if (!yes && !no) {
    return res.status(400).json({ error: "isValidated must be Yes or No" });
  }
  const rejectionReason = String(req.body?.rejectionReason ?? req.body?.remarks ?? "").trim();
  const expected = req.body?.expectedValidationDate;
  if (expected != null && expected !== "" && typeof parseDate(expected, "expectedValidationDate") === "object") {
    return res.status(400).json({ error: parseDate(expected, "expectedValidationDate").error });
  }
  await ensureSchema();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const context = await loadWorkflowContext(client, parsed.datasetId, parsed.recordId, parsed.userId);
    if (context.error) {
      await client.query("ROLLBACK");
      return res.status(context.error.status).json({ error: context.error.message });
    }
    const changes = yes
      ? [
          { name: "Validated (Yes/No)", value: "Yes" },
          { name: "Validated by", value: context.actorName },
          { name: "Validation Date", value: context.stamp },
        ]
      : [
          { name: "Validated (Yes/No)", value: "No" },
          { name: "Reason for Rejection", value: rejectionReason },
          { name: "By when Data will be validated", value: expected ? String(expected).slice(0, 10) : "" },
        ];
    const values = {};
    for (const change of changes) {
      const field = findMasterField(context.fields, change.name);
      if (!field) {
        await client.query("ROLLBACK");
        return res.status(500).json({ error: `Column ${change.name} is not available` });
      }
      await writeTrackedValue(client, parsed.recordId, field, change.value, parsed.userId);
      values[field.field_key] = change.value == null ? "" : String(change.value);
    }
    await notifyLeadership(client, {
      message: `${context.actorName} marked a record ${yes ? "validated" : "not validated"}`,
      datasetId: parsed.datasetId,
      recordId: parsed.recordId,
      actorId: parsed.userId,
    });
    await client.query(
      "UPDATE records SET updated_by = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [parsed.userId, parsed.recordId]
    );
    await client.query("COMMIT");
    return res.json({ success: true, values });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback error:", rollbackError);
    }
    console.error("Validate record error:", error);
    return res.status(500).json({ error: "Unable to validate this record" });
  } finally {
    client.release();
  }
};

const verifyRecord = async (req, res) => {
  const parsed = ids(req);
  if (parsed.error) return res.status(parsed.error.status).json({ error: parsed.error.message });
  await ensureSchema();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const context = await loadWorkflowContext(client, parsed.datasetId, parsed.recordId, parsed.userId);
    if (context.error) {
      await client.query("ROLLBACK");
      return res.status(context.error.status).json({ error: context.error.message });
    }
    const validatedField = findMasterField(context.fields, "Validated");
    const current = validatedField
      ? await client.query(
          "SELECT value FROM record_values WHERE record_id = $1 AND field_id = $2",
          [parsed.recordId, validatedField.id]
        )
      : { rows: [] };
    const validated = String(current.rows[0]?.value || "").trim().toLowerCase();
    if (validated !== "yes" && validated !== "true") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Validate this record before it can be verified" });
    }

    const changes = [
      { name: "Verification Status", value: "Verified OK" },
      { name: "Verified By", value: context.actorName },
      { name: "Verified Date", value: context.stamp },
    ];
    const values = {};
    for (const change of changes) {
      const field = findMasterField(context.fields, change.name);
      if (!field) {
        await client.query("ROLLBACK");
        return res.status(500).json({ error: `Column ${change.name} is not available` });
      }
      await writeTrackedValue(client, parsed.recordId, field, change.value, parsed.userId);
      values[field.field_key] = change.value;
    }
    await client.query(
      "UPDATE records SET updated_by = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [parsed.userId, parsed.recordId]
    );
    await client.query(
      "UPDATE datasets SET updated_by = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [parsed.userId, parsed.datasetId]
    );
    await client.query("COMMIT");
    return res.json({ success: true, values });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback error:", rollbackError);
    }
    console.error("Verify record error:", error);
    return res.status(500).json({ error: "Unable to verify this record" });
  } finally {
    client.release();
  }
};

const updateProposal = async (req, res) => {
  const parsed = ids(req);
  if (parsed.error) return res.status(parsed.error.status).json({ error: parsed.error.message });
  const body = req.body || {};
  const keys = ["proposalSent", "proposalSentDate", "proposalAcknowledged", "acknowledgedBy", "followUpDate"];
  if (!keys.some((key) => Object.prototype.hasOwnProperty.call(body, key))) {
    return res.status(400).json({ error: "Proposal update is empty" });
  }
  if (body.proposalSent != null && body.proposalSent !== "" && !["Yes", "No", "NA"].includes(body.proposalSent)) {
    return res.status(400).json({ error: "proposalSent must be Yes, No, or NA" });
  }
  if (body.proposalAcknowledged != null && body.proposalAcknowledged !== "" && !["Yes", "No"].includes(body.proposalAcknowledged)) {
    return res.status(400).json({ error: "proposalAcknowledged must be Yes or No" });
  }
  const sentDate = Object.prototype.hasOwnProperty.call(body, "proposalSentDate")
    ? parseDate(body.proposalSentDate, "proposalSentDate")
    : undefined;
  if (sentDate && typeof sentDate === "object") return res.status(400).json({ error: sentDate.error });
  const followUp = Object.prototype.hasOwnProperty.call(body, "followUpDate")
    ? parseDate(body.followUpDate, "followUpDate")
    : undefined;
  if (followUp && typeof followUp === "object") return res.status(400).json({ error: followUp.error });

  await ensureSchema();
  return applyChanges(res, parsed.datasetId, parsed.recordId, parsed.userId, (context) => {
    const changes = [];
    if (Object.prototype.hasOwnProperty.call(body, "proposalSent")) {
      changes.push({ name: "Proposal Sent", value: body.proposalSent || "" });
      if (body.proposalSent === "Yes" && sentDate === undefined) {
        changes.push({ name: "Proposal Sent Date", value: context.day });
      }
    }
    if (sentDate !== undefined) changes.push({ name: "Proposal Sent Date", value: sentDate });
    if (Object.prototype.hasOwnProperty.call(body, "proposalAcknowledged")) {
      changes.push({ name: "Proposal Acknowledged", value: body.proposalAcknowledged || "" });
    }
    if (Object.prototype.hasOwnProperty.call(body, "acknowledgedBy")) {
      changes.push({ name: "Acknowledged By", value: String(body.acknowledgedBy ?? "").trim() });
    }
    if (followUp !== undefined) changes.push({ name: "Follow-up Date", value: followUp });
    return changes;
  });
};

module.exports = {
  validateRecord,
  verifyRecord,
  updateProposal,
};
