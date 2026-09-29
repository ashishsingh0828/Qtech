const express = require("express");
const { login, logout, me, changePassword } = require("../controllers/authController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/login", login);
router.post("/logout", logout);
router.get("/me", requireAuth, me);
router.patch("/password", requireAuth, changePassword);

module.exports = router;
