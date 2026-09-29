const pool = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { COOKIE_NAME, JWT_SECRET } = require("../middleware/authMiddleware");
const { ensureSchema } = require("../database/ensure");
const { normalizeRole, permissionsFor, roleTitle } = require("../../../shared/permissions");

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const attempts = new Map();

function clientAddress(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || "unknown";
}

function tooManyAttempts(key) {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((stamp) => now - stamp < WINDOW_MS);
  attempts.set(key, recent);
  return recent.length >= MAX_ATTEMPTS;
}

function recordAttempt(key) {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((stamp) => now - stamp < WINDOW_MS);
  recent.push(now);
  attempts.set(key, recent);
}

function sessionCookie(token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${8 * 60 * 60}${secure}`;
}

function clearCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

function publicUser(user) {
  const role = normalizeRole(user.role);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role,
    roleTitle: roleTitle(role),
  };
}

const login = async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  const bucket = `${clientAddress(req)}:${email}`;
  if (tooManyAttempts(bucket)) {
    return res.status(429).json({ error: "Too many sign-in attempts. Try again in 15 minutes." });
  }
  recordAttempt(bucket);

  try {
    await ensureSchema();
    const result = await pool.query(
      `
      SELECT u.id, u.name, u.email, u.password_hash, u.is_active, r.name AS role
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE lower(u.email) = $1
      `,
      [email]
    );
    const user = result.rows[0];
    const role = normalizeRole(user?.role);
    const passwordOk = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!user || !user.is_active || !passwordOk || !permissionsFor(role)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    attempts.delete(bucket);
    await pool.query("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1", [user.id]);
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "8h" });
    res.setHeader("Set-Cookie", sessionCookie(token));
    res.json({
      user: publicUser(user),
      role,
      permissions: permissionsFor(role),
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const logout = async (req, res) => {
  res.setHeader("Set-Cookie", clearCookie());
  res.json({ success: true });
};

const me = async (req, res) => {
  const role = normalizeRole(req.user.role);
  res.json({
    user: publicUser(req.user),
    role,
    permissions: permissionsFor(role),
  });
};

const changePassword = async (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const nextPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (!currentPassword || !nextPassword) {
    return res.status(400).json({ error: "Current and new passwords are required" });
  }
  if (nextPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters" });
  }
  try {
    const result = await pool.query("SELECT password_hash FROM users WHERE id = $1 AND is_active = TRUE", [req.user.id]);
    if (!result.rows.length) return res.status(401).json({ error: "Authentication required" });
    const matches = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!matches) return res.status(400).json({ error: "Current password is incorrect" });
    const hash = await bcrypt.hash(nextPassword, 10);
    await pool.query("UPDATE users SET password_hash = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [
      req.user.id,
      hash,
    ]);
    res.json({ success: true });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ error: "Unable to change password" });
  }
};

async function bootstrapAdmin() {
  await ensureSchema();
  const existing = await pool.query("SELECT COUNT(*)::int AS count FROM users");
  if ((existing.rows[0]?.count || 0) > 0) return;
  const email = String(process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const password = String(process.env.ADMIN_PASSWORD || "");
  if (!email || !password) return;
  const role = await pool.query("SELECT id FROM roles WHERE name = 'admin' LIMIT 1");
  if (!role.rows.length) return;
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `
    INSERT INTO users (name, email, password_hash, role_id, is_active)
    VALUES ($1, $2, $3, $4, TRUE)
    `,
    ["Admin", email, hash, role.rows[0].id]
  );
  console.log(`Bootstrapped admin user ${email}`);
}

module.exports = { login, logout, me, changePassword, bootstrapAdmin };
