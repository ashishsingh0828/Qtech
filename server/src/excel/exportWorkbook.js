const XLSX = require("xlsx");

function exportCell(column, value) {
  if (value == null || value === "") return "";
  if (column.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const [year, month, day] = String(value).split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  }
  if ((column.type === "integer" || column.type === "decimal") && typeof value === "number") return value;
  if ((column.type === "integer" || column.type === "decimal") && /^-?\d+(\.\d+)?$/.test(String(value))) {
    return Number(value);
  }
  return value;
}

function buildWorkbook(schema, rows) {
  const columns = Array.isArray(schema?.columns) ? [...schema.columns].sort((a, b) => a.order - b.order) : [];
  const groups = Array.isArray(schema?.groups) ? [...schema.groups].sort((a, b) => a.order - b.order) : [];
  const groupRow = columns.map(() => "");
  const headerRow = columns.map((column) => (column.autoNamed ? "" : column.label));
  groups.forEach((group) => {
    if (!columns[group.startIndex]) return;
    groupRow[group.startIndex] = group.label;
  });
  const dataRows = rows.map((row) => columns.map((column) => exportCell(column, row?.data?.[column.key])));
  const sheet = XLSX.utils.aoa_to_sheet([groupRow, headerRow, ...dataRows]);
  const merges = groups
    .filter((group) => group.span > 1)
    .map((group) => ({
      s: { r: 0, c: group.startIndex },
      e: { r: 0, c: group.startIndex + group.span - 1 },
    }));
  if (merges.length) sheet["!merges"] = merges;
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Sheet1");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx", cellDates: true });
}

module.exports = { buildWorkbook };
