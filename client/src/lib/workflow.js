export function compactName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function findField(fields, name) {
  const key = compactName(name);
  return (fields || []).find((field) => compactName(field.name) === key || compactName(field.field_key) === key) || null;
}

export function readField(fields, record, name) {
  const field = findField(fields, name);
  if (!field) return "";
  const value = record?.values?.[field.field_key];
  return value == null ? "" : String(value);
}

export function isYes(value) {
  const key = String(value || "").trim().toLowerCase();
  return key === "yes" || key === "true";
}

export function isOutOfWarranty(status) {
  const key = String(status || "").trim().toLowerCase();
  return key === "out of warranty" || key === "expired";
}

export function workflowColumn(field) {
  const key = compactName(field?.name);
  if (key === "status") return "status";
  if (key === "validated") return "validated";
  if (key === "verificationstatus") return "verification";
  if (key === "proposalsent") return "proposal";
  if (key === "followupdate") return "followup";
  return "";
}

export function matchesWorkflowTab(fields, record, tab) {
  if (!tab || tab === "all") return true;
  if (tab === "validation") return !isYes(readField(fields, record, "Validated"));
  if (tab === "verification") {
    const status = readField(fields, record, "Verification Status").trim().toLowerCase();
    return isYes(readField(fields, record, "Validated")) && status !== "verified ok";
  }
  if (tab === "followup") return isOutOfWarranty(readField(fields, record, "Status"));
  return true;
}
