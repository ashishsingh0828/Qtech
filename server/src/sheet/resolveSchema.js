const pool = require("../config/db");
const { cleanLabel, columnWidth, emptySchema, groupKeyFor, headerType, semanticFor } = require("../excel/sheetSchema");

function mapFieldType(field) {
  const hinted = headerType(field.name);
  if (hinted) return hinted;
  if (field.field_type === "number") return "decimal";
  if (field.field_type === "date") return "date";
  if (field.field_type === "boolean") return "yesno";
  if (field.field_type === "email") return "email";
  return "text";
}

async function legacySchema(datasetId) {
  const fields = await pool.query(
    `
    SELECT name, field_key, field_type, position
    FROM fields
    WHERE dataset_id = $1 AND is_deleted = FALSE
    ORDER BY position ASC, id ASC
    `,
    [datasetId]
  );
  if (!fields.rows.length) return emptySchema();
  const columns = fields.rows.map((field, order) => {
    const label = cleanLabel(field.name) || field.field_key;
    const type = mapFieldType(field);
    const column = {
      key: field.field_key,
      label,
      originalLabel: label,
      autoNamed: false,
      groupId: "g0",
      order,
      type,
      width: columnWidth(type, label),
      hidden: false,
    };
    const semantic = semanticFor(label);
    if (semantic) column.semantic = semantic;
    return column;
  });
  return {
    groups: [
      {
        id: "g0",
        label: "General",
        groupKey: groupKeyFor("General"),
        order: 0,
        startIndex: 0,
        span: columns.length,
        tint: "general",
      },
    ],
    columns,
  };
}

async function resolveSchema(dataset) {
  if (dataset.schema && Array.isArray(dataset.schema.columns)) return dataset.schema;
  return legacySchema(dataset.id);
}

module.exports = { resolveSchema };
