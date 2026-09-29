const pool = require("../config/db");
const { canonicalRole } = require("../middleware/auth");

const ALLOWED_ROLES = new Set(["Admin", "Managing Person"]);

const listUsers = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.is_active,
        r.name AS role,
        u.created_at
      FROM users u
      JOIN roles r ON r.id = u.role_id
      ORDER BY u.name ASC, u.id ASC
    `);

    res.json({
      users: result.rows.map((user) => ({
        ...user,
        role: canonicalRole(user.role),
      })),
    });
  } catch (error) {
    console.error("List users error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const updateUserRole = async (req, res) => {
  const userId = Number(req.params.id);
  const role = canonicalRole(req.body?.role);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Invalid user id" });
  }

  if (!ALLOWED_ROLES.has(role)) {
    return res.status(400).json({ error: "Role must be Admin or Managing Person" });
  }

  const roleKey = role === "Admin" ? "admin" : "managing person";

  try {
    const userResult = await pool.query("SELECT id FROM users WHERE id = $1", [userId]);
    if (!userResult.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    const roleResult = await pool.query(
      `
      SELECT id, name
      FROM roles
      WHERE lower(replace(replace(name, '_', ' '), '-', ' ')) = $1
      `,
      [roleKey]
    );

    if (!roleResult.rows.length) {
      return res.status(400).json({ error: "Role was not found" });
    }

    const updated = await pool.query(
      `
      UPDATE users
      SET role_id = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, name, email, is_active
      `,
      [userId, roleResult.rows[0].id]
    );

    res.json({
      user: {
        ...updated.rows[0],
        role,
      },
    });
  } catch (error) {
    console.error("Update user role error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  listUsers,
  updateUserRole,
};
