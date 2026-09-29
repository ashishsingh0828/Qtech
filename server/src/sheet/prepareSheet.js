const pool = require("../config/db");
const { ensureSystemColumns, systemReady } = require("./systemColumns");

async function readySchema(dataset, resolveSchema) {
  const original = await resolveSchema(dataset);
  if (systemReady(original)) return original;
  const prepared = ensureSystemColumns(original);
  const same = JSON.stringify(original) === JSON.stringify(prepared.schema) && prepared.rekeys.length === 0;
  if (same) return prepared.schema;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const { from, to } of prepared.rekeys) {
      await client.query(
        `
        UPDATE records
        SET data = (data - $2::text) || jsonb_build_object($3::text, data -> $2)
        WHERE dataset_id = $1 AND data ? $2
        `,
        [dataset.id, from, to]
      );
    }
    await client.query(
      `
      UPDATE records
      SET data = data - 'warranty_live'
      WHERE dataset_id = $1 AND data ? 'warranty_live'
      `,
      [dataset.id]
    );
    await client.query(
      `
      UPDATE datasets
      SET schema = $2::jsonb, column_count = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [dataset.id, JSON.stringify(prepared.schema), prepared.schema.columns.length]
    );
    await client.query("COMMIT");
    return prepared.schema;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { readySchema };
