const pool = require("../config/db");
const { normalizeRole } = require("../../../shared/permissions");
const { ensureSchema } = require("../database/ensure");

const getFieldPermissions = async (req, res) => {
  const datasetId = Number(req.params.id);
  const userId = Number(req.query.user_id);

  if (!Number.isInteger(datasetId) || datasetId <= 0) {
    return res.status(400).json({ error: "Invalid dataset id" });
  }

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "user_id is required" });
  }

  try {
    await ensureSchema();

    const dataset = await pool.query(
      "SELECT id FROM datasets WHERE id = $1 AND is_deleted = FALSE",
      [datasetId]
    );
    if (!dataset.rows.length) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    const person = await pool.query(
      `
      SELECT u.id, u.name, u.email, r.name AS role
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1
      `,
      [userId]
    );
    if (!person.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    const fields = await pool.query(
      `
      SELECT
        f.id,
        f.name,
        f.field_key,
        f.field_type,
        COALESCE(fp.can_view, TRUE) AS can_view,
        COALESCE(fp.can_edit, TRUE) AS can_edit
      FROM fields f
      LEFT JOIN field_permissions fp
        ON fp.field_id = f.id
       AND fp.user_id = $2
      WHERE f.dataset_id = $1
        AND f.is_deleted = FALSE
      ORDER BY f.position ASC, f.id ASC
      `,
      [datasetId, userId]
    );

    res.json({
      user: {
        ...person.rows[0],
        role: normalizeRole(person.rows[0].role),
      },
      fields: fields.rows,
    });
  } catch (error) {
    console.error("Get field permissions error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const saveFieldPermissions = async (req, res) => {
  const datasetId = Number(req.params.id);
  const userId = Number(req.body?.user_id);
  const items = req.body?.fields;

  if (!Number.isInteger(datasetId) || datasetId <= 0) {
    return res.status(400).json({ error: "Invalid dataset id" });
  }

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "user_id is required" });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "fields are required" });
  }

  const client = await pool.connect();

  try {
    await ensureSchema();
    await client.query("BEGIN");

    const dataset = await client.query(
      "SELECT id FROM datasets WHERE id = $1 AND is_deleted = FALSE",
      [datasetId]
    );
    if (!dataset.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Dataset not found" });
    }

    const person = await client.query("SELECT id FROM users WHERE id = $1", [userId]);
    if (!person.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "User not found" });
    }

    for (const item of items) {
      const fieldId = Number(item.field_id);
      if (!Number.isInteger(fieldId) || fieldId <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Each field needs a field_id" });
      }

      const field = await client.query(
        "SELECT id FROM fields WHERE id = $1 AND dataset_id = $2 AND is_deleted = FALSE",
        [fieldId, datasetId]
      );
      if (!field.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Column not found" });
      }

      let canView = Boolean(item.can_view);
      let canEdit = Boolean(item.can_edit);
      if (canEdit) canView = true;
      if (!canView) canEdit = false;

      await client.query(
        `
        INSERT INTO field_permissions (user_id, field_id, can_view, can_edit)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, field_id)
        DO UPDATE SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit
        `,
        [userId, fieldId, canView, canEdit]
      );
    }

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback error:", rollbackError);
    }
    console.error("Save field permissions error:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
};

module.exports = {
  getFieldPermissions,
  saveFieldPermissions,
};
