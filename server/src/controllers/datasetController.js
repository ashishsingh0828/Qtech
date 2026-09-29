const pool = require("../config/db");

const FIELD_TYPES = new Set(["text", "number", "date", "boolean", "email"]);

function normalizeFieldKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 255);
}

const getDatasets = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        d.id,
        d.name,
        d.description,
        d.created_by,
        u.name AS created_by_name,
        d.created_at,
        d.updated_at,
        COUNT(f.id)::int AS fields_count
      FROM datasets d
      LEFT JOIN users u ON u.id = d.created_by
      LEFT JOIN fields f
        ON f.dataset_id = d.id
       AND f.is_deleted = FALSE
      WHERE d.is_deleted = FALSE
      GROUP BY d.id, u.name
      ORDER BY d.created_at DESC
    `);

    res.json({ datasets: result.rows });
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

    res.status(201).json({
      dataset: {
        ...result.rows[0],
        created_by_name: creator.rows[0]?.name || null,
        fields_count: 0,
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

    const fieldsResult = await pool.query(
      `
      SELECT
        id,
        dataset_id,
        name,
        field_key,
        field_type,
        position,
        is_required,
        created_at
      FROM fields
      WHERE dataset_id = $1 AND is_deleted = FALSE
      ORDER BY position ASC, id ASC
      `,
      [id]
    );

    res.json({
      dataset: {
        ...datasetResult.rows[0],
        fields: fieldsResult.rows,
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

    const positionResult = await client.query(
      `
      SELECT COALESCE(MAX(position), -1) + 1 AS next_position
      FROM fields
      WHERE dataset_id = $1
      `,
      [datasetId]
    );

    const insertResult = await client.query(
      `
      INSERT INTO fields (dataset_id, name, field_key, field_type, position, is_required)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, dataset_id, name, field_key, field_type, position, is_required, created_at
      `,
      [
        datasetId,
        name,
        fieldKey,
        fieldType,
        positionResult.rows[0].next_position,
        isRequired,
      ]
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

    const recordsResult = await pool.query(
      `
      SELECT id, created_at
      FROM records
      WHERE dataset_id = $1 AND is_deleted = FALSE
      ORDER BY created_at ASC, id ASC
      `,
      [datasetId]
    );

    const valuesResult = await pool.query(
      `
      SELECT rv.record_id, f.field_key, rv.value
      FROM record_values rv
      JOIN records r ON r.id = rv.record_id
      JOIN fields f ON f.id = rv.field_id
      WHERE r.dataset_id = $1
        AND r.is_deleted = FALSE
        AND f.dataset_id = $1
        AND f.is_deleted = FALSE
      `,
      [datasetId]
    );

    const valuesByRecord = new Map();

    for (const row of valuesResult.rows) {
      if (!valuesByRecord.has(row.record_id)) {
        valuesByRecord.set(row.record_id, {});
      }
      valuesByRecord.get(row.record_id)[row.field_key] = row.value;
    }

    res.json({
      records: recordsResult.rows.map((record) => ({
        id: record.id,
        created_at: record.created_at,
        values: valuesByRecord.get(record.id) || {},
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

    const entries = [];

    for (const field of fieldsResult.rows) {
      const hasKey = Object.prototype.hasOwnProperty.call(rawValues, field.field_key);
      const normalized = normalizeCellValue(field, hasKey ? rawValues[field.field_key] : "");

      if (normalized == null) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `${field.name} has an invalid value` });
      }

      if (field.is_required && field.field_type !== "boolean" && normalized === "") {
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

    const insertRecord = await client.query(
      `
      INSERT INTO records (dataset_id, created_by, updated_by)
      VALUES ($1, $2, $2)
      RETURNING id, created_at
      `,
      [datasetId, createdBy]
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
      SELECT id, name, field_type, is_required
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
    const previous = current ? current.value : null;
    const previousComparable = previous == null ? "" : String(previous);

    if (previousComparable === normalized) {
      await client.query("ROLLBACK");
      return res.json({
        success: true,
        updated: {
          field_id: fieldId,
          value: previous == null ? normalized : previous,
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
        user_id,
        dataset_id,
        record_id,
        field_id,
        action,
        old_value,
        new_value,
        created_at
      )
      VALUES ($1, $2, $3, $4, 'cell_update', $5, $6, NOW())
      `,
      [changedBy, datasetId, recordId, fieldId, previous, normalized]
    );

    await client.query(
      `
      UPDATE records
      SET updated_by = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      `,
      [changedBy, recordId]
    );

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
        a.created_at AS changed_at
      FROM audit_logs a
      JOIN records r ON r.id = a.record_id
      LEFT JOIN users u ON u.id = a.user_id
      LEFT JOIN fields f ON f.id = a.field_id
      WHERE r.dataset_id = $1
      ORDER BY a.created_at DESC
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
  getRecords,
  createRecord,
  deleteRecord,
  updateCell,
  getAuditLogs,
};
