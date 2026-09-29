const pool = require("../config/db");
const { ensureSchema } = require("../database/ensure");
const { normalizeRole } = require("../../../shared/permissions");

const listeners = new Map();

function publish(userId, payload) {
  const targets = listeners.get(Number(userId));
  if (!targets) return;
  const body = `data: ${JSON.stringify(payload)}\n\n`;
  targets.forEach((response) => {
    response.write(body);
  });
}

function present(row) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type || "activity",
    datasetId: row.dataset_id,
    rowId: row.row_id || row.record_id,
    actorName: row.actor_name || "",
    customerName: row.customer_name || "",
    summary: row.summary || row.message || "",
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

async function leaders(actorId) {
  const result = await pool.query(`
    SELECT u.id
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.is_active = TRUE
      AND lower(replace(replace(r.name, '_', ' '), '-', ' ')) IN ('admin', 'manager', 'managing person')
  `);
  return result.rows.map((row) => Number(row.id)).filter((id) => id && id !== Number(actorId));
}

async function notifySheetEvent({ actorId, actorName, datasetId, rowId, customerName, summary, type }) {
  const recipients = await leaders(actorId);
  if (!recipients.length) return;
  for (const userId of recipients) {
    const recent = await pool.query(
      `
      SELECT id
      FROM notifications
      WHERE user_id = $1
        AND dataset_id = $2
        AND COALESCE(row_id, record_id) = $3
        AND actor_name = $4
        AND created_at > NOW() - INTERVAL '60 seconds'
      ORDER BY id DESC
      LIMIT 1
      `,
      [userId, datasetId, rowId, actorName]
    );
    if (recent.rows[0]) {
      const updated = await pool.query(
        `
        UPDATE notifications
        SET summary = $2, message = $2, customer_name = $3, type = $4, is_read = FALSE, created_at = NOW()
        WHERE id = $1
        RETURNING id, user_id, type, dataset_id, row_id, record_id, actor_name, customer_name, summary, message, is_read, created_at
        `,
        [recent.rows[0].id, summary, customerName || "", type]
      );
      publish(userId, { notification: present(updated.rows[0]) });
      continue;
    }
    const inserted = await pool.query(
      `
      INSERT INTO notifications (
        user_id, message, summary, type, dataset_id, record_id, row_id, actor_name, customer_name
      )
      VALUES ($1, $2, $2, $3, $4, $5, $5, $6, $7)
      RETURNING id, user_id, type, dataset_id, row_id, record_id, actor_name, customer_name, summary, message, is_read, created_at
      `,
      [userId, summary, type, datasetId, rowId, actorName, customerName || ""]
    );
    publish(userId, { notification: present(inserted.rows[0]) });
  }
}

async function notifyLeadership(db, { message, datasetId, recordId, actorId }) {
  const ids = await leaders(actorId);
  if (!ids.length || !message) return;
  await db.query(
    `
    INSERT INTO notifications (user_id, message, summary, type, dataset_id, record_id, row_id, actor_name)
    SELECT uid, $2, $2, 'legacy', $3, $4, $4, ''
    FROM UNNEST($1::int[]) AS uid
    `,
    [ids, message, datasetId || null, recordId || null]
  );
  ids.forEach((id) => publish(id, { refresh: true }));
}

const listNotifications = async (req, res) => {
  const userId = Number(req.user?.id);
  try {
    await ensureSchema();
    const result = await pool.query(
      `
      SELECT id, user_id, type, dataset_id, record_id, row_id, actor_name, customer_name, summary, message, is_read, created_at
      FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 40
      `,
      [userId]
    );
    const notifications = result.rows.map(present);
    res.json({
      notifications,
      unread: notifications.filter((entry) => !entry.isRead).length,
    });
  } catch (error) {
    console.error("List notifications error:", error);
    res.status(500).json({ error: "Unable to load notifications" });
  }
};

const streamNotifications = async (req, res) => {
  const userId = Number(req.user?.id);
  try {
    await ensureSchema();
  } catch (error) {
    console.error("Notification stream error:", error);
    return res.status(500).json({ error: "Unable to open the notification stream" });
  }
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(": connected\n\n");
  const current = listeners.get(userId) || new Set();
  current.add(res);
  listeners.set(userId, current);
  const pulse = setInterval(() => {
    res.write(": ping\n\n");
  }, 25000);
  req.on("close", () => {
    clearInterval(pulse);
    current.delete(res);
    if (!current.size) listeners.delete(userId);
  });
};

const markNotificationRead = async (req, res) => {
  const userId = Number(req.user?.id);
  const noteId = Number(req.params.noteId || req.params.id);
  if (!Number.isInteger(noteId) || noteId <= 0) return res.status(400).json({ error: "Invalid notification id" });
  try {
    await ensureSchema();
    const result = await pool.query(
      "UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2 RETURNING id",
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

function shouldNotifyEdit(role, schema, changes) {
  if (normalizeRole(role) !== "service") return false;
  return changes.some((change) => ["amc", "schedule_services", "follow_up"].includes(change.groupKey));
}

module.exports = {
  notifySheetEvent,
  notifyLeadership,
  listNotifications,
  streamNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  shouldNotifyEdit,
};
