const pool = require("../config/db");
const { ensureSchema } = require("../database/ensure");

async function notifyLeadership(db, { message, datasetId, recordId, actorId }) {
  const leaders = await db.query(`
    SELECT u.id
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.is_active = TRUE
      AND lower(replace(replace(r.name, '_', ' '), '-', ' ')) IN ('admin', 'manager', 'managing person')
  `);
  const ids = leaders.rows.map((row) => Number(row.id)).filter((id) => id && id !== Number(actorId));
  if (!ids.length) return;
  await db.query(
    `
    INSERT INTO notifications (user_id, message, dataset_id, record_id)
    SELECT uid, $2, $3, $4
    FROM UNNEST($1::int[]) AS uid
    `,
    [ids, message, datasetId || null, recordId || null]
  );
}

const listNotifications = async (req, res) => {
  const userId = Number(req.user?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({ error: "Authentication required" });
  }
  try {
    await ensureSchema();
    const result = await pool.query(
      `
      SELECT id, user_id, message, dataset_id, record_id, is_read, created_at
      FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 30
      `,
      [userId]
    );
    const unread = result.rows.filter((row) => !row.is_read).length;
    res.json({ notifications: result.rows, unread });
  } catch (error) {
    console.error("List notifications error:", error);
    res.status(500).json({ error: "Unable to load notifications" });
  }
};

const markNotificationRead = async (req, res) => {
  const userId = Number(req.user?.id);
  const noteId = Number(req.params.noteId);
  if (!Number.isInteger(noteId) || noteId <= 0) {
    return res.status(400).json({ error: "Invalid notification id" });
  }
  try {
    await ensureSchema();
    const result = await pool.query(
      `
      UPDATE notifications
      SET is_read = TRUE
      WHERE id = $1 AND user_id = $2
      RETURNING id
      `,
      [noteId, userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Notification not found" });
    res.json({ success: true });
  } catch (error) {
    console.error("Read notification error:", error);
    res.status(500).json({ error: "Unable to update this notification" });
  }
};

const markAllNotificationsRead = async (req, res) => {
  const userId = Number(req.user?.id);
  try {
    await ensureSchema();
    await pool.query("UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE", [userId]);
    res.json({ success: true });
  } catch (error) {
    console.error("Read notifications error:", error);
    res.status(500).json({ error: "Unable to update notifications" });
  }
};

module.exports = {
  notifyLeadership,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};
