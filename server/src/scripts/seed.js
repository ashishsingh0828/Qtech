const bcrypt = require("bcryptjs");
const pool = require("../config/db");

const DATASET_NAME = "Equipment Service & Maintenance";

const FIELDS = [
  { name: "Customer Name", fieldKey: "customer_name", fieldType: "text" },
  { name: "City", fieldKey: "city", fieldType: "text" },
  { name: "Equipment Name", fieldKey: "equipment_name", fieldType: "text" },
  { name: "Serial No", fieldKey: "serial_no", fieldType: "text" },
  { name: "Status", fieldKey: "status", fieldType: "text" },
  { name: "PM Date", fieldKey: "pm_date", fieldType: "date" },
];

const SAMPLE_ROWS = [
  {
    customer_name: "Northwind Clinic",
    city: "Austin",
    equipment_name: "Centrifuge C-400",
    serial_no: "SN-10021",
    status: "Due",
    pm_date: "2026-04-12",
  },
  {
    customer_name: "Harbor Labs",
    city: "Seattle",
    equipment_name: "Autoclave A2",
    serial_no: "SN-10088",
    status: "In Service",
    pm_date: "2026-06-03",
  },
  {
    customer_name: "Metro Imaging",
    city: "Denver",
    equipment_name: "Ultrasound U9",
    serial_no: "SN-10142",
    status: "Scheduled",
    pm_date: "2026-08-19",
  },
];

async function ensureRole(client, name, description) {
  const existing = await client.query(
    "SELECT id FROM roles WHERE lower(name) = lower($1) LIMIT 1",
    [name]
  );
  if (existing.rows.length) return existing.rows[0].id;

  const inserted = await client.query(
    "INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING id",
    [name, description]
  );
  return inserted.rows[0].id;
}

async function ensureUser(client, { name, email, password, roleId }) {
  const existing = await client.query(
    "SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1",
    [email]
  );
  if (existing.rows.length) return existing.rows[0].id;

  const passwordHash = await bcrypt.hash(password, 10);
  const inserted = await client.query(
    `
    INSERT INTO users (name, email, password_hash, role_id)
    VALUES ($1, $2, $3, $4)
    RETURNING id
    `,
    [name, email, passwordHash, roleId]
  );
  return inserted.rows[0].id;
}

async function seedDataset(client, adminId) {
  const existing = await client.query(
    `
    SELECT id
    FROM datasets
    WHERE name = $1 AND is_deleted = FALSE
    LIMIT 1
    `,
    [DATASET_NAME]
  );
  if (existing.rows.length) {
    return existing.rows[0].id;
  }

  const dataset = await client.query(
    `
    INSERT INTO datasets (name, description, created_by, updated_by)
    VALUES ($1, $2, $3, $3)
    RETURNING id
    `,
    [
      DATASET_NAME,
      "Service visits, equipment identity, and planned maintenance dates.",
      adminId,
    ]
  );
  const datasetId = dataset.rows[0].id;
  const fieldIds = {};

  for (let index = 0; index < FIELDS.length; index += 1) {
    const field = FIELDS[index];
    const inserted = await client.query(
      `
      INSERT INTO fields (dataset_id, name, field_key, field_type, position, is_required)
      VALUES ($1, $2, $3, $4, $5, FALSE)
      RETURNING id
      `,
      [datasetId, field.name, field.fieldKey, field.fieldType, index]
    );
    fieldIds[field.fieldKey] = inserted.rows[0].id;
  }

  for (const row of SAMPLE_ROWS) {
    const record = await client.query(
      `
      INSERT INTO records (dataset_id, created_by, updated_by)
      VALUES ($1, $2, $2)
      RETURNING id
      `,
      [datasetId, adminId]
    );
    const recordId = record.rows[0].id;
    const entries = Object.entries(row).filter(([, value]) => value !== "");
    const placeholders = [];
    const params = [];

    entries.forEach(([key, value], cellIndex) => {
      const offset = cellIndex * 4;
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
      params.push(recordId, fieldIds[key], value, adminId);
    });

    await client.query(
      `
      INSERT INTO record_values (record_id, field_id, value, updated_by)
      VALUES ${placeholders.join(", ")}
      `,
      params
    );
  }

  return datasetId;
}

async function seed() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const adminRoleId = await ensureRole(client, "Admin", "Full access to schema, users, and datasets");
    const managerRoleId = await ensureRole(
      client,
      "Managing Person",
      "Operational access to view and edit dataset rows"
    );

    const adminId = await ensureUser(client, {
      name: "QTech Admin",
      email: "admin@qtech.com",
      password: "adminqtech",
      roleId: adminRoleId,
    });

    await ensureUser(client, {
      name: "QTech Operator",
      email: "operator@qtech.com",
      password: "operatorqtech",
      roleId: managerRoleId,
    });

    const datasetId = await seedDataset(client, adminId);
    await client.query("COMMIT");

    console.log("Seed complete.");
    console.log("Admin: admin@qtech.com / adminqtech");
    console.log("Managing Person: operator@qtech.com / operatorqtech");
    console.log(`Dataset id: ${datasetId}`);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback error:", rollbackError);
    }
    console.error("Seed failed:", error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
