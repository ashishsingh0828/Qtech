const express = require("express");
const { requireAuth } = require("../middleware/auth");
const {
  listNotifications,
  streamNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../controllers/notificationController");

const router = express.Router();

router.use(requireAuth);
router.get("/stream", streamNotifications);
router.get("/", listNotifications);
router.post("/read-all", markAllNotificationsRead);
router.patch("/read-all", markAllNotificationsRead);
router.patch("/:noteId/read", markNotificationRead);

module.exports = router;
