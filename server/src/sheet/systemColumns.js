const { columnWidth, normalizedLabel } = require("../excel/sheetSchema");

const GROUP_LABELS = {
  data_validation: "Data Validation",
  instrument_details: "Instrument Details",
  amc: "AMC",
  follow_up: "Follow up",
};

const SYSTEM_COLUMNS = [
  { key: "validated_at", label: "Validated At", groupKey: "data_validation", type: "datetime", semantic: "validated_at" },
  { key: "rejection_reason", label: "Rejection Reason", groupKey: "data_validation", type: "text", semantic: "rejection_reason" },
  { key: "verified", label: "Verified", groupKey: "data_validation", type: "status", semantic: "verified" },
  { key: "verified_by", label: "Verified By", groupKey: "data_validation", type: "text", semantic: "verified_by" },
  { key: "verified_at", label: "Verified At", groupKey: "data_validation", type: "datetime", semantic: "verified_at" },
  { key: "warranty_live", label: "Warranty", groupKey: "instrument_details", type: "status", semantic: "warranty_live", computed: true },
  { key: "amc_status", label: "AMC Status", groupKey: "amc", type: "status", semantic: "amc_status" },
  { key: "proposal_sent_at", label: "Proposal Sent At", groupKey: "amc", type: "date", semantic: "proposal_sent_at" },
  { key: "ack_response", label: "Acknowledgement", groupKey: "amc", type: "status", semantic: "ack_response" },
  { key: "ack_note", label: "Acknowledgement Note", groupKey: "amc", type: "text", semantic: "ack_note" },
  { key: "ack_at", label: "Acknowledged At", groupKey: "amc", type: "datetime", semantic: "ack_at" },
  { key: "next_follow_up", label: "Next Follow Up", groupKey: "follow_up", type: "date", semantic: "next_follow_up" },
];

function cloneSchema(schema) {
  return {
    groups: (schema?.groups || []).map((group) => ({ ...group })),
    columns: (schema?.columns || []).map((column) => ({ ...column })),
  };
}

function reindex(schema) {
  const groups = schema.groups.slice().sort((left, right) => left.order - right.order);
  let order = 0;
  groups.forEach((group) => {
    const columns = schema.columns
      .filter((column) => column.groupId === group.id)
      .sort((left, right) => left.order - right.order);
    group.startIndex = order;
    group.span = columns.length;
    columns.forEach((column) => {
      column.order = order;
      order += 1;
    });
  });
  schema.groups = groups.map((group, index) => ({ ...group, order: index }));
}

function ensureGroup(schema, groupKey) {
  const existing = schema.groups.find((group) => group.groupKey === groupKey);
  if (existing) return existing;
  const group = {
    id: `g${schema.groups.length}`,
    label: GROUP_LABELS[groupKey] || groupKey,
    groupKey,
    order: schema.groups.length,
    startIndex: 0,
    span: 0,
    tint: groupKey,
  };
  while (schema.groups.some((entry) => entry.id === group.id)) {
    group.id = `${group.id}s`;
  }
  schema.groups.push(group);
  return group;
}

function ensureSystemColumns(schema) {
  const next = cloneSchema(schema);
  const rekeys = [];
  SYSTEM_COLUMNS.forEach((definition, index) => {
    const group = ensureGroup(next, definition.groupKey);
    const label = normalizedLabel(definition.label);
    const column = next.columns.find(
      (entry) => entry.key === definition.key || entry.semantic === definition.semantic || normalizedLabel(entry.label) === label
    );
    if (column) {
      if (column.key !== definition.key) rekeys.push({ from: column.key, to: definition.key });
      column.key = definition.key;
      column.semantic = definition.semantic;
      column.system = true;
      column.type = definition.type;
      column.groupId = group.id;
      column.hidden = false;
      if (definition.computed) column.computed = true;
      else delete column.computed;
      return;
    }
    const created = {
      key: definition.key,
      label: definition.label,
      originalLabel: definition.label,
      autoNamed: false,
      groupId: group.id,
      order: 100000 + index,
      type: definition.type,
      width: columnWidth(definition.type, definition.label),
      hidden: false,
      semantic: definition.semantic,
      system: true,
    };
    if (definition.computed) created.computed = true;
    next.columns.push(created);
  });
  reindex(next);
  next.systemVersion = 1;
  return { schema: next, rekeys };
}

function systemReady(schema) {
  if (schema?.systemVersion !== 1) return false;
  return SYSTEM_COLUMNS.every((definition) => {
    const column = (schema.columns || []).find((entry) => entry.key === definition.key && entry.semantic === definition.semantic && entry.system);
    const group = (schema.groups || []).find((entry) => entry.id === column?.groupId);
    return Boolean(column && group?.groupKey === definition.groupKey);
  });
}

function applyRekeys(data, rekeys) {
  const next = { ...(data || {}) };
  rekeys.forEach(({ from, to }) => {
    if (!Object.prototype.hasOwnProperty.call(next, from)) return;
    next[to] = next[from];
    delete next[from];
  });
  delete next.warranty_live;
  return next;
}

module.exports = {
  SYSTEM_COLUMNS,
  ensureSystemColumns,
  applyRekeys,
  systemReady,
};
