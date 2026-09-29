const { Pool } = require("pg");

const pool = new Pool({
  host: "localhost",
  port: 2001,
  user: "postgres",
  password: "Ashish",
  database: "qtech_data_management",
});

module.exports = pool;