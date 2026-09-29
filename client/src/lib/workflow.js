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

export function readAny(fields, record, names) {
  for (const name of names) {
    const value = readField(fields, record, name);
    if (value) return value;
  }
  return "";
}

export function workflowColumn(field) {
  const key = compactName(field?.name);
  if (key === "status" || key === "finalstatus") return "status";
  if (key === "validated" || key === "validatedyesno") return "validated";
  if (key === "verificationstatus") return "verification";
  if (key === "proposalsent") return "proposal";
  if (key === "followupdate") return "followup";
  if (key === "days") return "days";
  if (key === "totalpms") return "totalpms";
  return "";
}

export function isScheduleDetail(field) {
  const key = compactName(field?.name);
  if (key === "totalpms") return false;
  return /^pms\d+$/.test(key) || /^pmdate\d*$/.test(key);
}

export function validatedValue(fields, record) {
  return readAny(fields, record, ["Validated (Yes/No)", "Validated"]);
}

export function matchesWorkflowTab(fields, record, tab) {
  if (!tab || tab === "all") return true;
  const validated = isYes(validatedValue(fields, record));
  if (tab === "validation") return !validated;
  if (tab === "overdue") {
    const due = readAny(fields, record, ["By when Data will be validated"]).slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    return !validated && /^\d{4}-\d{2}-\d{2}$/.test(due) && due < today;
  }
  if (tab === "verification") {
    const status = readAny(fields, record, ["Verification Status"]).trim().toLowerCase();
    return validated && status !== "verified ok";
  }
  if (tab === "followup") {
    const status = readAny(fields, record, ["Status", "Final Status"]);
    return isOutOfWarranty(status);
  }
  return true;
}

export function nextDueDate(fields, record) {
  const dates = [];
  for (const field of fields || []) {
    if (!/^pmdate\d*$/.test(compactName(field.name))) continue;
    const value = String(record?.values?.[field.field_key] || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) dates.push(value);
  }
  if (!dates.length) return "";
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = dates.filter((value) => value >= today).sort();
  return upcoming[0] || dates.sort()[0];
}

export function contractDays(fields, record) {
  const start = readAny(fields, record, ["Start Date"]).slice(0, 10);
  const end = readAny(fields, record, ["End Date"]).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return "";
  const days = Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000);
  return Number.isFinite(days) ? String(days) : "";
}

export function groupTone(name) {
  const key = String(name || "").trim().toLowerCase();
  if (key.includes("customer")) return "slate";
  if (key.includes("validation")) return "amber";
  if (key === "amc") return "blue";
  if (key.includes("schedule")) return "violet";
  if (key.includes("instrument")) return "indigo";
  if (key.includes("follow")) return "emerald";
  if (key.includes("breakdown") || key.includes("compaint") || key.includes("complaint")) return "rose";
  return "slate";
}
