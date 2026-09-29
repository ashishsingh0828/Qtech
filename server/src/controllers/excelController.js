const pool = require("../config/db");
const XLSX = require("xlsx");
const { canonicalRole } = require("../middleware/auth");
const { normalizeFieldKey, normalizeCellValue, listAccessibleFields } = require("./datasetController");
const { ensureSchema } = require("../database/ensure");

function cellToString(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const shifted = new Date(value.getTime() + value.getTimezoneOffset() * 60 * 1000);
    const year = shifted.getFullYear();
    const month = String(shifted.getMonth() + 1).padStart(2, "0");
    const day = String(shifted.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).trim();
}

function readSheet(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { headers: [], rows: [], sheetName: "" };
  }

  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: true,
    blankrows: false,
  });

  if (!matrix.length) {
    return { headers: [], rows: [] };
  }

  const seen = new Map();
  const headers = matrix[0].map((cell, index) => {
    const label = cellToString(cell) || `Column ${index + 1}`;
    const count = seen.get(label) || 0;
    seen.set(label, count + 1);
    return count === 0 ? label : `${label} (${count + 1})`;
  });

  const rows = matrix
    .slice(1)
    .map((row) => headers.map((_, index) => cellToString(row[index])))
    .filter((row) => row.some((cell) => cell !== ""));

  return { headers, rows, sheetName };
}

function matchHeader(header, fields) {
  const raw = header.trim().toLowerCase();
  const key = normalizeFieldKey(header);
  return (
    fields.find((field) => {
      const name = String(field.name || "").trim().toLowerCase();
      const fieldKey = String(field.field_key || "").trim().toLowerCase();
      return raw === name || raw === fieldKey || (key && key === fieldKey);
    }) || null
  );
}

function inferFieldType(values) {
  const present = values.map((value) => String(value || "").trim()).filter(Boolean);
  if (!present.length) return "text";
  if (present.every((value) => /^(true|false|yes|no)$/i.test(value))) return "boolean";
  if (present.every((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))) return "date";
  if (present.every((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) return "email";
  if (present.every((value) => Number.isFinite(Number(value)))) return "number";
  return "text";
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
    loaded.fields = await listAccessibleFields(datasetId, req.user);

    const { headers, rows, sheetName } = readSheet(req.file.buffer);
    if (!headers.length) {
      return res.status(400).json({ error: "The spreadsheet has no header row" });
    }

    const matchedFields = [];
    const unmatchedHeaders = [];

    headers.forEach((header) => {
      const field = matchHeader(header, loaded.fields);
      if (!field) {
        unmatchedHeaders.push(header);
        return;
      }
      matchedFields.push({
        header,
        field_id: field.id,
        name: field.name,
        field_key: field.field_key,
        field_type: field.field_type,
      });
    });

    const preview = rows.slice(0, 5).map((row) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = row[index] ?? "";
      });
      return record;
    });

    res.json({
      totalRows: rows.length,
      headers,
      preview,
      matchedFields,
      unmatchedHeaders,
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
  const createMissing = String(req.body?.createMissing || "").toLowerCase() === "true";

  if (createMissing && canonicalRole(req.user?.role) !== "Admin") {
    return res.status(403).json({ error: "Only an Admin can create columns" });
  }

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
      SELECT id, name, field_key, field_type, position, is_required
      FROM fields
      WHERE dataset_id = $1 AND is_deleted = FALSE
      ORDER BY position ASC, id ASC
      `,
      [datasetId]
    );

    let fields = fieldsResult.rows;
    if (canonicalRole(req.user?.role) !== "Admin") {
      const accessible = await listAccessibleFields(datasetId, req.user);
      const editableIds = new Set(
        accessible.filter((field) => field.can_edit).map((field) => Number(field.id))
      );
      fields = fields.filter((field) => editableIds.has(Number(field.id)));
    }
    const usedKeys = new Set(fields.map((field) => field.field_key));
    let nextPosition =
      fields.reduce((max, field) => Math.max(max, Number(field.position) || 0), -1) + 1;

    const mappings = [];

    for (const [index, header] of headers.entries()) {
      let field = matchHeader(header, fields);
      if (!field && createMissing) {
        const columnValues = rows.map((row) => row[index]);
        const fieldType = inferFieldType(columnValues);
        const fieldKey = uniqueFieldKey(normalizeFieldKey(header) || "column", usedKeys);
        const inserted = await client.query(
          `
          INSERT INTO fields (dataset_id, name, field_key, field_type, position, is_required)
          VALUES ($1, $2, $3, $4, $5, FALSE)
          RETURNING id, name, field_key, field_type, position, is_required
          `,
          [datasetId, header.slice(0, 255), fieldKey, fieldType, nextPosition]
        );
        field = inserted.rows[0];
        fields.push(field);
        nextPosition += 1;
      }
      if (field) {
        mappings.push({ index, field });
      }
    }

    if (!mappings.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "None of the spreadsheet headers match this dataset. Create missing columns to import them.",
      });
    }

    let importedCount = 0;
    const maxPosition = await client.query(
      `
      SELECT COALESCE(MAX(position), -1) AS max_position
      FROM records
      WHERE dataset_id = $1
      `,
      [datasetId]
    );
    let nextRowPosition = Number(maxPosition.rows[0].max_position) + 1;

    for (const row of rows) {
      const cells = [];
      for (const mapping of mappings) {
        const raw = row[mapping.index];
        if (raw == null || String(raw).trim() === "") continue;
        const normalized = normalizeCellValue(mapping.field, raw);
        if (normalized == null || normalized === "") continue;
        cells.push({ fieldId: mapping.field.id, value: normalized });
      }

      if (!cells.length) continue;

      const insertedRecord = await client.query(
        `
        INSERT INTO records (dataset_id, created_by, updated_by, position)
        VALUES ($1, $2, $2, $3)
        RETURNING id
        `,
        [datasetId, createdBy, nextRowPosition]
      );
      nextRowPosition += 1;
      const recordId = insertedRecord.rows[0].id;
      const placeholders = [];
      const params = [];

      cells.forEach((cell, cellIndex) => {
        const offset = cellIndex * 4;
        placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
        params.push(recordId, cell.fieldId, cell.value, createdBy);
      });

      await client.query(
        `
        INSERT INTO record_values (record_id, field_id, value, updated_by)
        VALUES ${placeholders.join(", ")}
        `,
        params
      );
      importedCount += 1;
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
    res.json({ success: true, importedCount });
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
