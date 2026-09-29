const ROLE_PERMISSIONS = {
  admin: {
    editableGroupKeys: "all",
    canUpload: true,
    canAddRow: true,
    canDeleteRow: true,
    canDeleteDataset: true,
    canManageUsers: true,
    canEditSchema: true,
    canVerify: true,
    canValidate: true,
    canManageAmc: true,
    canResetAmc: true,
    canClearValidation: true,
  },
  manager: {
    editableGroupKeys: "all",
    canUpload: true,
    canAddRow: true,
    canDeleteRow: true,
    canDeleteDataset: true,
    canManageUsers: false,
    canEditSchema: false,
    canVerify: true,
    canValidate: true,
    canManageAmc: true,
    canResetAmc: true,
    canClearValidation: true,
  },
  validator: {
    editableGroupKeys: ["data_validation"],
    canUpload: false,
    canAddRow: false,
    canDeleteRow: false,
    canDeleteDataset: false,
    canManageUsers: false,
    canEditSchema: false,
    canVerify: false,
    canValidate: true,
    canManageAmc: false,
    canResetAmc: false,
    canClearValidation: false,
  },
  service: {
    editableGroupKeys: ["amc", "schedule_services", "breakdown_calls", "follow_up", "complaint"],
    canUpload: false,
    canAddRow: false,
    canDeleteRow: false,
    canDeleteDataset: false,
    canManageUsers: false,
    canEditSchema: false,
    canVerify: false,
    canValidate: false,
    canManageAmc: true,
    canResetAmc: false,
    canClearValidation: false,
  },
};

const serverManagedSemantics = [
  "validated_by",
  "validated_at",
  "verified",
  "verified_by",
  "verified_at",
  "amc_status",
  "ack_at",
  "warranty_live",
  "days",
  "next_due_pms",
];

function normalizeRole(role) {
  const normalized = String(role || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .trim();
  if (normalized === "admin") return "admin";
  if (normalized === "manager" || normalized === "managing person" || normalized === "managingperson") {
    return "manager";
  }
  if (normalized === "validator") return "validator";
  if (normalized === "service") return "service";
  return "";
}

function permissionsFor(role) {
  const key = normalizeRole(role);
  if (!key || !ROLE_PERMISSIONS[key]) return null;
  return ROLE_PERMISSIONS[key];
}

function roleTitle(role) {
  const key = normalizeRole(role);
  if (key === "admin") return "Admin";
  if (key === "manager") return "Manager";
  if (key === "validator") return "Validator";
  if (key === "service") return "Service";
  return "User";
}

function canEditColumn(role, column, schema) {
  if (!column) return false;
  if (column.semantic && serverManagedSemantics.includes(column.semantic)) return false;
  const permissions = permissionsFor(role);
  if (!permissions) return false;
  if (permissions.editableGroupKeys === "all") return true;
  const group = (schema?.groups || []).find((entry) => entry.id === column.groupId);
  if (!group) return false;
  return permissions.editableGroupKeys.includes(group.groupKey);
}

function getEditableColumnKeys(role, schema) {
  return (schema?.columns || [])
    .filter((column) => !column.hidden && canEditColumn(role, column, schema))
    .map((column) => column.key);
}

function inspectCellEdit(role, schema, keys) {
  const unknown = [];
  const blocked = [];
  for (const key of keys) {
    const column = (schema?.columns || []).find((entry) => entry.key === key);
    if (!column) {
      unknown.push(key);
      continue;
    }
    if (!canEditColumn(role, column, schema)) blocked.push(key);
  }
  return { unknown, blocked };
}

function editDenialMessage(role, schema) {
  const permissions = permissionsFor(role);
  const title = roleTitle(role);
  if (!permissions || permissions.editableGroupKeys === "all") {
    return `Your role (${title}) cannot edit that column.`;
  }
  const labels = permissions.editableGroupKeys.map((key) => {
    const group = (schema?.groups || []).find((entry) => entry.groupKey === key);
    return group?.label || key;
  });
  if (labels.length === 1) return `Your role (${title}) can edit ${labels[0]} only.`;
  if (!labels.length) return `Your role (${title}) cannot edit these columns.`;
  return `Your role (${title}) can edit ${labels.join(", ")} only.`;
}

function notifiesOnEdit(role) {
  const permissions = permissionsFor(role);
  return Boolean(permissions) && permissions.editableGroupKeys !== "all";
}

function hasPermission(role, flag) {
  return Boolean(permissionsFor(role)?.[flag]);
}

module.exports = {
  ROLE_PERMISSIONS,
  serverManagedSemantics,
  normalizeRole,
  permissionsFor,
  roleTitle,
  canEditColumn,
  getEditableColumnKeys,
  inspectCellEdit,
  editDenialMessage,
  notifiesOnEdit,
  hasPermission,
};
