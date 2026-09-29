const SENTINELS = new Set(["na", "n/a", "-"]);

function cleanLabel(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/:+$/g, "")
    .trim();
}

function normalizedLabel(value) {
  return cleanLabel(value).toLowerCase();
}

function groupKeyFor(label) {
  const cleaned = normalizedLabel(label);
  if (!cleaned || cleaned === "general") return "general";
  if (cleaned.includes("customer")) return "customer_detail";
  if (cleaned.includes("instrument")) return "instrument_details";
  if (cleaned.includes("validation")) return "data_validation";
  if (cleaned.includes("schedule")) return "schedule_services";
  if (cleaned.includes("compl") || cleaned.includes("compaint")) return "complaint";
  if (cleaned.includes("breakdown")) return "breakdown_calls";
  if (cleaned.startsWith("amc")) return "amc";
  if (cleaned.includes("follow")) return "follow_up";
  const slug = cleaned.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "general";
}

function slugKey(label) {
  const slug = normalizedLabel(label).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "column";
}

function uniqueKey(label, used) {
  const root = slugKey(label);
  let key = root;
  let suffix = 2;
  while (used.has(key)) {
    key = `${root}_${suffix}`;
    suffix += 1;
  }
  used.add(key);
  return key;
}

function semanticFor(label) {
  const name = normalizedLabel(label);
  if (name === "customer name") return "customer_name";
  if (name === "start date") return "start_date";
  if (name === "end date") return "end_date";
  if (name === "days") return "days";
  if (name === "validated by") return "validated_by";
  if (name.includes("validated") && name.includes("yes/no")) return "validated";
  if (name === "validated") return "validated";
  if (name.includes("by when")) return "validation_due";
  if (name === "final status") return "final_status";
  if (name === "status") return "status";
  if (name === "total pms") return "total_pms";
  const pms = name.match(/^pms\s*(\d+)$/);
  if (pms) return `pms:${Number(pms[1])}`;
  const pmDate = name.match(/^pm date\s*(\d*)$/);
  if (pmDate) return `pm_date:${pmDate[1] ? Number(pmDate[1]) : 1}`;
  return undefined;
}

function headerType(label) {
  const name = normalizedLabel(label);
  if (/\(yes\/no\)/.test(name)) return "yesno";
  if (name.includes("serial")) return "text";
  if (name.includes("mobile") || name.includes("phone")) return "phone";
  if (name.includes("email") || name.includes("e-mail") || /\bmail\b/.test(name)) return "email";
  if (/^sr\.?\s*no$/.test(name) || name === "month" || name === "year" || name === "days") return "integer";
  if (name === "contract type") return "category";
  if (name === "status" || name === "final status") return "status";
  if (/^pm date\s*\d*$/.test(name) || /^pms\s*\d+$/.test(name) || name.includes("date") || name.includes("when")) return "date";
  return "";
}

function plainNumberString(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value ?? "").trim();
  if (Number.isSafeInteger(value)) return String(value);
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 1e-6 && Math.abs(rounded) < 1e15) return String(rounded);
  return String(value);
}

function dateToISO(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  const shifted = new Date(value.getTime() + value.getTimezoneOffset() * 60 * 1000);
  const year = shifted.getFullYear();
  const month = String(shifted.getMonth() + 1).padStart(2, "0");
  const day = String(shifted.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function serialToISO(serial) {
  if (typeof serial !== "number" || !Number.isFinite(serial)) return "";
  if (serial < 20000 || serial > 80000) return "";
  const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
  if (Number.isNaN(utc.getTime())) return "";
  return utc.toISOString().slice(0, 10);
}

function sentinelText(text) {
  const key = text.toLowerCase();
  if (key === "na") return "NA";
  if (key === "n/a") return "N/A";
  if (key === "-") return "-";
  return "";
}

function isBlank(value) {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function looksEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

function looksYesNo(value) {
  return /^(yes|no|y|n|true|false)$/i.test(String(value).trim());
}

function looksInteger(value) {
  if (typeof value === "number") return Number.isInteger(value);
  return /^-?\d+$/.test(String(value).trim().replace(/,/g, ""));
}

function looksDecimal(value) {
  if (typeof value === "number") return Number.isFinite(value);
  return /^-?\d+(\.\d+)?$/.test(String(value).trim().replace(/,/g, ""));
}

function looksDate(value) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === "number") return Boolean(serialToISO(value));
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return true;
  if (SENTINELS.has(text.toLowerCase())) return true;
  return false;
}

function inferType(samples) {
  const values = samples.filter((value) => !isBlank(value)).slice(0, 50);
  if (!values.length) return "text";
  const dates = values.filter((value) => looksDate(value));
  if (dates.length === values.length) return "date";
  if (values.every((value) => looksYesNo(value))) return "yesno";
  if (values.every((value) => looksEmail(value))) return "email";
  if (values.every((value) => looksInteger(value))) return "integer";
  if (values.every((value) => looksDecimal(value))) return "decimal";
  return "text";
}

function columnWidth(type, label) {
  const fromLabel = Math.min(280, Math.max(112, cleanLabel(label).length * 8 + 28));
  if (type === "date") return Math.max(132, fromLabel);
  if (type === "integer" || type === "decimal") return Math.max(96, Math.min(fromLabel, 140));
  if (type === "phone") return Math.max(140, fromLabel);
  return fromLabel;
}

function lenientValue(column, raw) {
  if (isBlank(raw)) return "";
  if (raw instanceof Date) {
    const iso = dateToISO(raw);
    return column.type === "date" ? iso : iso;
  }
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  if (typeof raw === "number") {
    if (column.type === "integer") return Number.isInteger(raw) ? raw : Math.round(raw);
    if (column.type === "decimal") return raw;
    if (column.type === "date") return serialToISO(raw) || plainNumberString(raw);
    return plainNumberString(raw);
  }
  const text = String(raw).trim();
  if (!text) return "";
  if (column.type === "date") {
    const sentinel = sentinelText(text);
    if (sentinel) return sentinel;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const stamped = text.match(/^(\d{4}-\d{2}-\d{2})[ T]\d{2}:\d{2}/);
    if (stamped) return stamped[1];
    const asNumber = Number(text);
    if (Number.isFinite(asNumber)) {
      const iso = serialToISO(asNumber);
      if (iso) return iso;
    }
    return text;
  }
  if (column.type === "integer") {
    const digits = text.replace(/,/g, "");
    if (/^-?\d+(\.0+)?$/.test(digits)) return Number(digits);
    return text;
  }
  if (column.type === "decimal") {
    const digits = text.replace(/,/g, "");
    if (/^-?\d+(\.\d+)?$/.test(digits)) return Number(digits);
    return text;
  }
  if (column.type === "yesno") {
    const key = text.toLowerCase();
    if (["yes", "y", "true"].includes(key)) return "Yes";
    if (["no", "n", "false"].includes(key)) return "No";
    return text;
  }
  if (column.type === "phone") {
    if (/^\d+(\.0+)?$/.test(text)) return plainNumberString(Number(text));
    return text.replace(/,/g, "");
  }
  return text;
}

function strictValue(column, raw) {
  if (isBlank(raw)) return "";
  const value = lenientValue(column, raw);
  if (value === "") return "";
  if (column.type === "integer" && typeof value !== "number") {
    const error = new Error(`${column.label} must be a whole number.`);
    error.status = 400;
    throw error;
  }
  if (column.type === "decimal" && typeof value !== "number") {
    const error = new Error(`${column.label} must be a number.`);
    error.status = 400;
    throw error;
  }
  if (column.type === "date") {
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text) || SENTINELS.has(text.toLowerCase()) || ["NA", "N/A", "-"].includes(text)) {
      return text;
    }
    const error = new Error(`${column.label} must be a date (YYYY-MM-DD) or NA.`);
    error.status = 400;
    throw error;
  }
  if (column.type === "yesno" && value !== "Yes" && value !== "No") {
    const error = new Error(`${column.label} must be Yes or No.`);
    error.status = 400;
    throw error;
  }
  if (column.type === "email" && value && !looksEmail(value)) {
    const error = new Error(`${column.label} must be an email address.`);
    error.status = 400;
    throw error;
  }
  return value;
}

function prettifyFileName(fileName) {
  const base = String(fileName || "Dataset").replace(/\.(xlsx|xls)$/i, "");
  const pretty = base.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return (pretty || "Dataset").slice(0, 255);
}

function autoNamePrefix(groupLabel) {
  const cleaned = cleanLabel(groupLabel);
  const cut = cleaned.split(/[/(]/)[0];
  return cleanLabel(cut) || cleaned || "Column";
}

function emptySchema() {
  return { groups: [], columns: [] };
}

module.exports = {
  cleanLabel,
  groupKeyFor,
  uniqueKey,
  semanticFor,
  headerType,
  inferType,
  columnWidth,
  lenientValue,
  strictValue,
  prettifyFileName,
  autoNamePrefix,
  plainNumberString,
  isBlank,
  emptySchema,
};
