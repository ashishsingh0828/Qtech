const pool = require("../config/db");
const XLSX = require("xlsx");
const { normalizeFieldKey, normalizeCellValue, listAccessibleFields } = require("./datasetController");
const { ensureSchema } = require("../database/ensure");

const RECORD_BATCH = 1000;
const VALUE_BATCH = 1000;

function cellToString(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const shifted = new Date(value.getTime() + value.getTimezoneOffset() * 60 * 1000);
    const year = shifted.getFullYear();
    const month = String(shifted.getMonth() + 1).padStart(2, "0");
    const day = String(shifted.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text.trim();
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part?.text || "").join("").trim();
    }
  }
  return String(value).trim();
}

function sheetBounds(sheet) {
  let maxRow = 0;
  let maxCol = 0;
  let found = false;
  for (const key of Object.keys(sheet)) {
    if (key.charAt(0) === "!") continue;
    const text = cellToString(sheet[key]?.v);
    if (!text) continue;
    const address = XLSX.utils.decode_cell(key);
    found = true;
    if (address.r > maxRow) maxRow = address.r;
    if (address.c > maxCol) maxCol = address.c;
  }
  if (!found) return null;
  return { maxRow, maxCol };
}

function readSheet(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [], sheetName: "" };

  const sheet = workbook.Sheets[sheetName];
  const bounds = sheetBounds(sheet);
  if (!bounds) return { headers: [], rows: [], sheetName };

  sheet["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: bounds.maxRow, c: bounds.maxCol },
  });

  const matrix = XLSX.utils.sheet_to_json(sheet, { defval: "", header: 1 });
  if (!matrix.length) return { headers: [], rows: [], sheetName };

  const headerRow = Array.isArray(matrix[0]) ? matrix[0] : [];
  const valued = new Set();
  let lastUsed = -1;
  for (let index = 0; index < headerRow.length; index += 1) {
    if (cellToString(headerRow[index])) lastUsed = index;
  }
  for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
    const source = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
    for (let index = 0; index < source.length; index += 1) {
      if (!cellToString(source[index])) continue;
      valued.add(index);
      if (index > lastUsed) lastUsed = index;
    }
  }
  if (lastUsed < 0) return { headers: [], rows: [], sheetName };

  const kept = [];
  for (let index = 0; index <= lastUsed; index += 1) {
    const text = cellToString(headerRow[index]);
    if (!text && !valued.has(index)) continue;
    kept.push({ index, label: text || `Column ${index + 1}` });
  }
  if (!kept.length) return { headers: [], rows: [], sheetName };

  const seen = new Map();
  const headers = kept.map((column) => {
    const count = seen.get(column.label) || 0;
    seen.set(column.label, count + 1);
    return count === 0 ? column.label : `${column.label} (${count + 1})`;
  });

  const rows = [];
  for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
    const source = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
    const row = [];
    let hasValue = false;
    for (const column of kept) {
      const text = cellToString(source[column.index]);
      row.push(text);
      if (text) hasValue = true;
    }
    rows.push(hasValue ? row : null);
  }
  while (rows.length && rows[rows.length - 1] === null) rows.pop();

  return {
    headers,
    rows: rows.map((row) => row || headers.map(() => "")),
    sheetName,
  };
}

function matchHeader(header, fields) {
  const raw = header.trim().toLowerCase();
  const key = normalizeFieldKey(header);
  const shortName = header.slice(0, 255).trim().toLowerCase();
  return (
    fields.find((field) => {
      const name = String(field.name || "").trim().toLowerCase();
      const fieldKey = String(field.field_key || "").trim().toLowerCase();
      return raw === name || shortName === name || raw === fieldKey || (key && key === fieldKey);
    }) || null
  );
}

function uniqueFieldKey(baseKey, used) {
  const root = baseKey || "column";
  let key = root;
  let suffix = 2;
  while (used.has(key)) {
    key = `${root}_${suffix}`;
    suffix += 1;
  }
  used.add(key);
  return key.slice(0, 255);
}

function storedValue(field, raw) {
  if (raw == null || String(raw).trim() === "") return "";
  const normalized = normalizeCellValue(field, raw);
  if (normalized == null || normalized === "") return String(raw).trim();
  return normalized;
}

async function loadDatasetFields(datasetId) {
  const datasetResult = await pool.query(
    "SELECT id, name FROM datasets WHERE id = $1 AND is_deleted = FALSE",
    [datasetId]
  );
  if (!datasetResult.rows.length) return null;

  const fieldsResult = await pool.query(
    `
    SELECT id, name, field_key, field_type, position, is_required
    FROM fields
    WHERE dataset_id = $1 AND is_deleted = FALSE
    ORDER BY position ASC, id ASC
    `,
    [datasetId]
  );

  return { dataset: datasetResult.rows[0], fields: fieldsResult.rows };
}

function parseDatasetId(value) {
  const datasetId = Number(value);
  if (!Number.isInteger(datasetId) || datasetId <= 0) return null;
  return datasetId;
}

const previewExcel = async (req, res) => {
  const datasetId = parseDatasetId(req.params.id);
  if (!datasetId) return res.status(400).json({ error: "Invalid dataset id" });
  if (!req.file) return res.status(400).json({ error: "An Excel file is required" });

  try {
    const loaded = await loadDatasetFields(datasetId);
    if (!loaded) return res.status(404).json({ error: "Dataset not found" });

    const { headers, rows, sheetName } = readSheet(req.file.buffer);
    if (!headers.length) {
      return res.status(400).json({ error: "The spreadsheet has no header row" });
    }

    res.json({
      success: true,
      totalColumns: headers.length,
      totalRows: rows.length,
      headers,
      sheetName: sheetName || "Sheet1",
    });
  } catch (error) {
    console.error("Preview excel error:", error);
    res.status(400).json({ error: "Unable to read this Excel file" });
  }
};

const importExcel = async (req, res) => {
  const datasetId = parseDatasetId(req.params.id);
  const createdBy = Number(req.user?.id);
  if (!datasetId) return res.status(400).json({ error: "Invalid dataset id" });
  if (!Number.isInteger(createdBy) || createdBy <= 0) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (!req.file) return res.status(400).json({ error: "An Excel file is required" });

  await ensureSchema();

  let headers = [];
  let rows = [];
  try {
    const sheet = readSheet(req.file.buffer);
    headers = sheet.headers;
    rows = sheet.rows;
  } catch (error) {
    console.error("Import excel read error:", error);
    return res.status(400).json({ error: "Unable to read this Excel file" });
  }

  if (!headers.length) {
    return res.status(400).json({ error: "The spreadsheet has no header row" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const datasetResult = await client.query(
      "SELECT id FROM datasets WHERE id = $1 AND is_deleted = FALSE",
      [datasetId]
    );
    if (!datasetResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Dataset not found" });
    }

    const fieldsResult = await client.query(
      `
      SELECT id, name, field_key, field_type, position, is_required, is_deleted
      FROM fields
      WHERE dataset_id = $1
      ORDER BY position ASC, id ASC
      `,
      [datasetId]
    );

    const fields = fieldsResult.rows.filter((field) => !field.is_deleted);
    const usedKeys = new Set(fieldsResult.rows.map((field) => field.field_key));
    let nextPosition =
      fieldsResult.rows.reduce((max, field) => Math.max(max, Number(field.position) || 0), -1) + 1;
    const claimedFieldIds = new Set();
    const pending = [];
    const columns = headers.map((header) => ({ header, field: null }));

    for (const column of columns) {
      const field = matchHeader(column.header, fields);
      if (field && !claimedFieldIds.has(Number(field.id))) {
        claimedFieldIds.add(Number(field.id));
        column.field = field;
        continue;
      }
      const fieldKey = uniqueFieldKey(normalizeFieldKey(column.header) || "column", usedKeys);
      const spec = {
        header: column.header,
        name: column.header.slice(0, 255),
        fieldKey,
        position: nextPosition,
      };
      nextPosition += 1;
      pending.push(spec);
      column.spec = spec;
    }

    if (pending.length) {
      const params = [];
      const placeholders = pending.map((spec, index) => {
        const offset = index * 5;
        params.push(datasetId, spec.name, spec.fieldKey, "text", spec.position);
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, FALSE)`;
      });
      const inserted = await client.query(
        `
        INSERT INTO fields (dataset_id, name, field_key, field_type, position, is_required)
        VALUES ${placeholders.join(", ")}
        RETURNING id, name, field_key, field_type, position, is_required
        `,
        params
      );
      const byKey = new Map(inserted.rows.map((field) => [field.field_key, field]));
      for (const column of columns) {
        if (column.spec) column.field = byKey.get(column.spec.fieldKey);
      }
    }

    const mapped = columns.map((column) => column.field).filter(Boolean);
    if (mapped.length !== headers.length) {
      await client.query("ROLLBACK");
      return res.status(500).json({ error: "Unable to create every spreadsheet column" });
    }

    const maxPosition = await client.query(
      `
      SELECT COALESCE(MAX(position), -1) AS max_position
      FROM records
      WHERE dataset_id = $1
      `,
      [datasetId]
    );
    let nextRowPosition = Number(maxPosition.rows[0].max_position) + 1;
    const recordIds = [];

    for (let offset = 0; offset < rows.length; offset += RECORD_BATCH) {
      const count = Math.min(RECORD_BATCH, rows.length - offset);
      const positions = Array.from({ length: count }, (_, index) => nextRowPosition + index);
      const inserted = await client.query(
        `
        INSERT INTO records (dataset_id, created_by, updated_by, position)
        SELECT $1::int, $2::int, $2::int, pos
        FROM UNNEST($3::int[]) AS pos
        RETURNING id, position
        `,
        [datasetId, createdBy, positions]
      );
      const created = inserted.rows.sort((left, right) => Number(left.position) - Number(right.position));
      if (created.length !== count) {
        await client.query("ROLLBACK");
        return res.status(500).json({ error: "Unable to insert every spreadsheet row" });
      }
      for (const record of created) recordIds.push(record.id);
      nextRowPosition += count;
    }

    const valueRecordIds = [];
    const valueFieldIds = [];
    const valueTexts = [];
    rows.forEach((row, rowIndex) => {
      const recordId = recordIds[rowIndex];
      mapped.forEach((field, columnIndex) => {
        const value = storedValue(field, row[columnIndex]);
        if (!value) return;
        valueRecordIds.push(recordId);
        valueFieldIds.push(field.id);
        valueTexts.push(value);
      });
    });

    for (let offset = 0; offset < valueTexts.length; offset += VALUE_BATCH) {
      const end = offset + VALUE_BATCH;
      await client.query(
        `
        INSERT INTO record_values (record_id, field_id, value, updated_by)
        SELECT rec, fld, val, $4::int
        FROM UNNEST($1::int[], $2::int[], $3::text[]) AS input(rec, fld, val)
        `,
        [
          valueRecordIds.slice(offset, end),
          valueFieldIds.slice(offset, end),
          valueTexts.slice(offset, end),
          createdBy,
        ]
      );
    }

    await client.query(
      `
      UPDATE datasets
      SET updated_at = CURRENT_TIMESTAMP, updated_by = $2
      WHERE id = $1
      `,
      [datasetId, createdBy]
    );

    await client.query("COMMIT");
    res.json({ success: true, totalColumns: headers.length, totalRows: rows.length });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback error:", rollbackError);
    }
    console.error("Import excel error:", error);
    res.status(500).json({ error: "Unable to import this Excel file" });
  } finally {
    client.release();
  }
};

const exportExcel = async (req, res) => {
  const datasetId = parseDatasetId(req.params.id);
  if (!datasetId) return res.status(400).json({ error: "Invalid dataset id" });

  try {
    const loaded = await loadDatasetFields(datasetId);
    if (!loaded) return res.status(404).json({ error: "Dataset not found" });
    loaded.fields = await listAccessibleFields(datasetId, req.user);

    const recordsResult = await pool.query(
      `
      SELECT id
      FROM records
      WHERE dataset_id = $1 AND is_deleted = FALSE
      ORDER BY position ASC NULLS LAST, created_at ASC, id ASC
      `,
      [datasetId]
    );

    const valuesResult = await pool.query(
      `
      SELECT rv.record_id, rv.field_id, rv.value
      FROM record_values rv
      JOIN records r ON r.id = rv.record_id
      WHERE r.dataset_id = $1 AND r.is_deleted = FALSE
      `,
      [datasetId]
    );

    const valuesByRecord = new Map();
    for (const row of valuesResult.rows) {
      if (!valuesByRecord.has(row.record_id)) valuesByRecord.set(row.record_id, new Map());
      valuesByRecord.get(row.record_id).set(row.field_id, row.value ?? "");
    }

    const headerRow = loaded.fields.map((field) => field.name);
    const dataRows = recordsResult.rows.map((record) => {
      const cellMap = valuesByRecord.get(record.id) || new Map();
      return loaded.fields.map((field) => {
        const value = cellMap.get(field.id);
        if (value == null || value === "") return "";
        if (field.field_type === "boolean") {
          if (value === "true") return "Yes";
          if (value === "false") return "No";
        }
        return String(value);
      });
    });

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Dataset");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    const filename = `${String(loaded.dataset.name || "dataset")
      .replace(/[^\w.\- ]+/g, "")
      .trim() || "dataset"}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error("Export excel error:", error);
    res.status(500).json({ error: "Unable to export this dataset" });
  }
};

module.exports = {
  previewExcel,
  importExcel,
  exportExcel,
};
