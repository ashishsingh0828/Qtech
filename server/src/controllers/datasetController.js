const pool = require("../config/db");
const { hasPermission } = require("../../../shared/permissions");
const { roleCanEditField, notifiesLeadership } = require("../constants/access");
const { logActivity } = require("../sheet/activityLog");
const { notifyLeadership } = require("./notificationController");
const { ensureSchema } = require("../database/ensure");
const { ensureMasterFields, MASTER_FIELDS } = require("../constants/masterFields");

let archiveColumnReady = null;

function ensureArchiveColumn() {
  if (!archiveColumnReady) {
    archiveColumnReady = pool.query(
      "ALTER TABLE datasets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP"
    );
  }
  return archiveColumnReady;
}

const FIELD_TYPES = new Set(["text", "number", "date", "boolean", "email"]);

function parseAggregatedValues(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? value : {};
}

async function listAccessibleFields(datasetId, user) {
  await ensureSchema();
  const result = await pool.query(
    `
    SELECT
      f.id,
      f.dataset_id,
      f.name,
      f.field_key,
      f.field_type,
      f.position,
      f.is_required,
      f.group_name,
      f.created_at
    FROM fields f
    WHERE f.dataset_id = $1
      AND f.is_deleted = FALSE
    ORDER BY f.position ASC, f.id ASC
    `,
    [datasetId]
  );
  return result.rows.map((field) => ({
    ...field,
    can_view: true,
    can_edit: roleCanEditField(user, field),
  }));
}

function normalizeFieldKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 255);
}

const getDatasets = async (req, res) => {
  const includeDeleted = String(req.query.include_deleted || "").toLowerCase() === "true";

  if (includeDeleted && !hasPermission(req.user?.role, "canDeleteDataset")) {
    return res.status(403).json({
      error: "You do not have permission for this action",
      code: "FORBIDDEN",
      requiredPermission: "canDeleteDataset",
    });
  }

  try {
    await ensureArchiveColumn();

    const result = await pool.query(
      `
      SELECT
        d.id,
        d.name,
        d.description,
        d.created_by,
        creator.name AS created_by_name,
        d.created_at,
        d.updated_at,
        d.is_deleted,
        d.deleted_at,
        d.updated_at AS last_modified_at,
        d.source_file_name,
        d.row_count,
        d.column_count,
        COALESCE(editor.name, creator.name) AS last_modified_by,
        COUNT(DISTINCT f.id)::int AS fields_count,
        COUNT(DISTINCT r.id)::int AS records_count
      FROM datasets d
      LEFT JOIN users creator ON creator.id = d.created_by
      LEFT JOIN users editor ON editor.id = d.updated_by
      LEFT JOIN fields f
        ON f.dataset_id = d.id
       AND f.is_deleted = FALSE
      LEFT JOIN records r
        ON r.dataset_id = d.id
       AND r.is_deleted = FALSE
      WHERE ($1::boolean = TRUE OR d.is_deleted = FALSE)
      GROUP BY d.id, creator.name, editor.name
      ORDER BY d.updated_at DESC, d.id DESC
      `,
      [includeDeleted]
    );

    const statsResult = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM datasets WHERE is_deleted = FALSE) AS total_datasets,
        (
          SELECT COUNT(*)::int
          FROM records rec
          INNER JOIN datasets ds ON ds.id = rec.dataset_id
          WHERE rec.is_deleted = FALSE
            AND ds.is_deleted = FALSE
        ) AS total_records,
        (SELECT COUNT(*)::int FROM users WHERE is_active = TRUE) AS active_users
    `);
    const workflowRows = await pool.query(`
      SELECT
        MAX(rv.value) FILTER (
          WHERE lower(regexp_replace(f.name, '[^a-zA-Z0-9]', '', 'g')) IN ('validated', 'validatedyesno')
        ) AS validated,
        MAX(rv.value) FILTER (
          WHERE lower(regexp_replace(f.name, '[^a-zA-Z0-9]', '', 'g')) = 'bywhendatawillbevalidated'
        ) AS due_on,
        MAX(rv.value) FILTER (
          WHERE lower(regexp_replace(f.name, '[^a-zA-Z0-9]', '', 'g')) = 'verificationstatus'
        ) AS verification,
        MAX(rv.value) FILTER (
          WHERE lower(regexp_replace(f.name, '[^a-zA-Z0-9]', '', 'g')) = 'status'
        ) AS status
      FROM records r
      JOIN datasets d ON d.id = r.dataset_id AND d.is_deleted = FALSE
      LEFT JOIN record_values rv ON rv.record_id = r.id
      LEFT JOIN fields f ON f.id = rv.field_id AND f.is_deleted = FALSE
      WHERE r.is_deleted = FALSE
      GROUP BY r.id
    `);
    const today = new Date().toISOString().slice(0, 10);
    let validationOverdue = 0;
    let pendingVerifications = 0;
    let activeAmcs = 0;
    for (const row of workflowRows.rows) {
      const validated = String(row.validated || "").trim().toLowerCase();
      const isValidated = validated === "yes" || validated === "true";
      const due = String(row.due_on || "").slice(0, 10);
      if (!isValidated && /^\d{4}-\d{2}-\d{2}$/.test(due) && due < today) validationOverdue += 1;
      if (isValidated && String(row.verification || "").trim().toLowerCase() !== "verified ok") pendingVerifications += 1;
      const status = String(row.status || "").trim().toLowerCase();
      if (status === "amc" || status === "in warranty") activeAmcs += 1;
    }

    res.json({
      datasets: result.rows,
      stats: {
        ...statsResult.rows[0],
        total_equipment: statsResult.rows[0]?.total_records ?? 0,
        validation_overdue: validationOverdue,
        pending_verifications: pendingVerifications,
        active_amcs: activeAmcs,
      },
    });
  } catch (error) {
    console.error("Get datasets error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const createDataset = async (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const description =
    typeof req.body.description === "string" ? req.body.description.trim() : "";
  const createdBy = Number(req.body.created_by || req.user?.id);

  if (!name) {
    return res.status(400).json({ error: "Dataset name is required" });
  }

  if (!Number.isInteger(createdBy) || createdBy <= 0) {
    return res.status(400).json({ error: "created_by is required" });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO datasets (name, description, created_by, updated_by)
      VALUES ($1, $2, $3, $3)
      RETURNING id, name, description, created_by, created_at, updated_at
      `,
      [name, description || null, createdBy]
    );

    const creator = await pool.query("SELECT name FROM users WHERE id = $1", [createdBy]);
    await ensureMasterFields(pool, result.rows[0].id);

    res.status(201).json({
      dataset: {
        ...result.rows[0],
        created_by_name: creator.rows[0]?.name || null,
        fields_count: MASTER_FIELDS.length,
        records_count: 0,
      },
    });
  } catch (error) {
    if (error.code === "23503") {
      return res.status(400).json({ error: "created_by user was not found" });
    }

    console.error("Create dataset error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getDataset = async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid dataset id" });
  }

  try {
    const datasetResult = await pool.query(
      `
      SELECT
        d.id,
        d.name,
        d.description,
        d.created_by,
        u.name AS created_by_name,
        d.created_at,
        d.updated_at
      FROM datasets d
      LEFT JOIN users u ON u.id = d.created_by
      WHERE d.id = $1 AND d.is_deleted = FALSE
      `,
      [id]
    );

    if (datasetResult.rows.length === 0) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    await ensureMasterFields(pool, id);
    const fields = await listAccessibleFields(id, req.user);

    res.json({
      dataset: {
        ...datasetResult.rows[0],
        fields,
      },
    });
  } catch (error) {
    console.error("Get dataset error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const addField = async (req, res) => {
  const datasetId = Number(req.params.id);

  if (!Number.isInteger(datasetId) || datasetId <= 0) {
    return res.status(400).json({ error: "Invalid dataset id" });
  }

  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const fieldKey = normalizeFieldKey(req.body.field_key || name);
  const fieldType = String(req.body.field_type || "text").trim().toLowerCase();
  const isRequired = Boolean(req.body.is_required);

  if (!name) {
    return res.status(400).json({ error: "Field name is required" });
  }

  if (!fieldKey) {
    return res.status(400).json({ error: "field_key is required" });
  }

  if (!FIELD_TYPES.has(fieldType)) {
    return res.status(400).json({
      error: "field_type must be text, number, date, boolean, or email",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const datasetResult = await client.query(
      "SELECT id FROM datasets WHERE id = $1 AND is_deleted = FALSE",
      [datasetId]
    );

    if (datasetResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Dataset not found" });
    }

    await ensureSchema();

    const anchorId = Number(req.body.anchor_field_id);
    const placement = req.body.placement === "left" || req.body.placement === "right" ? req.body.placement : null;
    let nextPosition;

    if (placement && Number.isInteger(anchorId) && anchorId > 0) {
      const anchor = await client.query(
        `
        SELECT position
        FROM fields
        WHERE id = $1 AND dataset_id = $2 AND is_deleted = FALSE
        `,
        [anchorId, datasetId]
      );
      if (!anchor.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Column not found" });
      }
      const anchorPosition = Number(anchor.rows[0].position) || 0;
      nextPosition = placement === "left" ? anchorPosition : anchorPosition + 1;
      await client.query(
        `
        UPDATE fields
        SET position = position + 1
        WHERE dataset_id = $1 AND position >= $2
        `,
        [datasetId, nextPosition]
      );
    } else {
      const positionResult = await client.query(
        `
        SELECT COALESCE(MAX(position), -1) + 1 AS next_position
        FROM fields
        WHERE dataset_id = $1
        `,
        [datasetId]
      );
      nextPosition = positionResult.rows[0].next_position;
    }

    const insertResult = await client.query(
      `
      INSERT INTO fields (dataset_id, name, field_key, field_type, position, is_required)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, dataset_id, name, field_key, field_type, position, is_required, created_at
      `,
      [datasetId, name, fieldKey, fieldType, nextPosition, isRequired]
    );

    await client.query(
      `
      UPDATE datasets
      SET updated_at = CURRENT_TIMESTAMP, updated_by = $2
      WHERE id = $1
      `,
      [datasetId, req.user?.id || null]
    );

    await client.query("COMMIT");
    res.status(201).json({ field: insertResult.rows[0] });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback error:", rollbackError);
    }

    if (error.code === "23505") {
      return res.status(409).json({ error: "A field with this key already exists" });
    }

    console.error("Add field error:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
};

function normalizeCellValue(field, raw) {
  if (field.field_type === "boolean") {
    if (raw === true || raw === "true" || raw === "Yes" || raw === "yes") return "true";
    if (raw === false || raw === "false" || raw === "No" || raw === "no") return "false";
    if (raw == null || raw === "") return "";
    return null;
  }

  if (raw == null) return "";

  const value = String(raw).trim();
  if (value === "") return "";

  if (field.field_type === "number") {
    if (!Number.isFinite(Number(value))) return null;
    return value;
  }

  if (field.field_type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    return value;
  }

  if (field.field_type === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
    return value;
  }

  return value;
}

const getRecords = async (req, res) => {
  const datasetId = Number(req.params.id);

  if (!Number.isInteger(datasetId) || datasetId <= 0) {
    return res.status(400).json({ error: "Invalid dataset id" });
  }

  try {
    const datasetResult = await pool.query(
      "SELECT id FROM datasets WHERE id = $1 AND is_deleted = FALSE",
      [datasetId]
    );

    if (datasetResult.rows.length === 0) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    await ensureSchema();

    const recordsResult = await pool.query(
      `
      SELECT
        r.id,
        r.position,
        r.created_at,
        COALESCE(
          json_object_agg(f.field_key, rv.value) FILTER (WHERE f.field_key IS NOT NULL),
          '{}'::json
        ) AS values
      FROM records r
      LEFT JOIN record_values rv ON rv.record_id = r.id
      LEFT JOIN fields f
        ON f.id = rv.field_id
       AND f.is_deleted = FALSE
      WHERE r.dataset_id = $1
        AND r.is_deleted = FALSE
      GROUP BY r.id, r.position, r.created_at
      ORDER BY r.position ASC NULLS LAST, r.created_at ASC, r.id ASC
      `,
      [datasetId]
    );

    res.json({
      records: recordsResult.rows.map((record) => ({
        id: record.id,
        position: record.position,
        created_at: record.created_at,
        values: parseAggregatedValues(record.values),
      })),
    });
  } catch (error) {
    console.error("Get records error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const createRecord = async (req, res) => {
  const datasetId = Number(req.params.id);
  const createdBy = Number(req.user?.id);
  const rawValues = req.body?.values;
  const allowBlank = req.body?.blank === true;

  if (!Number.isInteger(datasetId) || datasetId <= 0) {
    return res.status(400).json({ error: "Invalid dataset id" });
  }

  if (!Number.isInteger(createdBy) || createdBy <= 0) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (!rawValues || typeof rawValues !== "object" || Array.isArray(rawValues)) {
    return res.status(400).json({ error: "values object is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const datasetResult = await client.query(
      "SELECT id FROM datasets WHERE id = $1 AND is_deleted = FALSE",
      [datasetId]
    );

    if (datasetResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Dataset not found" });
    }

    await ensureSchema();

    const fieldsResult = await client.query(
      `
      SELECT id, name, field_key, field_type, is_required
      FROM fields
      WHERE dataset_id = $1 AND is_deleted = FALSE
      ORDER BY position ASC, id ASC
      `,
      [datasetId]
    );

    if (fieldsResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Add columns before creating rows" });
    }

    const unknown = [];
    const blocked = [];
    for (const key of Object.keys(rawValues)) {
      const field = fieldsResult.rows.find((entry) => entry.field_key === key);
      if (!field) {
        unknown.push(key);
        continue;
      }
      if (!roleCanEditField(req.user, field)) blocked.push(key);
    }
    if (unknown.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Unknown column", unknownFields: unknown });
    }
    if (blocked.length) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "You do not have permission to edit these fields",
        code: "FORBIDDEN",
        requiredPermission: "canEditColumn",
        blockedFields: blocked,
      });
    }

    const entries = [];

    for (const field of fieldsResult.rows) {
      const hasKey = Object.prototype.hasOwnProperty.call(rawValues, field.field_key);
      const normalized = normalizeCellValue(field, hasKey ? rawValues[field.field_key] : "");

      if (normalized == null) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `${field.name} has an invalid value` });
      }

      if (!allowBlank && field.is_required && field.field_type !== "boolean" && normalized === "") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `${field.name} is required` });
      }

      if (field.field_type === "boolean") {
        if (hasKey || field.is_required) {
          entries.push({ field, value: normalized || "false" });
        }
      } else if (normalized !== "") {
        entries.push({ field, value: normalized });
      }
    }

    const insertRequest = req.body?.insert;
    let position;
    const anchorId = Number(insertRequest?.record_id);
    const placement = insertRequest?.placement === "above" || insertRequest?.placement === "below"
      ? insertRequest.placement
      : null;

    if (placement && Number.isInteger(anchorId) && anchorId > 0) {
      const anchor = await client.query(
        `
        SELECT position
        FROM records
        WHERE id = $1 AND dataset_id = $2 AND is_deleted = FALSE
        `,
        [anchorId, datasetId]
      );
      if (!anchor.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Record not found" });
      }
      const anchorPosition = Number(anchor.rows[0].position) || 0;
      position = placement === "above" ? anchorPosition : anchorPosition + 1;
      await client.query(
        `
        UPDATE records
        SET position = position + 1
        WHERE dataset_id = $1 AND is_deleted = FALSE AND position >= $2
        `,
        [datasetId, position]
      );
    } else {
      const maxResult = await client.query(
        `
        SELECT COALESCE(MAX(position), -1) + 1 AS next_position
        FROM records
        WHERE dataset_id = $1
        `,
        [datasetId]
      );
      position = maxResult.rows[0].next_position;
    }

    const insertRecord = await client.query(
      `
      INSERT INTO records (dataset_id, created_by, updated_by, position)
      VALUES ($1, $2, $2, $3)
      RETURNING id, position, created_at
      `,
      [datasetId, createdBy, position]
    );

    const record = insertRecord.rows[0];
    const values = {};

    for (const entry of entries) {
      await client.query(
        `
        INSERT INTO record_values (record_id, field_id, value, updated_by)
        VALUES ($1, $2, $3, $4)
        `,
        [record.id, entry.field.id, entry.value, createdBy]
      );
      values[entry.field.field_key] = entry.value;
    }

    await client.query(
      `
      UPDATE datasets
      SET updated_at = CURRENT_TIMESTAMP, updated_by = $2
      WHERE id = $1
      `,
      [datasetId, createdBy]
    );

    await client.query("COMMIT");

    res.status(201).json({
      record: {
        id: record.id,
        position: record.position,
        created_at: record.created_at,
        values,
      },
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback error:", rollbackError);
    }

    if (error.code === "23503") {
      return res.status(400).json({ error: "Unable to save this row" });
    }

    console.error("Create record error:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
};

const softDeleteDataset = async (req, res) => {
  const datasetId = Number(req.params.id);
  const actorId = Number(req.user?.id);

  if (!Number.isInteger(datasetId) || datasetId <= 0) {
    return res.status(400).json({ error: "Invalid dataset id" });
  }

  try {
    await ensureArchiveColumn();

    const result = await pool.query(
      `
      UPDATE datasets
      SET is_deleted = TRUE,
          deleted_at = NOW(),
          updated_at = CURRENT_TIMESTAMP,
          updated_by = $2
      WHERE id = $1 AND is_deleted = FALSE
      RETURNING id, name, is_deleted, deleted_at, updated_at
      `,
      [datasetId, Number.isInteger(actorId) ? actorId : null]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    res.json({ success: true, dataset: result.rows[0] });
  } catch (error) {
    console.error("Soft delete dataset error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const restoreDataset = async (req, res) => {
  const datasetId = Number(req.params.id);
  const actorId = Number(req.user?.id);

  if (!Number.isInteger(datasetId) || datasetId <= 0) {
    return res.status(400).json({ error: "Invalid dataset id" });
  }

  try {
    await ensureArchiveColumn();

    const result = await pool.query(
      `
      UPDATE datasets
      SET is_deleted = FALSE,
          deleted_at = NULL,
          updated_at = CURRENT_TIMESTAMP,
          updated_by = $2
      WHERE id = $1 AND is_deleted = TRUE
      RETURNING id, name, is_deleted, deleted_at, updated_at
      `,
      [datasetId, Number.isInteger(actorId) ? actorId : null]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Archived dataset not found" });
    }

    res.json({ success: true, dataset: result.rows[0] });
  } catch (error) {
    console.error("Restore dataset error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const deleteRecord = async (req, res) => {
  const datasetId = Number(req.params.id);
  const recordId = Number(req.params.recordId);

  if (
    !Number.isInteger(datasetId) ||
    datasetId <= 0 ||
    !Number.isInteger(recordId) ||
    recordId <= 0
  ) {
    return res.status(400).json({ error: "Invalid record id" });
  }

  try {
    const result = await pool.query(
      "DELETE FROM records WHERE id = $1 AND dataset_id = $2 RETURNING id",
      [recordId, datasetId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Record not found" });
    }

    res.json({ message: "Record deleted" });
  } catch (error) {
    console.error("Delete record error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const updateCell = async (req, res) => {
  const datasetId = Number(req.params.id);
  const recordId = Number(req.params.recordId);
  const fieldId = Number(req.body?.field_id);
  const changedBy = Number(req.user?.id);

  if (!Number.isInteger(datasetId) || datasetId <= 0 || !Number.isInteger(recordId) || recordId <= 0) {
    return res.status(400).json({ error: "Invalid record id" });
  }

  if (!Number.isInteger(fieldId) || fieldId <= 0) {
    return res.status(400).json({ error: "field_id is required" });
  }

  if (!Number.isInteger(changedBy) || changedBy <= 0) {
    return res.status(401).json({ error: "Authentication required" });
  }

  await ensureSchema();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const recordResult = await client.query(
      `
      SELECT id
      FROM records
      WHERE id = $1 AND dataset_id = $2 AND is_deleted = FALSE
      `,
      [recordId, datasetId]
    );

    if (recordResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Record not found" });
    }

    const fieldResult = await client.query(
      `
      SELECT id, name, field_key, field_type, is_required, group_name
      FROM fields
      WHERE id = $1 AND dataset_id = $2 AND is_deleted = FALSE
      `,
      [fieldId, datasetId]
    );

    if (fieldResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Field not found" });
    }

    const field = fieldResult.rows[0];
    if (!roleCanEditField(req.user, field)) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "You do not have permission to edit these fields",
        code: "FORBIDDEN",
        requiredPermission: "canEditColumn",
        blockedFields: [field.field_key],
      });
    }

    const normalized = normalizeCellValue(field, req.body?.value);

    if (normalized == null) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `${field.name} has an invalid value` });
    }

    if (field.is_required && normalized === "") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `${field.name} is required` });
    }

    const currentResult = await client.query(
      `
      SELECT id, value
      FROM record_values
      WHERE record_id = $1 AND field_id = $2
      `,
      [recordId, fieldId]
    );

    const current = currentResult.rows[0] || null;
    const previous = current && current.value != null && current.value !== "" ? current.value : null;
    const previousComparable = previous == null ? "" : String(previous);

    if (previousComparable === normalized) {
      await client.query("ROLLBACK");
      return res.json({
        success: true,
        updated: {
          field_id: fieldId,
          value: normalized,
        },
      });
    }

    if (current) {
      await client.query(
        `
        UPDATE record_values
        SET value = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        `,
        [normalized, changedBy, current.id]
      );
    } else {
      await client.query(
        `
        INSERT INTO record_values (record_id, field_id, value, updated_by)
        VALUES ($1, $2, $3, $4)
        `,
        [recordId, fieldId, normalized, changedBy]
      );
    }

    await client.query(
      `
      INSERT INTO audit_logs (
        record_id,
        field_id,
        changed_by,
        old_value,
        new_value,
        changed_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
      `,
      [recordId, fieldId, changedBy, previous, normalized === "" ? null : normalized]
    );

    await client.query(
      `
      UPDATE records
      SET updated_by = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      `,
      [changedBy, recordId]
    );

    await logActivity(client, {
      datasetId,
      rowId: recordId,
      actorId: changedBy,
      actorName: req.user?.name || "User",
      action: "cell_edit",
      columnKey: field.field_key,
      fromValue: previous,
      toValue: normalized,
    });

    if (notifiesLeadership(req.user, field)) {
      const datasetName = await client.query("SELECT name FROM datasets WHERE id = $1", [datasetId]);
      await notifyLeadership(client, {
        message: `${req.user?.email || "A teammate"} updated ${field.name} on ${datasetName.rows[0]?.name || "a dataset"}`,
        datasetId,
        recordId,
        actorId: changedBy,
      });
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      updated: {
        field_id: fieldId,
        value: normalized,
      },
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback error:", rollbackError);
    }

    if (error.code === "23503") {
      return res.status(400).json({ error: "Unable to save this cell" });
    }

    console.error("Update cell error:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
};

const deleteField = async (req, res) => {
  const datasetId = Number(req.params.id);
  const fieldId = Number(req.params.fieldId);

  if (!Number.isInteger(datasetId) || datasetId <= 0 || !Number.isInteger(fieldId) || fieldId <= 0) {
    return res.status(400).json({ error: "Invalid column id" });
  }

  try {
    const result = await pool.query(
      `
      UPDATE fields
      SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND dataset_id = $2 AND is_deleted = FALSE
      RETURNING id, name
      `,
      [fieldId, datasetId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Column not found" });
    }

    await pool.query(
      `
      UPDATE datasets
      SET updated_at = CURRENT_TIMESTAMP, updated_by = $2
      WHERE id = $1
      `,
      [datasetId, req.user?.id || null]
    );

    res.json({ success: true, field: result.rows[0] });
  } catch (error) {
    console.error("Delete field error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getWorkspaceAuditLogs = async (req, res) => {
  try {
    await ensureSchema();
    const result = await pool.query(
      `
      SELECT
        a.id,
        a.record_id,
        d.id AS dataset_id,
        d.name AS dataset_name,
        f.name AS field_name,
        u.name AS changed_by_name,
        a.old_value,
        a.new_value,
        a.changed_at
      FROM audit_logs a
      JOIN records r ON r.id = a.record_id
      JOIN datasets d ON d.id = r.dataset_id
      JOIN users u ON u.id = a.changed_by
      JOIN fields f ON f.id = a.field_id
      WHERE d.is_deleted = FALSE
      ORDER BY a.changed_at DESC
      LIMIT 80
      `
    );
    res.json({ logs: result.rows });
  } catch (error) {
    console.error("Workspace audit error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const updateDataset = async (req, res) => {
  const id = Number(req.params.id);
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const hasDescription = Object.prototype.hasOwnProperty.call(req.body, "description");
  const description =
    typeof req.body.description === "string" ? req.body.description.trim() : "";

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid dataset id" });
  }

  if (!name) {
    return res.status(400).json({ error: "Dataset name is required" });
  }

  try {
    await ensureArchiveColumn();

    const result = await pool.query(
      `
      UPDATE datasets
      SET
        name = $1,
        description = CASE WHEN $2::boolean THEN $3 ELSE description END,
        updated_by = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
        AND is_deleted = FALSE
      RETURNING id, name, description, updated_at, updated_by
      `,
      [name, hasDescription, description || null, req.user?.id || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    res.json({ dataset: result.rows[0] });
  } catch (error) {
    console.error("Update dataset error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getAuditLogs = async (req, res) => {
  const datasetId = Number(req.params.id);

  if (!Number.isInteger(datasetId) || datasetId <= 0) {
    return res.status(400).json({ error: "Invalid dataset id" });
  }

  try {
    const datasetResult = await pool.query(
      "SELECT id FROM datasets WHERE id = $1 AND is_deleted = FALSE",
      [datasetId]
    );

    if (datasetResult.rows.length === 0) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    const result = await pool.query(
      `
      SELECT
        a.id,
        a.record_id,
        f.name AS field_name,
        u.name AS changed_by_name,
        a.old_value,
        a.new_value,
        a.changed_at
      FROM audit_logs a
      JOIN records r ON r.id = a.record_id
      JOIN users u ON u.id = a.changed_by
      JOIN fields f ON f.id = a.field_id
      WHERE r.dataset_id = $1
      ORDER BY a.changed_at DESC
      LIMIT 50
      `,
      [datasetId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Get audit logs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  getDatasets,
  createDataset,
  getDataset,
  addField,
  deleteField,
  getRecords,
  createRecord,
  deleteRecord,
  softDeleteDataset,
  restoreDataset,
  updateCell,
  updateDataset,
  getAuditLogs,
  getWorkspaceAuditLogs,
  listAccessibleFields,
  normalizeFieldKey,
  normalizeCellValue,
};
