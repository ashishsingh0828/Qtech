const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatCell(column, value) {
  if (value == null || value === "") return "";
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
