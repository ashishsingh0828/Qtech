const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { listUsers, updateUserRole } = require("../controllers/userController");

const router = express.Router();

router.param("id", (req, res, next, value) => {
  if (!/^\d+$/.test(String(value))) {
    return res.status(400).json({ error: "Invalid user id" });
  }
  return next();
});

router.use(requireAuth, requireRole(["Admin"]));
router.get("/", listUsers);
router.patch("/:id/role", updateUserRole);

module.exports = router;
