const pool = require("../config/db");

let ready = null;

function ensureSchema() {
  if (!ready) {
    ready = applySchema();
  }
  return ready;
}

async function applySchema() {
  await pool.query("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP");
  await pool.query("ALTER TABLE records ADD COLUMN IF NOT EXISTS position INTEGER");
  await pool.query(`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY dataset_id ORDER BY created_at ASC, id ASC) - 1 AS rn
      FROM records
      WHERE position IS NULL
    )
    UPDATE records AS target
    SET position = ranked.rn
    FROM ranked
    WHERE target.id = ranked.id
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS field_permissions (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      field_id INTEGER NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
      can_view BOOLEAN NOT NULL DEFAULT TRUE,
      can_edit BOOLEAN NOT NULL DEFAULT TRUE,
      PRIMARY KEY (user_id, field_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_field_permissions_field_id
    ON field_permissions(field_id)
  `);
}

module.exports = { ensureSchema };
