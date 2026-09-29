const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const { normalizeRole, permissionsFor } = require("../../../shared/permissions");

const JWT_SECRET = process.env.JWT_SECRET || "qtech_secret_key_123";
const COOKIE_NAME = "qtech_session";

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  const parts = header.split(";");
  for (const part of parts) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = decodeURIComponent(part.slice(0, index).trim());
    if (key !== name) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return "";
}

async function requireAuth(req, res, next) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return res.status(401).json({ error: "Authentication required" });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  try {
    const result = await pool.query(
      `
      SELECT u.id, u.email, u.name, u.is_active, r.name AS role
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1
      `,
      [payload.id]
    );
    const user = result.rows[0];
    const role = normalizeRole(user?.role);
    if (!user || !user.is_active || !permissionsFor(role)) {
      return res.status(401).json({ error: "Authentication required" });
    }
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role,
    };
    return next();
  } catch (error) {
    console.error("Auth lookup error:", error);
    return res.status(500).json({ error: "Authentication required" });
  }
}

module.exports = { requireAuth, COOKIE_NAME, JWT_SECRET };
