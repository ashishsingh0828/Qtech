const TABS = [
  "all",
  "needs_validation",
  "validation_overdue",
  "pending_verification",
  "amc_due",
  "proposal_sent",
  "active_amcs",
  "follow_up_due",
];

function appTimeZone() {
  return process.env.APP_TIMEZONE || "Asia/Kolkata";
}

function todayISO(timeZone = appTimeZone(), now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const bag = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${bag.year}-${bag.month}-${bag.day}`;
}

function addDays(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

function dateOnly(value) {
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return "";
}

function columnBySemantic(schema, semantic) {
  return (schema?.columns || []).find((column) => column.semantic === semantic) || null;
}

function readSemantic(data, schema, semantic) {
  const column = columnBySemantic(schema, semantic);
  if (!column) return "";
  const value = data?.[column.key];
  return value == null ? "" : value;
}

function yesNo(value) {
  const key = String(value ?? "").trim().toLowerCase();
  if (["yes", "y", "true"].includes(key)) return "Yes";
  if (["no", "n", "false"].includes(key)) return "No";
  return String(value ?? "").trim();
}

function warrantyExpired(endValue, today) {
  const iso = dateOnly(endValue);
  if (!iso) return false;
  return iso < today;
}

function warrantyLive(endValue, today) {
  const iso = dateOnly(endValue);
  if (!iso) return "Unknown";
  if (iso < today) return "Expired";
  if (iso <= addDays(today, 30)) return "Expiring in 30 days";
  return "Active";
}

function effectiveAmc(data, schema, today) {
  const stored = String(readSemantic(data, schema, "amc_status") || "").trim();
  if (stored) return stored;
  const end = readSemantic(data, schema, "end_date");
  if (!dateOnly(end)) return "Not Due";
  return warrantyExpired(end, today) ? "AMC Due" : "Not Due";
}

function wholeDays(start, end) {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  const span = Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay);
  return Math.round(span / 86400000);
}

function writeDays(data, schema) {
  const column = columnBySemantic(schema, "days");
  if (!column || !data) return data;
  const start = dateOnly(readSemantic(data, schema, "start_date"));
  const end = dateOnly(readSemantic(data, schema, "end_date"));
  if (!start || !end) delete data[column.key];
  else data[column.key] = wholeDays(start, end);
  return data;
}

function nextDuePms(data, schema) {
  const scheduled = (schema?.columns || []).filter((column) => /^pms:\d+$/.test(column.semantic || ""));
  let earliest = "";
  let anyScheduled = false;
  let anyOpen = false;
  scheduled.forEach((column) => {
    const raw = String(data?.[column.key] ?? "").trim().toLowerCase();
    if (!raw || raw === "na" || raw === "n/a" || raw === "-") return;
    const iso = dateOnly(data[column.key]);
    if (!iso) return;
    anyScheduled = true;
    const index = column.semantic.slice(4);
    const doneColumn = (schema.columns || []).find((entry) => entry.semantic === `pm_date:${index}`);
    const done = String(doneColumn ? data?.[doneColumn.key] ?? "" : "").trim().toLowerCase();
    const fulfilled = done && done !== "na" && done !== "n/a" && done !== "-";
    if (fulfilled) return;
    anyOpen = true;
    if (!earliest || iso < earliest) earliest = iso;
  });
  if (!anyScheduled) return "";
  if (!anyOpen) return "Complete";
  return earliest;
}

function groupKeyForColumn(schema, column) {
  return (schema?.groups || []).find((group) => group.id === column?.groupId)?.groupKey || "";
}

function overlayData(data, schema, today) {
  const view = { ...(data || {}) };
  writeDays(view, schema);
  const warranty = columnBySemantic(schema, "warranty_live");
  const amc = columnBySemantic(schema, "amc_status");
  const nextDue = columnBySemantic(schema, "next_due_pms");
  if (warranty) view[warranty.key] = warrantyLive(readSemantic(data, schema, "end_date"), today);
  if (amc) view[amc.key] = effectiveAmc(data, schema, today);
  if (nextDue) view[nextDue.key] = nextDuePms(data, schema);
  return view;
}

function matchesTab(data, schema, tab, today) {
  const validated = yesNo(readSemantic(data, schema, "validated"));
  const due = dateOnly(readSemantic(data, schema, "validation_due"));
  const verified = String(readSemantic(data, schema, "verified") || "").trim();
  if (tab === "all") return true;
  if (tab === "needs_validation") return validated === "";
  if (tab === "validation_overdue") return validated === "No" && Boolean(due) && due < today;
  if (tab === "pending_verification") return validated === "Yes" && verified !== "Verified OK";
  if (tab === "amc_due") {
    return warrantyExpired(readSemantic(data, schema, "end_date"), today) && effectiveAmc(data, schema, today) === "AMC Due";
  }
  if (tab === "proposal_sent") return effectiveAmc(data, schema, today) === "Proposal Sent";
  if (tab === "active_amcs") return effectiveAmc(data, schema, today) === "Acknowledged";
  if (tab === "follow_up_due") {
    const follow = dateOnly(readSemantic(data, schema, "next_follow_up"));
    return Boolean(follow) && follow <= today;
  }
  return false;
}

function matchesQuery(view, query) {
  if (!query) return true;
  return Object.values(view).some((value) => String(value ?? "").toLowerCase().includes(query));
}

function summarize(rows, schema, today) {
  const counts = {
    all: rows.length,
    needs_validation: 0,
    validation_overdue: 0,
    pending_verification: 0,
    amc_due: 0,
  };
  rows.forEach((data) => {
    TABS.forEach((tab) => {
      if (tab !== "all" && matchesTab(data, schema, tab, today)) counts[tab] += 1;
    });
  });
  return counts;
}

module.exports = {
  TABS,
  appTimeZone,
  todayISO,
  dateOnly,
  columnBySemantic,
  readSemantic,
  yesNo,
  warrantyExpired,
  warrantyLive,
  effectiveAmc,
  writeDays,
  groupKeyForColumn,
  overlayData,
  matchesTab,
  matchesQuery,
  summarize,
};
