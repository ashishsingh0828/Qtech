const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { listUsers, createUser, updateUserRole, updateUserStatus, resetPassword } = require("../controllers/userController");

const router = express.Router();

router.param("id", (req, res, next, value) => {
  if (!/^\d+$/.test(String(value))) return res.status(400).json({ error: "Invalid user id" });
  return next();
});

router.use(requireAuth, requirePermission("canManageUsers"));
router.get("/", listUsers);
router.post("/", createUser);
router.patch("/:id/role", updateUserRole);
router.patch("/:id/status", updateUserStatus);
router.post("/:id/reset-password", resetPassword);

module.exports = router;
