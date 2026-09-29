const express = require("express");
const cors = require("cors");
require("dotenv").config();

const pool = require("./config/db");
const { ensureSchema } = require("./database/ensure");
const { bootstrapAdmin } = require("./controllers/authController");
const { requireAuth } = require("./middleware/auth");
const { getWorkspaceAuditLogs } = require("./controllers/datasetController");
const authRoutes = require("./routes/authRoutes");
const datasetRoutes = require("./routes/datasetRoutes");
const userRoutes = require("./routes/userRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const { getDashboard } = require("./controllers/dashboardController");

const app = express();

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  credentials: true,
}));
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/datasets", datasetRoutes);
app.use("/api/users", userRoutes);
app.use("/api/notifications", notificationRoutes);
app.get("/api/audit-logs", requireAuth, getWorkspaceAuditLogs);
app.get("/api/dashboard", requireAuth, getDashboard);

ensureSchema()
  .then(() => bootstrapAdmin())
  .catch((error) => {
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