export const FIELD_TYPES = ["text", "number", "date", "boolean", "email"];

export function toFieldKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function inputTypeFor(fieldType) {
  if (fieldType === "number") return "number";
  if (fieldType === "date") return "date";
  if (fieldType === "email") return "email";
  return "text";
}

export function cellText(field, value) {
  if (value == null || value === "") return "";
  if (field.field_type === "boolean") {
    return value === true || value === "true" ? "Yes" : "No";
  }
  return String(value);
}

export function draftFromValue(field, value) {
  if (field.field_type === "boolean") {
    if (value === true || value === "true") return "true";
    if (value === false || value === "false") return "false";
    return "";
  }
  return value == null ? "" : String(value);
}

export function draftsMatch(field, value, draft) {
  return draftFromValue(field, value) === String(draft ?? "");
}

export function statusTone(value) {
  const key = String(value ?? "").trim().toLowerCase();
  if (key === "active" || key === "expired" || key === "pending" || key === "completed" || key === "validated") {
    return key;
  }
  return "";
}

export function typeLabel(fieldType) {
  if (fieldType === "number") return "Number";
  if (fieldType === "date") return "Date";
  if (fieldType === "boolean") return "Boolean";
  if (fieldType === "email") return "Email";
  return "Text";
}

export function columnLetter(index) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

export function compareCell(field, left, right) {
  const leftRaw = left.values?.[field.field_key];
  const rightRaw = right.values?.[field.field_key];
  const leftEmpty = leftRaw == null || leftRaw === "";
  const rightEmpty = rightRaw == null || rightRaw === "";
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;
  if (field.field_type === "number") {
    const leftNumber = Number(leftRaw);
    const rightNumber = Number(rightRaw);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber;
    }
  }
  return cellText(field, leftRaw).localeCompare(cellText(field, rightRaw), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function formatTimestamp(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function auditValue(value) {
  if (value == null || value === "") return "empty";
  if (value === "true") return "Yes";
  if (value === "false") return "No";
  return String(value);
}

export function canEditField(field) {
  return field?.can_edit !== false;
}
