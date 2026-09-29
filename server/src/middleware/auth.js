const { requireAuth } = require("./authMiddleware");
const { hasPermission } = require("../../../shared/permissions");

function requirePermission(flag) {
  return function permissionGuard(req, res, next) {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (!hasPermission(req.user.role, flag)) {
      return res.status(403).json({
        error: "You do not have permission for this action",
        code: "FORBIDDEN",
        requiredPermission: flag,
      });
    }
    return next();
  };
}

module.exports = { requireAuth, requirePermission };
