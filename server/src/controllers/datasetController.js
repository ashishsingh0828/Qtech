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

module.exports = {
  getDatasets,
  createDataset,
  getDataset,
  addField,
};
