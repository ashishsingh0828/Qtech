export const API_BASE = "http://localhost:5000";

export function readUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

export function formatRole(role) {
  if (!role) return "User";
  const normalized = String(role).toLowerCase().replace(/[_-]+/g, " ").trim();
  if (normalized === "admin") return "Admin";
  if (normalized === "manager" || normalized === "managing person" || normalized === "managingperson") {
    return "Manager";
  }
  if (normalized === "validator") return "Validator";
  if (normalized === "service") return "Service";
  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

export function isAdminRole(role) {
  return formatRole(role) === "Admin";
}

export function canDeleteRole(role) {
  const label = formatRole(role);
  return label === "Admin" || label === "Manager";
}

export function roleBadgeClass(role) {
  const label = formatRole(role);
  if (label === "Admin") return "role-badge role-admin";
  if (label === "Manager") return "role-badge role-manager";
  if (label === "Validator") return "role-badge role-validator";
  if (label === "Service") return "role-badge role-service";
  return "role-badge";
}

export function authConfig() {
  return {
    headers: {
      Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
    },
  };
}

export function errorMessage(error, fallback) {
  return error.response?.data?.error || error.response?.data?.message || fallback;
}

export async function messageFromResponse(error, fallback) {
  const data = error.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      return parsed.error || parsed.message || fallback;
    } catch {
      return fallback;
    }
  }
  return errorMessage(error, fallback);
}

export function clearSession(navigate) {
  localStorage.clear();
  navigate("/login");
}

export function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function relativeTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return formatter.format(seconds, "second");
  if (abs < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return formatter.format(Math.round(seconds / 3600), "hour");
  if (abs < 86400 * 30) return formatter.format(Math.round(seconds / 86400), "day");
  if (abs < 86400 * 365) return formatter.format(Math.round(seconds / (86400 * 30)), "month");
  return formatter.format(Math.round(seconds / (86400 * 365)), "year");
}

export function syncLabel(value) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not yet";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 15) return "Just now";
  return relativeTime(value);
}

export function downloadName(datasetName) {
  const cleaned = String(datasetName || "dataset").replace(/[^\w.\- ]+/g, "").trim();
  return `${cleaned || "dataset"}.xlsx`;
}
