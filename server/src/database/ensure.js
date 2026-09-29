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
  await pool.query("CREATE INDEX IF NOT EXISTS idx_records_dataset_id ON records(dataset_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_record_values_lookup ON record_values(record_id, field_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_fields_dataset_id ON fields(dataset_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_audit_logs_record_field ON audit_logs(record_id, field_id)");
  await pool.query("ALTER TABLE fields ADD COLUMN IF NOT EXISTS group_name VARCHAR(120)");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP");
  await pool.query("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS source_file_name VARCHAR(255)");
  await pool.query("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS row_count INTEGER");
  await pool.query("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS column_count INTEGER");
  await pool.query("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS schema JSONB");
  await pool.query("ALTER TABLE records ADD COLUMN IF NOT EXISTS data JSONB");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      dataset_id INTEGER REFERENCES datasets(id) ON DELETE CASCADE,
      record_id INTEGER REFERENCES records(id) ON DELETE SET NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id, is_read, created_at DESC)");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      row_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_name VARCHAR(150) NOT NULL,
      action VARCHAR(80) NOT NULL,
      column_key VARCHAR(120),
      from_value TEXT,
      to_value TEXT,
      at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_activity_log_row ON activity_log(dataset_id, row_id, at DESC)");
  await canonicalizeRoles();
}

async function canonicalizeRoles() {
  const catalog = [
    ["admin", ["admin"], "Full workspace access"],
    ["manager", ["manager", "managing person", "managingperson"], "Edits every group, uploads, and verifies"],
    ["validator", ["validator"], "Edits data validation only"],
    ["service", ["service"], "Edits service groups only"],
  ];
  for (const [name, aliases, description] of catalog) {
    let target = await pool.query("SELECT id FROM roles WHERE name = $1 LIMIT 1", [name]);
    if (!target.rows.length) {
      const source = await pool.query(
        `
        SELECT id
        FROM roles
        WHERE lower(replace(replace(name, '_', ' '), '-', ' ')) = ANY($1::text[])
        ORDER BY id
        LIMIT 1
        `,
        [aliases]
      );
      if (source.rows.length) {
        await pool.query("UPDATE roles SET name = $1, description = $2 WHERE id = $3", [
          name,
          description,
          source.rows[0].id,
        ]);
      } else {
        await pool.query("INSERT INTO roles (name, description) VALUES ($1, $2)", [name, description]);
      }
      target = await pool.query("SELECT id FROM roles WHERE name = $1 LIMIT 1", [name]);
    }
    await pool.query(
      `
      UPDATE users
      SET role_id = $1
      WHERE role_id IN (
        SELECT id FROM roles
        WHERE lower(replace(replace(name, '_', ' '), '-', ' ')) = ANY($2::text[])
          AND name <> $3
      )
      `,
      [target.rows[0].id, aliases, name]
    );
  }
}

module.exports = { ensureSchema };
