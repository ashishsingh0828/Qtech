const { canonicalRole } = require("../middleware/auth");

const SERVICE_GROUPS = new Set(["amc", "schedule services", "compaint", "complaint", "breakdown calls"]);
const VALIDATION_GROUPS = new Set(["data validation"]);
const VALIDATOR_LOCKED = new Set(["verifiedby", "verifieddate", "verificationstatus", "validationdate", "days"]);

function compact(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function inferredGroup(field) {
  const explicit = String(field?.group_name || "").trim().toLowerCase();
  if (explicit) return explicit;
  const name = compact(field?.name);
  if (
    ["validated", "validatedyesno", "validatedby", "validationdate", "bywhendatawillbevalidated", "reasonforrejection", "reason", "days", "verifiedby", "verifieddate", "verificationstatus"].includes(name)
  ) {
    return "data validation";
  }
  if (name === "totalpms" || /^pms\d+$/.test(name) || /^pmdate\d*$/.test(name)) return "schedule services";
  if (["customercomplaint", "serviceremarks", "complaint"].includes(name)) return "compaint";
  if (["calldate", "breakdowndetails", "attendedby"].includes(name)) return "breakdown calls";
  if (["proposalsent", "proposalsentdate", "proposalacknowledged", "acknowledgedby"].includes(name)) return "amc";
  if (name === "followupdate") return "follow up";
  if (["srno", "customername", "city", "contactperson", "mobileno", "email", "location"].includes(name)) return "customer detail";
  if (["contracttype", "equipmentname", "euipmentname", "serialno", "startdate", "month", "year", "enddate", "status", "finalstatus"].includes(name)) {
    return "instrument details";
  }
  return "";
}

function isManager(user) {
  return canonicalRole(user?.role) === "Manager";
}

function isAdmin(user) {
  return canonicalRole(user?.role) === "Admin";
}

function canDeleteFiles(user) {
  const role = canonicalRole(user?.role);
  return role === "Admin" || role === "Manager";
}

function roleCanEditField(user, field) {
  const role = canonicalRole(user?.role);
  if (role === "Admin" || role === "Manager") return true;
  const group = inferredGroup(field);
  if (role === "Validator") {
    return VALIDATION_GROUPS.has(group) && !VALIDATOR_LOCKED.has(compact(field?.name));
  }
  if (role === "Service") return SERVICE_GROUPS.has(group);
  return false;
}

function notifiesLeadership(user, field) {
  const role = canonicalRole(user?.role);
  const group = inferredGroup(field);
  if (role === "Service" && SERVICE_GROUPS.has(group)) return true;
  if (role === "Validator" && VALIDATION_GROUPS.has(group)) return true;
  return false;
}

module.exports = {
  inferredGroup,
  isAdmin,
  isManager,
  canDeleteFiles,
  roleCanEditField,
  notifiesLeadership,
};
