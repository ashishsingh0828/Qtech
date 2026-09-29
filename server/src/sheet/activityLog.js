function clip(value) {
  if (value == null || value === "") return null;
  return String(value).slice(0, 500);
}

async function logActivity(db, entry) {
  await db.query(
    `
    INSERT INTO activity_log (
      dataset_id, row_id, actor_id, actor_name, action, column_key, from_value, to_value, at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
    `,
    [
      entry.datasetId,
      entry.rowId,
      entry.actorId || null,
      entry.actorName || "User",
      entry.action,
      entry.columnKey || null,
      clip(entry.fromValue),
      clip(entry.toValue),
    ]
  );
}

function presentActivity(row) {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    rowId: row.row_id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    columnKey: row.column_key,
    fromValue: row.from_value,
    toValue: row.to_value,
    at: row.at,
  };
}

module.exports = { logActivity, presentActivity };
