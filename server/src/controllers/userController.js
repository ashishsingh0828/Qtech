const pool = require("../config/db");
const bcrypt = require("bcryptjs");
const { normalizeRole, permissionsFor, hasPermission, roleTitle } = require("../../../shared/permissions");

function present(user) {
  const role = normalizeRole(user.role);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role,
    roleTitle: roleTitle(role),
    isActive: user.is_active,
    lastLoginAt: user.last_login_at || null,
  };
}

async function activeManagers() {
  const result = await pool.query(`
    SELECT u.id, r.name AS role
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.is_active = TRUE
  `);
  return result.rows.filter((user) => hasPermission(user.role, "canManageUsers"));
}

async function roleId(role) {
  const key = normalizeRole(role);
  if (!permissionsFor(key)) return null;
  const found = await pool.query("SELECT id FROM roles WHERE name = $1 LIMIT 1", [key]);
  if (found.rows.length) return found.rows[0].id;
  const inserted = await pool.query(
    "INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING id",
    [key, `${roleTitle(key)} workspace role`]
  );
  return inserted.rows[0].id;
}

const listUsers = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.is_active, u.last_login_at, r.name AS role
      FROM users u
      JOIN roles r ON r.id = u.role_id
      ORDER BY u.name ASC, u.id ASC
    `);
    res.json({ users: result.rows.map(present) });
  } catch (error) {
    console.error("List users error:", error);
    res.status(500).json({ error: "Unable to load users" });
  }
};

const createUser = async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const role = normalizeRole(req.body?.role);
  if (!name || !email || !password) return res.status(400).json({ error: "Name, email, and password are required" });
  if (!permissionsFor(role)) return res.status(400).json({ error: "Choose a valid role" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  try {
    const id = await roleId(role);
    const hash = await bcrypt.hash(password, 10);
    const inserted = await pool.query(
      `
      INSERT INTO users (name, email, password_hash, role_id, is_active)
      VALUES ($1, $2, $3, $4, TRUE)
      RETURNING id, name, email, is_active, last_login_at
      `,
      [name, email, hash, id]
    );
    res.status(201).json({ user: present({ ...inserted.rows[0], role }) });
  } catch (error) {
    if (error.code === "23505") return res.status(400).json({ error: "That email is already in use" });
    console.error("Create user error:", error);
    res.status(500).json({ error: "Unable to create this user" });
  }
};

const updateUserRole = async (req, res) => {
  const userId = Number(req.params.id);
  const role = normalizeRole(req.body?.role);
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "Invalid user id" });
  if (!permissionsFor(role)) return res.status(400).json({ error: "Choose a valid role" });
  if (userId === Number(req.user.id)) {
    return res.status(403).json({ error: "You cannot change your own role", code: "FORBIDDEN", requiredPermission: "canManageUsers" });
  }
  try {
    const current = await pool.query(
      `
      SELECT u.id, u.name, u.email, u.is_active, u.last_login_at, r.name AS role
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1
      `,
      [userId]
    );
    if (!current.rows.length) return res.status(404).json({ error: "User not found" });
    const managers = await activeManagers();
    const targetIsManager = hasPermission(current.rows[0].role, "canManageUsers");
    if (targetIsManager && !hasPermission(role, "canManageUsers") && managers.length <= 1) {
      return res.status(403).json({ error: "The last active admin cannot be removed", code: "FORBIDDEN", requiredPermission: "canManageUsers" });
    }
    const id = await roleId(role);
    const updated = await pool.query(
      `
      UPDATE users
      SET role_id = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, name, email, is_active, last_login_at
      `,
      [userId, id]
    );
    res.json({ user: present({ ...updated.rows[0], role }) });
  } catch (error) {
    console.error("Update user role error:", error);
    res.status(500).json({ error: "Unable to update this role" });
  }
};

const updateUserStatus = async (req, res) => {
  const userId = Number(req.params.id);
  const isActive = req.body?.isActive;
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "Invalid user id" });
  if (typeof isActive !== "boolean") return res.status(400).json({ error: "isActive is required" });
  if (userId === Number(req.user.id) && !isActive) {
    return res.status(403).json({ error: "You cannot deactivate yourself", code: "FORBIDDEN", requiredPermission: "canManageUsers" });
  }
  try {
    const current = await pool.query(
      `
      SELECT u.id, u.name, u.email, u.is_active, u.last_login_at, r.name AS role
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1
      `,
      [userId]
    );
    if (!current.rows.length) return res.status(404).json({ error: "User not found" });
    const managers = await activeManagers();
    if (!isActive && hasPermission(current.rows[0].role, "canManageUsers") && managers.length <= 1) {
      return res.status(403).json({ error: "The last active admin cannot be removed", code: "FORBIDDEN", requiredPermission: "canManageUsers" });
    }
    const updated = await pool.query(
      `
      UPDATE users
      SET is_active = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, name, email, is_active, last_login_at
      `,
      [userId, isActive]
    );
    res.json({ user: present({ ...updated.rows[0], role: current.rows[0].role }) });
  } catch (error) {
    console.error("Update user status error:", error);
    res.status(500).json({ error: "Unable to update this user" });
  }
};

const resetPassword = async (req, res) => {
  const userId = Number(req.params.id);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "Invalid user id" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  try {
    const hash = await bcrypt.hash(password, 10);
    const updated = await pool.query(
      "UPDATE users SET password_hash = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id",
      [userId, hash]
    );
    if (!updated.rows.length) return res.status(404).json({ error: "User not found" });
    res.json({ success: true });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ error: "Unable to reset this password" });
  }
};

module.exports = { listUsers, createUser, updateUserRole, updateUserStatus, resetPassword };
