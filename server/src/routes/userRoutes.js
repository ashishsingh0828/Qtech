const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { listUsers, updateUserRole } = require("../controllers/userController");

const router = express.Router();

router.use(requireAuth, requireRole(["Admin"]));
router.get("/", listUsers);
router.patch("/:id/role", updateUserRole);

module.exports = router;
