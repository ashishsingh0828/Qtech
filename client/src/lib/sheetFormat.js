const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STATUS_TONE = {
  Yes: "emerald",
  Active: "emerald",
  "Verified OK": "emerald",
  Acknowledged: "emerald",
  "Expiring in 30 days": "amber",
  Pending: "amber",
  "AMC Due": "amber",
  "Proposal Sent": "sapphire",
  No: "ruby",
  Expired: "ruby",
  Declined: "ruby",
  Unknown: "stone",
  "Not Due": "stone",
};

export function statusTone(value) {
  return STATUS_TONE[String(value || "")] || "";
}

export function shiftISO(iso, days) {
  const [year, month, day] = String(iso).split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function dueTone(value, timeZone) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return "stone";
  const today = todayISO(timeZone);
  const iso = text.slice(0, 10);
  if (iso < today) return "ruby";
  if (iso <= shiftISO(today, 15)) return "amber";
  return "stone";
}

export function todayISO(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const bag = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${bag.year}-${bag.month}-${bag.day}`;
}

export function formatStamp(value, timeZone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value == null ? "" : String(value);
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return formatted.replace(/\b(am|pm)\b/gi, (token) => token.toUpperCase());
}

export function formatCell(column, value, timeZone) {
  if (value == null || value === "") return "";
  if (column?.type === "datetime") return formatStamp(value, timeZone);
  if (column?.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const [year, month, day] = String(value).split("-").map(Number);
    const label = MONTHS[month - 1];
    if (!label) return String(value);
    return `${String(day).padStart(2, "0")} ${label} ${year}`;
  }
  if (column?.type === "decimal" || column?.semantic === "total_pms") {
    const number = Number(value);
    if (Number.isFinite(number)) return String(Math.round(number));
  }
  if (column?.type === "integer") return String(value).replace(/,/g, "");
  return String(value);
}

export function rawCell(value) {
  if (value == null) return "";
  return String(value);
}

export function orderedColumns(schema) {
  return (schema?.columns || []).filter((column) => !column.hidden).slice().sort((left, right) => left.order - right.order);
}

export function pinnedCount(columns) {
  const index = columns.findIndex((column) => column.semantic === "customer_name");
  return index >= 0 ? index + 1 : 0;
}
