import axios from "axios";

export const API_BASE = "http://localhost:5000";

export function authConfig() {
  return { withCredentials: true };
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

export async function clearSession(navigate) {
  try {
    await axios.post(`${API_BASE}/api/auth/logout`, {}, { withCredentials: true });
  } catch {
    /* The session cookie is already gone. */
  }
  if (navigate) navigate("/login");
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
