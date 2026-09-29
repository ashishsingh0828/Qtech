const MASTER_FIELDS = [
  { name: "SR No", field_type: "text", aliases: ["sr. no", "sr no.", "sr number", "s.r. no"] },
  { name: "Customer Name", field_type: "text", aliases: ["customer", "client name"] },
  { name: "City", field_type: "text", aliases: [] },
  { name: "Contact Person", field_type: "text", aliases: ["contact name"] },
  { name: "Mobile No", field_type: "text", aliases: ["mobile", "mobile number", "mobile no.", "phone", "phone no", "contact number"] },
  { name: "Email", field_type: "email", aliases: ["email id", "e-mail", "email address"] },
  { name: "Location", field_type: "text", aliases: ["site location"] },
  { name: "Contract Type", field_type: "text", aliases: ["contract", "amc / cmc / warranty"] },
  { name: "Equipment Name", field_type: "text", aliases: ["instrument name", "equipment"] },
  { name: "Serial No", field_type: "text", aliases: ["serial number", "serial no.", "equipment serial no"] },
  { name: "Start Date", field_type: "date", aliases: ["amc start date", "contract start date"] },
  { name: "Month", field_type: "text", aliases: [] },
  { name: "Year", field_type: "text", aliases: [] },
  { name: "End Date", field_type: "date", aliases: ["amc end date", "contract end date"] },
  { name: "Status", field_type: "text", aliases: ["warranty status", "amc status"] },
  { name: "Validated", field_type: "text", aliases: ["is validated"] },
  { name: "Validated By", field_type: "text", aliases: ["validated by name"] },
  { name: "Validation Date", field_type: "text", aliases: ["validated on", "validation timestamp"] },
  { name: "Verified By", field_type: "text", aliases: ["verified by name", "manager name"] },
  { name: "Verified Date", field_type: "text", aliases: ["verified on"] },
  { name: "Verification Status", field_type: "text", aliases: ["verified status"] },
  { name: "Proposal Sent", field_type: "text", aliases: ["proposal status"] },
  { name: "Proposal Sent Date", field_type: "date", aliases: ["proposal date"] },
  { name: "Proposal Acknowledged", field_type: "text", aliases: ["proposal ack", "acknowledged"] },
  { name: "Acknowledged By", field_type: "text", aliases: ["ack by", "acknowledged by name"] },
  { name: "Follow-up Date", field_type: "date", aliases: ["follow up date", "followup date", "next follow-up", "next contact date"] },
  { name: "Total PMS", field_type: "text", aliases: ["total pm", "pms total"] },
  { name: "PMS 1", field_type: "text", aliases: ["pms1", "pm 1"] },
  { name: "PM Date 1", field_type: "date", aliases: ["pm date1", "pms date 1", "pm date-1"] },
  { name: "PMS 2", field_type: "text", aliases: ["pms2", "pm 2"] },
  { name: "PM Date 2", field_type: "date", aliases: ["pm date2", "pms date 2", "pm date-2"] },
  { name: "Customer Complaint", field_type: "text", aliases: ["complaint"] },
  { name: "Service Remarks", field_type: "text", aliases: ["remarks", "service remark"] },
];

function compact(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 255);
}

const SPEC_BY_KEY = new Map();
for (const spec of MASTER_FIELDS) {
  SPEC_BY_KEY.set(compact(spec.name), spec);
  SPEC_BY_KEY.set(compact(slug(spec.name)), spec);
  for (const alias of spec.aliases) SPEC_BY_KEY.set(compact(alias), spec);
}

function specForHeader(header) {
  return SPEC_BY_KEY.get(compact(header)) || null;
}

function canonicalFieldName(header) {
  return specForHeader(header)?.name || "";
}

function fieldMatchesSpec(field, spec) {
  if (!field || !spec) return false;
  const nameKey = compact(field.name);
  const key = compact(field.field_key);
  if (nameKey === compact(spec.name) || key === compact(slug(spec.name))) return true;
  return spec.aliases.some((alias) => nameKey === compact(alias) || key === compact(alias));
}

function findMasterField(fields, header) {
  const spec = specForHeader(header);
  if (!spec) return null;
  return (fields || []).find((field) => !field.is_deleted && fieldMatchesSpec(field, spec)) || null;
}

function uniqueKey(base, used) {
  const root = base || "column";
  let key = root;
  let suffix = 2;
  while (used.has(key)) {
    key = `${root}_${suffix}`;
    suffix += 1;
  }
  used.add(key);
  return key.slice(0, 255);
}

async function ensureMasterFields(db, datasetId) {
  const existing = await db.query(
    `
    SELECT id, name, field_key, field_type, position, is_deleted
    FROM fields
    WHERE dataset_id = $1
    `,
    [datasetId]
  );
  const usedKeys = new Set(existing.rows.map((field) => field.field_key));
  const active = existing.rows.filter((field) => !field.is_deleted);
  let nextPosition = existing.rows.reduce((max, field) => Math.max(max, Number(field.position) || 0), -1) + 1;
  const missing = [];

  for (const spec of MASTER_FIELDS) {
    if (active.some((field) => fieldMatchesSpec(field, spec))) continue;
    missing.push({
      name: spec.name,
      fieldType: spec.field_type,
      fieldKey: uniqueKey(slug(spec.name) || "column", usedKeys),
      position: nextPosition,
    });
    nextPosition += 1;
  }

  if (!missing.length) return active;

  const params = [];
  const placeholders = missing.map((spec, index) => {
    const offset = index * 5;
    params.push(datasetId, spec.name, spec.fieldKey, spec.fieldType, spec.position);
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, FALSE)`;
  });
  await db.query(
    `
    INSERT INTO fields (dataset_id, name, field_key, field_type, position, is_required)
    VALUES ${placeholders.join(", ")}
    ON CONFLICT (dataset_id, field_key) DO NOTHING
    `,
    params
  );

  const refreshed = await db.query(
    `
    SELECT id, name, field_key, field_type, position, is_deleted
    FROM fields
    WHERE dataset_id = $1 AND is_deleted = FALSE
    ORDER BY position ASC, id ASC
    `,
    [datasetId]
  );
  return refreshed.rows;
}

module.exports = {
  MASTER_FIELDS,
  specForHeader,
  canonicalFieldName,
  findMasterField,
  ensureMasterFields,
};
