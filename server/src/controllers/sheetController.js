const zlib = require("zlib");
const pool = require("../config/db");
const { inspectCellEdit } = require("../../../shared/permissions");
const { ensureSchema } = require("../database/ensure");
const { parseWorkbook } = require("../excel/parseWorkbook");
const { buildWorkbook } = require("../excel/exportWorkbook");
const {
  cleanLabel,
  columnWidth,
  prettifyFileName,
  semanticFor,
  strictValue,
} = require("../excel/sheetSchema");
const { logActivity } = require("../sheet/activityLog");
const { notifySheetEvent, shouldNotifyEdit } = require("./notificationController");
const { readySchema } = require("../sheet/prepareSheet");
const { resolveSchema } = require("../sheet/resolveSchema");
const { applyRekeys, ensureSystemColumns } = require("../sheet/systemColumns");
const {
  TABS,
  appTimeZone,
  groupKeyForColumn,
  matchesQuery,
  matchesTab,
  overlayData,
  readSemantic,
  todayISO,
  writeDays,
} = require("../sheet/rowRules");

const INSERT_BATCH = 1000;

function sendJson(req, res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const acceptsGzip = String(req.headers["accept-encoding"] || "").includes("gzip");
  if (!acceptsGzip || body.length < 1024) {
    res.status(status).json(payload);
    return;
  }
  zlib.gzip(body, (error, zipped) => {
    if (error || res.headersSent) {
      if (!res.headersSent) res.status(500).json({ error: "Unable to load rows." });
      return;
    }
    res.status(status);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Vary", "Accept-Encoding");
    res.send(zipped);
  });
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function loadDataset(datasetId) {
  const result = await pool.query(
    `
    SELECT id, name, description, source_file_name, row_count, column_count, schema,
           created_by, created_at, updated_at, is_deleted
    FROM datasets
    WHERE id = $1 AND is_deleted = FALSE
    `,
    [datasetId]
  );
  return result.rows[0] || null;
}

function presentDataset(dataset, schema) {
  return {
    id: dataset.id,
    name: dataset.name,
    sourceFileName: dataset.source_file_name || "",
    rowCount: Number.isInteger(dataset.row_count) ? dataset.row_count : undefined,
    columnCount: schema.columns.length,
    schema,
    timezone: appTimeZone(),
    createdAt: dataset.created_at,
    updatedAt: dataset.updated_at,
    uploadedBy: dataset.created_by,
  };
}

async function legacyData(recordId) {
  const values = await pool.query(
    `
    SELECT f.field_key, rv.value
    FROM record_values rv
    JOIN fields f ON f.id = rv.field_id AND f.is_deleted = FALSE
    WHERE rv.record_id = $1
    `,
    [recordId]
  );
  const data = {};
  values.rows.forEach((entry) => {
    if (entry.value == null || entry.value === "") return;
    data[entry.field_key] = entry.value;
  });
  return data;
}

async function readRowData(row) {
  if (row.data && typeof row.data === "object" && !Array.isArray(row.data)) return { ...row.data };
  return legacyData(row.id);
}

const importSheet = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "An Excel file is required." });
  const original = String(req.file.originalname || "");
  const lower = original.toLowerCase();
  if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
    return res.status(400).json({ error: "Upload an .xlsx or .xls file." });
  }
  const userId = Number(req.user?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    await ensureSchema();
    const parsed = parseWorkbook(req.file.buffer);
    const prepared = ensureSystemColumns(parsed.schema);
    const schema = prepared.schema;
    const importedRows = parsed.rows.map((data) => applyRekeys(data, prepared.rekeys));
    const name = prettifyFileName(original);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `
        INSERT INTO datasets (name, source_file_name, row_count, column_count, schema, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6)
        RETURNING id, name, source_file_name, row_count, column_count, schema, created_by, created_at, updated_at
        `,
        [
          name,
          original.slice(0, 255),
          importedRows.length,
          schema.columns.length,
          JSON.stringify(schema),
          userId,
        ]
      );
      const dataset = inserted.rows[0];
      for (let offset = 0; offset < importedRows.length; offset += INSERT_BATCH) {
        const chunk = importedRows.slice(offset, offset + INSERT_BATCH).map((data, index) => ({
          position: offset + index,
          data,
        }));
        await client.query(
          `
          INSERT INTO records (dataset_id, created_by, updated_by, position, data, is_deleted)
          SELECT $1, $2, $2, item.position, item.data, FALSE
          FROM jsonb_to_recordset($3::jsonb) AS item(position int, data jsonb)
          `,
          [dataset.id, userId, JSON.stringify(chunk)]
        );
      }
      await client.query("COMMIT");
      res.status(201).json({
        dataset: presentDataset(dataset, schema),
        rows: importedRows.length,
        columns: schema.columns.length,
        groups: schema.groups.length,
        autoNamed: parsed.autoNamed,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const status = error.status || 500;
    console.error("Import workbook error:", error);
    res.status(status).json({
      error: status === 500 ? "Unable to import this workbook." : error.message,
    });
  }
};

const getSheet = async (req, res) => {
  try {
    await ensureSchema();
    const dataset = await loadDataset(Number(req.params.id));
    if (!dataset) return res.status(404).json({ error: "Dataset not found" });
    const schema = await readySchema(dataset, resolveSchema);
    const presented = presentDataset(dataset, schema);
    if (presented.rowCount == null) {
      const count = await pool.query(
        "SELECT COUNT(*)::int AS count FROM records WHERE dataset_id = $1 AND is_deleted = FALSE",
        [dataset.id]
      );
      presented.rowCount = count.rows[0]?.count || 0;
    }
    res.json({ dataset: presented });
  } catch (error) {
    console.error("Get sheet error:", error);
    res.status(500).json({ error: "Unable to load this dataset." });
  }
};

const getRows = async (req, res) => {
  try {
    await ensureSchema();
    const dataset = await loadDataset(Number(req.params.id));
    if (!dataset) return res.status(404).json({ error: "Dataset not found" });
    const schema = await readySchema(dataset, resolveSchema);
    const today = todayISO();
    const result = await pool.query(
      `
      SELECT id, position, data
      FROM records
      WHERE dataset_id = $1 AND is_deleted = FALSE
      ORDER BY position ASC NULLS LAST, id ASC
      `,
      [dataset.id]
    );
    const needsLegacy = result.rows.some((row) => !row.data);
    let legacyById = new Map();
    if (needsLegacy) {
      const packed = await pool.query(
        `
        SELECT r.id,
               COALESCE(jsonb_object_agg(f.field_key, rv.value) FILTER (WHERE f.field_key IS NOT NULL AND rv.value IS NOT NULL AND rv.value <> ''), '{}'::jsonb) AS data
        FROM records r
        LEFT JOIN record_values rv ON rv.record_id = r.id
        LEFT JOIN fields f ON f.id = rv.field_id AND f.is_deleted = FALSE
        WHERE r.dataset_id = $1 AND r.is_deleted = FALSE AND r.data IS NULL
        GROUP BY r.id
        `,
        [dataset.id]
      );
      legacyById = new Map(packed.rows.map((row) => [row.id, row.data || {}]));
    }
    const tab = String(req.query.tab || "all");
    const query = String(req.query.q || "").trim().toLowerCase().slice(0, 200);
    if (!TABS.includes(tab)) return res.status(400).json({ error: "Unknown sheet tab." });
    const rows = result.rows
      .map((row, index) => ({
        id: row.id,
        position: row.position == null ? index : row.position,
        data: row.data || legacyById.get(row.id) || {},
      }))
      .filter((row) => matchesTab(row.data, schema, tab, today))
      .filter((row) => matchesQuery(overlayData(row.data, schema, today), query))
      .map((row) => ({ ...row, data: overlayData(row.data, schema, today) }));
    sendJson(req, res, 200, { rows });
  } catch (error) {
    console.error("Get rows error:", error);
    res.status(500).json({ error: "Unable to load rows." });
  }
};

const createSheetRow = async (req, res) => {
  const userId = Number(req.user?.id);
  try {
    await ensureSchema();
    const dataset = await loadDataset(Number(req.params.id));
    if (!dataset) return res.status(404).json({ error: "Dataset not found" });
    const positionResult = await pool.query(
      "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM records WHERE dataset_id = $1 AND is_deleted = FALSE",
      [dataset.id]
    );
    const schema = await readySchema(dataset, resolveSchema);
    const today = todayISO();
    const position = positionResult.rows[0]?.position || 0;
    const inserted = await pool.query(
      `
      INSERT INTO records (dataset_id, created_by, updated_by, position, data, is_deleted)
      VALUES ($1, $2, $2, $3, '{}'::jsonb, FALSE)
      RETURNING id, position, data
      `,
      [dataset.id, userId, position]
    );
    await pool.query(
      `
      UPDATE datasets
      SET row_count = (SELECT COUNT(*)::int FROM records WHERE dataset_id = $1 AND is_deleted = FALSE),
          updated_at = CURRENT_TIMESTAMP,
          updated_by = $2
      WHERE id = $1
      `,
      [dataset.id, userId]
    );
    const created = inserted.rows[0];
    res.status(201).json({ row: { ...created, data: overlayData(created.data || {}, schema, today) } });
  } catch (error) {
    console.error("Create row error:", error);
    res.status(500).json({ error: "Unable to add a row." });
  }
};

const patchSheetRow = async (req, res) => {
  const userId = Number(req.user?.id);
  const values = req.body?.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return res.status(400).json({ error: "values are required." });
  }
  try {
    await ensureSchema();
    const dataset = await loadDataset(Number(req.params.id));
    if (!dataset) return res.status(404).json({ error: "Dataset not found" });
    const schema = await readySchema(dataset, resolveSchema);
    const today = todayISO();
    const rowResult = await pool.query(
      `
      SELECT id, position, data
      FROM records
      WHERE id = $1 AND dataset_id = $2 AND is_deleted = FALSE
      `,
      [Number(req.params.rowId), dataset.id]
    );
    if (!rowResult.rows.length) return res.status(404).json({ error: "Row not found" });
    const edit = inspectCellEdit(req.user?.role, schema, Object.keys(values));
    if (edit.unknown.length) {
      return res.status(400).json({ error: "Unknown column", unknownFields: edit.unknown });
    }
    if (edit.blocked.length) {
      return res.status(403).json({
        error: "You do not have permission to edit these fields",
        code: "FORBIDDEN",
        requiredPermission: "canEditColumn",
        blockedFields: edit.blocked,
      });
    }
    const data = await readRowData(rowResult.rows[0]);
    const normalized = {};
    const changes = [];
    for (const [key, raw] of Object.entries(values)) {
      const column = schema.columns.find((entry) => entry.key === key);
      if (!column) throw fail(400, "That column is not on this sheet.");
      const next = strictValue(column, raw);
      const previous = data[key] == null ? "" : String(data[key]);
      normalized[key] = next;
      if (previous !== String(next ?? "")) {
        changes.push({
          key,
          fromValue: previous,
          toValue: next,
          groupKey: groupKeyForColumn(schema, column),
        });
      }
      if (next === "") delete data[key];
      else data[key] = next;
    }
    writeDays(data, schema);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `
        UPDATE records
        SET data = $1::jsonb, updated_by = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING id, position, data
        `,
        [JSON.stringify(data), userId, rowResult.rows[0].id]
      );
      for (const change of changes) {
        await logActivity(client, {
          datasetId: dataset.id,
          rowId: rowResult.rows[0].id,
          actorId: userId,
          actorName: req.user?.name || "User",
          action: "cell_edit",
          columnKey: change.key,
          fromValue: change.fromValue,
          toValue: change.toValue,
        });
      }
      await client.query("UPDATE datasets SET updated_at = CURRENT_TIMESTAMP, updated_by = $2 WHERE id = $1", [
        dataset.id,
        userId,
      ]);
      await client.query("COMMIT");
      const saved = updated.rows[0];
      if (shouldNotifyEdit(req.user?.role, schema, changes)) {
        const touched = changes.find((change) => ["amc", "schedule_services", "follow_up"].includes(change.groupKey));
        const group = (schema.groups || []).find((entry) => entry.groupKey === touched?.groupKey);
        const customer = readSemantic(saved.data, schema, "customer_name") || "a customer";
        notifySheetEvent({
          actorId: userId,
          actorName: req.user?.name || "Service",
          datasetId: dataset.id,
          rowId: saved.id,
          customerName: customer,
          type: "service_edit",
          summary: `${req.user?.name || "Service"} updated ${group?.label || "a group"} on ${customer}`,
        }).catch((error) => console.error("Notification error:", error));
      }
      res.json({
        row: { ...saved, data: overlayData(saved.data, schema, today) },
        values: normalized,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const status = error.status || 500;
    console.error("Patch row error:", error);
    res.status(status).json({ error: status === 500 ? "Unable to save this cell." : error.message });
  }
};

const deleteSheetRow = async (req, res) => {
  const userId = Number(req.user?.id);
  try {
    await ensureSchema();
    const dataset = await loadDataset(Number(req.params.id));
    if (!dataset) return res.status(404).json({ error: "Dataset not found" });
    const updated = await pool.query(
      `
      UPDATE records
      SET is_deleted = TRUE, updated_by = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND dataset_id = $2 AND is_deleted = FALSE
      RETURNING id
      `,
      [Number(req.params.rowId), dataset.id, userId]
    );
    if (!updated.rows.length) return res.status(404).json({ error: "Row not found" });
    await pool.query(
      `
      UPDATE datasets
      SET row_count = (SELECT COUNT(*)::int FROM records WHERE dataset_id = $1 AND is_deleted = FALSE),
          updated_at = CURRENT_TIMESTAMP,
          updated_by = $2
      WHERE id = $1
      `,
      [dataset.id, userId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error("Delete row error:", error);
    res.status(500).json({ error: "Unable to delete this row." });
  }
};

const renameColumn = async (req, res) => {
  const userId = Number(req.user?.id);
  const label = cleanLabel(req.body?.label);
  if (!label) return res.status(400).json({ error: "A column name is required." });
  try {
    await ensureSchema();
    const dataset = await loadDataset(Number(req.params.id));
    if (!dataset) return res.status(404).json({ error: "Dataset not found" });
    const schema = await readySchema(dataset, resolveSchema);
    const column = schema.columns.find((entry) => entry.key === req.params.key);
    if (!column) return res.status(404).json({ error: "Column not found" });
    if (column.system) {
      return res.status(403).json({
        error: "System columns cannot be renamed",
        code: "FORBIDDEN",
        requiredPermission: "canEditSchema",
      });
    }
    column.label = label.slice(0, 255);
    column.autoNamed = false;
    column.width = columnWidth(column.type, column.label);
    const semantic = semanticFor(column.label);
    if (semantic) column.semantic = semantic;
    else delete column.semantic;
    const updated = await pool.query(
      `
      UPDATE datasets
      SET schema = $2::jsonb, column_count = $3, updated_at = CURRENT_TIMESTAMP, updated_by = $4
      WHERE id = $1
      RETURNING id, name, source_file_name, row_count, column_count, schema, created_by, created_at, updated_at
      `,
      [dataset.id, JSON.stringify(schema), schema.columns.length, userId]
    );
    res.json({ dataset: presentDataset(updated.rows[0], schema), column });
  } catch (error) {
    console.error("Rename column error:", error);
    res.status(500).json({ error: "Unable to rename this column." });
  }
};

const exportSheet = async (req, res) => {
  try {
    await ensureSchema();
    const dataset = await loadDataset(Number(req.params.id));
    if (!dataset) return res.status(404).json({ error: "Dataset not found" });
    const schema = await readySchema(dataset, resolveSchema);
    const today = todayISO();
    const result = await pool.query(
      `
      SELECT r.id, r.position, r.data,
             CASE WHEN r.data IS NULL THEN (
               SELECT COALESCE(jsonb_object_agg(f.field_key, rv.value) FILTER (WHERE f.field_key IS NOT NULL AND rv.value IS NOT NULL AND rv.value <> ''), '{}'::jsonb)
               FROM record_values rv
               JOIN fields f ON f.id = rv.field_id AND f.is_deleted = FALSE
               WHERE rv.record_id = r.id
             ) ELSE NULL END AS legacy_data
      FROM records r
      WHERE r.dataset_id = $1 AND r.is_deleted = FALSE
      ORDER BY r.position ASC NULLS LAST, r.id ASC
      `,
      [dataset.id]
    );
    const rows = result.rows.map((row) => ({
      data: overlayData(row.data || row.legacy_data || {}, schema, today),
    }));
    const buffer = buildWorkbook(schema, rows);
    const fileName = `${prettifyFileName(dataset.name)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName.replace(/"/g, "")}"`);
    res.send(buffer);
  } catch (error) {
    console.error("Export sheet error:", error);
    res.status(500).json({ error: "Unable to export this dataset." });
  }
};

module.exports = {
  importSheet,
  getSheet,
  getRows,
  createSheetRow,
  patchSheetRow,
  deleteSheetRow,
  renameColumn,
  exportSheet,
};
