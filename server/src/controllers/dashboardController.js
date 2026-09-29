const pool = require("../config/db");
const { normalizeRole } = require("../../../shared/permissions");
const { ensureSchema } = require("../database/ensure");
const { readySchema } = require("../sheet/prepareSheet");
const { resolveSchema } = require("../sheet/resolveSchema");
const { appTimeZone, matchesTab, todayISO } = require("../sheet/rowRules");

const METRICS = {
  needs_validation: ["Needs Validation", "Rows still waiting for a Yes or No", "needs_validation"],
  validation_overdue: ["Validation Overdue", "Rejected rows past the expected date", "validation_overdue"],
  pending_verification: ["Pending Reviews", "Validated rows that are not Verified OK", "pending_verification"],
  amc_due: ["AMC Due", "Warranty has expired and no proposal is out", "amc_due"],
  active_amcs: ["Active AMCs", "Customers who acknowledged a proposal", "active_amcs"],
  proposal_sent: ["Proposal Sent", "AMC proposals waiting for a reply", "proposal_sent"],
  follow_up_due: ["Follow-ups Due", "Next follow-up is today or earlier", "follow_up_due"],
};

function metricKeys(role) {
  if (role === "validator") return ["needs_validation", "validation_overdue", "pending_verification"];
  if (role === "service") return ["amc_due", "proposal_sent", "follow_up_due"];
  return ["validation_overdue", "amc_due", "active_amcs", "pending_verification"];
}

function greeting(timeZone) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  }).format(new Date()));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function dateLabel(timeZone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date());
}

const getDashboard = async (req, res) => {
  try {
    await ensureSchema();
    const role = normalizeRole(req.user?.role);
    const timeZone = appTimeZone();
    const today = todayISO(timeZone);
    const datasets = await pool.query(
      `
      SELECT d.id, d.name, d.schema, d.row_count, d.column_count, d.updated_at, u.name AS uploader_name
      FROM datasets d
      LEFT JOIN users u ON u.id = d.created_by
      WHERE d.is_deleted = FALSE
      ORDER BY d.updated_at DESC NULLS LAST, d.id DESC
      `
    );
    const keys = metricKeys(role);
    const buckets = Object.fromEntries(keys.map((key) => [key, []]));
    const cards = [];
    for (const dataset of datasets.rows) {
      const schema = await readySchema(dataset, resolveSchema);
      const rows = await pool.query(
        "SELECT data FROM records WHERE dataset_id = $1 AND is_deleted = FALSE",
        [dataset.id]
      );
      const counts = Object.fromEntries(keys.map((key) => [key, 0]));
      rows.rows.forEach((row) => {
        keys.forEach((key) => {
          if (matchesTab(row.data || {}, schema, key, today)) counts[key] += 1;
        });
      });
      keys.forEach((key) => {
        if (counts[key] > 0) buckets[key].push({ id: dataset.id, name: dataset.name, count: counts[key] });
      });
      cards.push({
        id: dataset.id,
        name: dataset.name,
        rowCount: dataset.row_count || rows.rows.length,
        columnCount: dataset.column_count || schema.columns.length,
        updatedAt: dataset.updated_at,
        uploaderName: dataset.uploader_name || "",
        pills: counts,
      });
    }
    const metrics = keys.map((key) => {
      const [label, subtitle, tab] = METRICS[key];
      const targets = buckets[key].sort((left, right) => right.count - left.count);
      return {
        key,
        label,
        subtitle,
        tab,
        count: targets.reduce((sum, entry) => sum + entry.count, 0),
        targets,
      };
    });
    if (role === "admin" || role === "manager") {
      metrics.push({
        key: "datasets",
        label: "Datasets",
        subtitle: "Workbooks in the registry",
        tab: "",
        count: cards.length,
        targets: [],
      });
    }
    res.json({
      timezone: timeZone,
      greeting: greeting(timeZone),
      dateLabel: dateLabel(timeZone),
      name: req.user?.name || "there",
      metrics,
      datasets: cards,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ error: "Unable to load the dashboard." });
  }
};

module.exports = { getDashboard };
