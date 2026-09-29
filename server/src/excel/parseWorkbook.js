const XLSX = require("xlsx");
const {
  autoNamePrefix,
  cleanLabel,
  columnWidth,
  groupKeyFor,
  headerType,
  inferType,
  isBlank,
  lenientValue,
  semanticFor,
  uniqueKey,
} = require("./sheetSchema");

function fail(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function readCell(cell) {
  if (!cell || cell.v == null || cell.v === "") return null;
  if (cell.v instanceof Date) {
    return Number.isNaN(cell.v.getTime()) ? null : cell.v;
  }
  if (typeof cell.v === "number") return Number.isFinite(cell.v) ? cell.v : null;
  if (typeof cell.v === "boolean") return cell.v ? "Yes" : "No";
  const text = String(cell.v).trim();
  return text || null;
}

function cellKey(row, column) {
  return `${row},${column}`;
}

function countValues(sheet) {
  if (!sheet) return 0;
  let count = 0;
  for (const key of Object.keys(sheet)) {
    if (key.charAt(0) === "!") continue;
    if (readCell(sheet[key]) != null) count += 1;
  }
  return count;
}

function headerText(value) {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return cleanLabel(`${year}-${month}-${day}`);
  }
  if (typeof value === "number") return cleanLabel(String(value));
  return cleanLabel(value);
}

function parseSheet(sheet) {
  const values = new Map();
  let maxRow = -1;
  let maxCol = -1;
  for (const key of Object.keys(sheet)) {
    if (key.charAt(0) === "!") continue;
    const parsed = readCell(sheet[key]);
    if (parsed == null) continue;
    const address = XLSX.utils.decode_cell(key);
    values.set(cellKey(address.r, address.c), parsed);
    if (address.r > maxRow) maxRow = address.r;
    if (address.c > maxCol) maxCol = address.c;
  }

  const merges = (Array.isArray(sheet["!merges"]) ? sheet["!merges"] : []).filter((merge) => {
    if (!merge?.s || !merge?.e) return false;
    return values.has(cellKey(merge.s.r, merge.s.c));
  });

  for (const merge of merges) {
    if (merge.s.r <= 1 && merge.e.c > maxCol) maxCol = merge.e.c;
    if (merge.e.r > maxRow) maxRow = merge.e.r;
  }

  if (maxCol < 0 || maxRow < 0) throw fail("No data found in this workbook.");

  function rowFilled(row) {
    let count = 0;
    for (let column = 0; column <= maxCol; column += 1) {
      if (values.has(cellKey(row, column))) count += 1;
    }
    return count;
  }

  let headerAt = 0;
  while (headerAt <= maxRow && rowFilled(headerAt) === 0) headerAt += 1;
  if (headerAt > maxRow) throw fail("No data found in this workbook.");

  const mergesOnHeader = merges.some((merge) => merge.s.r === headerAt && merge.e.c > merge.s.c);
  const nextFilled = headerAt + 1 <= maxRow ? rowFilled(headerAt + 1) : 0;
  const twoTier = headerAt + 1 <= maxRow && (mergesOnHeader || nextFilled > rowFilled(headerAt));
  const subAt = twoTier ? headerAt + 1 : headerAt;
  const dataAt = subAt + 1;

  const groupLabels = [];
  let carried = "";
  for (let column = 0; column <= maxCol; column += 1) {
    if (!twoTier) {
      groupLabels.push("General");
      continue;
    }
    const banner = headerText(values.get(cellKey(headerAt, column)));
    if (banner) carried = banner;
    groupLabels.push(carried || "General");
  }

  const subLabels = [];
  for (let column = 0; column <= maxCol; column += 1) {
    subLabels.push(headerText(values.get(cellKey(subAt, column))));
  }

  const groups = [];
  for (let column = 0; column <= maxCol; column += 1) {
    const label = groupLabels[column];
    const previous = groups[groups.length - 1];
    if (previous && previous.label === label) {
      previous.span += 1;
      previous.columns.push(column);
    } else {
      groups.push({
        label,
        columns: [column],
        span: 1,
        startIndex: column,
      });
    }
  }

  const named = subLabels.map((label) => label);
  groups.forEach((group) => {
    const unnamed = group.columns.filter((column) => !named[column]);
    if (unnamed.length === 1) {
      named[unnamed[0]] = group.label;
    } else if (unnamed.length > 1) {
      const prefix = autoNamePrefix(group.label);
      unnamed.forEach((column, index) => {
        named[column] = `${prefix} ${index + 1}`;
      });
    }
  });

  const samples = named.map(() => []);
  for (let row = dataAt; row <= maxRow; row += 1) {
    for (let column = 0; column <= maxCol; column += 1) {
      const value = values.get(cellKey(row, column));
      if (value == null || samples[column].length >= 50) continue;
      samples[column].push(value);
    }
  }

  const usedKeys = new Set();
  const columns = named.map((label, order) => {
    const group = groups.find((entry) => entry.columns.includes(order));
    const hinted = headerType(label);
    const type = hinted || inferType(samples[order]);
    const semantic = semanticFor(label);
    const column = {
      key: uniqueKey(label, usedKeys),
      label,
      originalLabel: subLabels[order] || "",
      autoNamed: !subLabels[order],
      groupId: "",
      order,
      type,
      width: columnWidth(type, label),
      hidden: false,
    };
    if (semantic) column.semantic = semantic;
    column.groupId = `g${groups.indexOf(group)}`;
    return column;
  });

  const schemaGroups = groups.map((group, order) => ({
    id: `g${order}`,
    label: group.label,
    groupKey: groupKeyFor(group.label),
    order,
    startIndex: group.startIndex,
    span: group.span,
    tint: groupKeyFor(group.label),
  }));

  const rows = [];
  for (let row = dataAt; row <= maxRow; row += 1) {
    const data = {};
    let hasValue = false;
    columns.forEach((column) => {
      const raw = values.get(cellKey(row, column.order));
      const stored = lenientValue(column, raw);
      if (isBlank(stored)) return;
      data[column.key] = stored;
      hasValue = true;
    });
    if (hasValue) rows.push(data);
  }

  if (!columns.length) throw fail("No data found in this workbook.");

  return {
    schema: { groups: schemaGroups, columns },
    rows,
    autoNamed: columns.filter((column) => column.autoNamed).length,
  };
}

function parseWorkbook(buffer) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
      cellNF: false,
      cellStyles: false,
      dense: false,
    });
  } catch {
    throw fail("This workbook is corrupt or password-protected.");
  }

  const names = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames : [];
  if (!names.length) throw fail("No data found in this workbook.");

  let chosen = null;
  let best = 0;
  for (const name of names) {
    const score = countValues(workbook.Sheets[name]);
    if (score > best) {
      best = score;
      chosen = workbook.Sheets[name];
    }
  }
  if (!chosen || best === 0) throw fail("No data found in this workbook.");
  return parseSheet(chosen);
}

module.exports = { parseWorkbook };
