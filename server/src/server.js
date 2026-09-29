const express = require("express");
const cors = require("cors");
require("dotenv").config();

const pool = require("./config/db");
const { ensureSchema } = require("./database/ensure");
const { requireAuth } = require("./middleware/auth");
const { getWorkspaceAuditLogs } = require("./controllers/datasetController");
const authRoutes = require("./routes/authRoutes");
const datasetRoutes = require("./routes/datasetRoutes");
const userRoutes = require("./routes/userRoutes");
const notificationRoutes = require("./routes/notificationRoutes");

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/datasets", datasetRoutes);
app.use("/api/users", userRoutes);
app.use("/api/notifications", notificationRoutes);
app.get("/api/audit-logs", requireAuth, getWorkspaceAuditLogs);

ensureSchema().catch((error) => {
  console.error("Schema ensure error:", error);
});

app.get("/", (req, res) => {
  res.json({
    message: "QTech Data Management API is running",
  });
});

app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      message: "Database connected successfully",
      time: result.rows[0].now,
    });
  } catch (error) {
    console.error("Database connection error:", error);

    res.status(500).json({
      error: error.message,
    });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) {
    next(err);
    return;
  }

  const status = Number(err.status || err.statusCode) || 500;
  const code = status >= 400 && status < 600 ? status : 500;
  res.status(code).json({ error: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});