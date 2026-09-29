const { canEditColumn, notifiesOnEdit } = require("../../../shared/permissions");
const { groupKeyFor, semanticFor } = require("../excel/sheetSchema");

function fieldAccess(field) {
  const groupKey = groupKeyFor(field?.group_name || "General");
  const column = {
    key: field?.field_key || field?.key || "",
    groupId: "g0",
  };
  const semantic = semanticFor(field?.name);
  if (semantic) column.semantic = semantic;
  return {
    column,
    schema: {
      groups: [{ id: "g0", groupKey, label: field?.group_name || "General" }],
      columns: [column],
    },
  };
}

function roleCanEditField(user, field) {
  const built = fieldAccess(field);
  return canEditColumn(user?.role, built.column, built.schema);
}

function notifiesLeadership(user, field) {
  return notifiesOnEdit(user?.role) && roleCanEditField(user, field);
}

module.exports = { roleCanEditField, notifiesLeadership };
