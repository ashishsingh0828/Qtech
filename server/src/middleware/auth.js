const { requireAuth } = require("./authMiddleware");

function canonicalRole(role) {
  const normalized = String(role || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .trim();

  if (normalized === "admin") return "Admin";
  if (normalized === "managing person" || normalized === "managingperson") {
    return "Managing Person";
  }

  return String(role || "");
}

function requireRole(allowedRoles) {
  const allowed = new Set(allowedRoles.map((role) => canonicalRole(role)));

  return function roleGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!allowed.has(canonicalRole(req.user.role))) {
      return res.status(403).json({ error: "You do not have permission for this action" });
    }

    return next();
  };
}

module.exports = {
  requireAuth,
  requireRole,
  canonicalRole,
};
