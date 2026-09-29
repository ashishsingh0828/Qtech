import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Database,
  Download,
  FileSpreadsheet,
  Filter,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import "./Dashboard.css";
import "./DatasetDetail.css";
import { useToast } from "../components/toast-context";

const API_BASE = "http://localhost:5000";
const FIELD_TYPES = ["text", "number", "date", "boolean", "email"];

function readUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

function formatRole(role) {
  if (!role) return "User";

  const normalized = String(role).toLowerCase().replace(/[_-]+/g, " ").trim();

  if (normalized === "admin") return "Admin";
  if (normalized === "managing person" || normalized === "managingperson") {
    return "Managing Person";
  }

  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

function toFieldKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function authConfig() {
  return {
    headers: {
      Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
    },
  };
}

function errorMessage(error, fallback) {
  return error.response?.data?.error || error.response?.data?.message || fallback;
}

async function messageFromResponse(error, fallback) {
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

function isExcelFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls");
}

function downloadName(datasetName) {
  const cleaned = String(datasetName || "dataset").replace(/[^\w.\- ]+/g, "").trim();
  return `${cleaned || "dataset"}.xlsx`;
}

function inputTypeFor(fieldType) {
  if (fieldType === "number") return "number";
  if (fieldType === "date") return "date";
  if (fieldType === "email") return "email";
  return "text";
}

function emptyRowValues(fields) {
  const values = {};
  for (const field of fields) {
    values[field.field_key] = field.field_type === "boolean" ? false : "";
  }
  return values;
}

function cellText(field, value) {
  if (value == null || value === "") return "";
  if (field.field_type === "boolean") {
    return value === true || value === "true" ? "Yes" : "No";
  }
  return String(value);
}

function formatTimestamp(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function auditValue(value) {
  if (value == null || value === "") return "empty";
  if (value === "true") return "Yes";
  if (value === "false") return "No";
  return String(value);
}

function draftFromValue(field, value) {
  if (field.field_type === "boolean") {
    if (value === true || value === "true") return "true";
    if (value === false || value === "false") return "false";
    return "";
  }
  return value == null ? "" : String(value);
}

function draftsMatch(field, value, draft) {
  return draftFromValue(field, value) === String(draft ?? "");
}

function statusTone(value) {
  const key = String(value ?? "").trim().toLowerCase();
  if (key === "active" || key === "expired" || key === "pending" || key === "completed" || key === "validated") {
    return key;
  }
  return "";
}

function typeLabel(fieldType) {
  if (fieldType === "number") return "Number";
  if (fieldType === "date") return "Date";
  if (fieldType === "boolean") return "Boolean";
  if (fieldType === "email") return "Email";
  return "Text";
}

function compareCell(field, left, right) {
  const leftRaw = left.values?.[field.field_key];
  const rightRaw = right.values?.[field.field_key];
  const leftEmpty = leftRaw == null || leftRaw === "";
  const rightEmpty = rightRaw == null || rightRaw === "";
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;

  if (field.field_type === "number") {
    const leftNumber = Number(leftRaw);
    const rightNumber = Number(rightRaw);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber;
    }
  }

  return cellText(field, leftRaw).localeCompare(cellText(field, rightRaw), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function EditableCell({ field, value, isEditing, pulse, errorText, onBegin, onCommit, onCancel }) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);
  const skipBlur = useRef(false);

  useEffect(() => {
    if (!isEditing) return undefined;
    skipBlur.current = false;
    setDraft(draftFromValue(field, value));
    setSaving(false);
    const frame = window.requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      if (typeof node.select === "function" && field.field_type !== "date") {
        node.select();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isEditing, field, value]);

  async function finish(move) {
    if (skipBlur.current) return;
    skipBlur.current = true;
    setSaving(true);
    const saved = await onCommit(draft, move);
    setSaving(false);
    if (!saved) {
      skipBlur.current = false;
      inputRef.current?.focus();
    }
  }

  function onKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      void finish("down");
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      void finish(event.shiftKey ? "left" : "right");
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      skipBlur.current = true;
      onCancel();
    }
  }

  const shown = cellText(field, value);
  const tone = statusTone(shown);
  const className = [
    "editable-cell",
    isEditing ? "is-active" : "",
    pulse ? "cell-saved-pulse" : "",
    saving ? "cell-saving" : "",
    errorText ? "cell-error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <td
      className={className}
      onClick={() => {
        if (!isEditing) onBegin();
      }}
    >
      {isEditing ? (
        field.field_type === "boolean" ? (
          <select
            ref={inputRef}
            className="cell-input"
            value={draft}
            aria-label={field.name}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              void finish(null);
            }}
            onKeyDown={onKeyDown}
          >
            <option value="">—</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        ) : (
          <input
            ref={inputRef}
            className="cell-input"
            type={inputTypeFor(field.field_type)}
            value={draft}
            aria-label={field.name}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              void finish(null);
            }}
            onKeyDown={onKeyDown}
          />
        )
      ) : (
        <div className="cell-display">
          {tone ? (
            <span className={`status-pill status-${tone}`}>{shown}</span>
          ) : (
            <span className={shown ? undefined : "cell-empty"}>{shown || "—"}</span>
          )}
          {errorText ? <span className="cell-status">{errorText}</span> : null}
        </div>
      )}
    </td>
  );
}

function DatasetDetail() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const { id } = useParams();
  const user = readUser();
  const roleLabel = formatRole(user?.role);
  const roleClass =
    roleLabel === "Admin"
      ? "role-badge role-admin"
      : roleLabel === "Managing Person"
        ? "role-badge role-manager"
        : "role-badge";

  const [dataset, setDataset] = useState(null);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [error, setError] = useState("");
  const [recordsError, setRecordsError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [fieldName, setFieldName] = useState("");
  const [fieldKey, setFieldKey] = useState("");
  const [fieldKeyTouched, setFieldKeyTouched] = useState(false);
  const [fieldType, setFieldType] = useState("text");
  const [isRequired, setIsRequired] = useState(false);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rowModalOpen, setRowModalOpen] = useState(false);
  const [rowValues, setRowValues] = useState({});
  const [rowError, setRowError] = useState("");
  const [rowSubmitting, setRowSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [createMissing, setCreateMissing] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [editing, setEditing] = useState(null);
  const [sort, setSort] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterFieldId, setFilterFieldId] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [savedPulseKey, setSavedPulseKey] = useState("");
  const [cellError, setCellError] = useState(null);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftValues, setDraftValues] = useState({});
  const [draftError, setDraftError] = useState("");
  const [draftSaving, setDraftSaving] = useState(false);
  const fileInputRef = useRef(null);
  const searchRef = useRef(null);
  const filterRef = useRef(null);
  const draftFirstRef = useRef(null);

  useEffect(() => {
    let active = true;

    async function loadDataset() {
      setLoading(true);
      setRecordsLoading(true);
      setError("");
      setRecordsError("");

      try {
        const [datasetResponse, recordsResponse] = await Promise.all([
          axios.get(`${API_BASE}/api/datasets/${id}`, authConfig()),
          axios.get(`${API_BASE}/api/datasets/${id}/records`, authConfig()),
        ]);
        if (!active) return;
        setDataset(datasetResponse.data.dataset);
        setRecords(recordsResponse.data.records || []);
      } catch (err) {
        if (!active) return;
        if (err.response?.status === 401) {
          localStorage.clear();
          navigate("/login");
          return;
        }
        setDataset(null);
        setRecords([]);
        setError(errorMessage(err, "Unable to load this dataset."));
      } finally {
        if (active) {
          setLoading(false);
          setRecordsLoading(false);
        }
      }
    }

    loadDataset();

    return () => {
      active = false;
    };
  }, [id, navigate, refreshKey]);

  useEffect(() => {
    const dialogOpen = modalOpen || rowModalOpen || deleteTarget || importOpen;
    if (!dialogOpen) return undefined;

    function onKeyDown(event) {
      if (event.key !== "Escape" || submitting || rowSubmitting || deleting || importing) return;
      setModalOpen(false);
      setRowModalOpen(false);
      setDeleteTarget(null);
      setImportOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, rowModalOpen, deleteTarget, importOpen, submitting, rowSubmitting, deleting, importing]);

  useEffect(() => {
    function onKeyDown(event) {
      const dialogOpen = modalOpen || rowModalOpen || deleteTarget || importOpen;
      if (dialogOpen) return;
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select?.();
        return;
      }
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, rowModalOpen, deleteTarget, importOpen]);

  useEffect(() => {
    if (!filterOpen) return undefined;

    function onPointerDown(event) {
      if (!filterRef.current?.contains(event.target)) {
        setFilterOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [filterOpen]);

  useEffect(() => {
    if (!draftOpen) return undefined;
    draftFirstRef.current?.focus();
  }, [draftOpen]);

  function handleLogout() {
    localStorage.clear();
    navigate("/login");
  }

  function leaveForLogin() {
    localStorage.clear();
    navigate("/login");
  }

  function openImport() {
    setImportFile(null);
    setPreview(null);
    setPreviewError("");
    setImportError("");
    setCreateMissing(roleLabel === "Admin");
    setDragOver(false);
    setImportOpen(true);
  }

  async function previewWorkbook(file) {
    if (!isExcelFile(file)) {
      setPreview(null);
      setImportFile(null);
      setPreviewError("Choose an .xlsx or .xls file.");
      return;
    }

    setImportFile(file);
    setPreview(null);
    setPreviewError("");
    setImportError("");
    setPreviewLoading(true);

    const form = new FormData();
    form.append("file", file);

    try {
      const { data } = await axios.post(
        `${API_BASE}/api/datasets/${id}/preview-excel`,
        form,
        authConfig()
      );
      setPreview(data);
    } catch (err) {
      if (err.response?.status === 401) {
        leaveForLogin();
        return;
      }
      setPreviewError(await messageFromResponse(err, "Unable to preview this spreadsheet."));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    setRecordsError("");

    try {
      const response = await axios.get(`${API_BASE}/api/datasets/${id}/export-excel`, {
        ...authConfig(),
        responseType: "blob",
      });
      const blob = new Blob([response.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName(dataset?.name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      notify("Export ready");
    } catch (err) {
      if (err.response?.status === 401) {
        leaveForLogin();
        return;
      }
      setRecordsError(await messageFromResponse(err, "Unable to export this dataset."));
    } finally {
      setExporting(false);
    }
  }

  async function handleImport() {
    if (!importFile) return;
    setImporting(true);
    setImportError("");

    const form = new FormData();
    form.append("file", importFile);
    form.append("createMissing", createMissing ? "true" : "false");

    try {
      await axios.post(`${API_BASE}/api/datasets/${id}/import-excel`, form, authConfig());
      setImportOpen(false);
      setRefreshKey((value) => value + 1);
      notify("File uploaded");
    } catch (err) {
      if (err.response?.status === 401) {
        leaveForLogin();
        return;
      }
      setImportError(await messageFromResponse(err, "Unable to import this spreadsheet."));
    } finally {
      setImporting(false);
    }
  }

  async function loadLogs() {
    setLogsLoading(true);
    setLogsError("");

    try {
      const { data } = await axios.get(`${API_BASE}/api/datasets/${id}/audit-logs`, authConfig());
      setLogs(Array.isArray(data) ? data : data.logs || []);
    } catch (err) {
      if (err.response?.status === 401) {
        leaveForLogin();
        return;
      }
      setLogsError(errorMessage(err, "Unable to load the activity log."));
    } finally {
      setLogsLoading(false);
    }
  }

  function toggleLogs() {
    const next = !logsOpen;
    setLogsOpen(next);
    if (next) {
      loadLogs();
    }
  }

  function handleCellSaved(recordId, fieldKeyName, nextValue) {
    setRecords((current) =>
      current.map((record) =>
        record.id === recordId
          ? {
              ...record,
              values: {
                ...record.values,
                [fieldKeyName]: nextValue,
              },
            }
          : record
      )
    );

    if (logsOpen) {
      loadLogs();
    }
  }

  function openModal() {
    setFieldName("");
    setFieldKey("");
    setFieldKeyTouched(false);
    setFieldType("text");
    setIsRequired(false);
    setFormError("");
    setModalOpen(true);
  }

  function handleFieldNameChange(value) {
    setFieldName(value);
    if (!fieldKeyTouched) {
      setFieldKey(toFieldKey(value));
    }
  }

  async function handleAddField(event) {
    event.preventDefault();
    setFormError("");
    setSubmitting(true);

    try {
      await axios.post(
        `${API_BASE}/api/datasets/${id}/fields`,
        {
          name: fieldName.trim(),
          field_key: fieldKey.trim(),
          field_type: fieldType,
          is_required: isRequired,
        },
        authConfig()
      );
      setModalOpen(false);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.clear();
        navigate("/login");
        return;
      }
      setFormError(errorMessage(err, "Unable to add this column."));
    } finally {
      setSubmitting(false);
    }
  }

  async function reloadRecords() {
    setRecordsLoading(true);
    setRecordsError("");
    try {
      const { data } = await axios.get(`${API_BASE}/api/datasets/${id}/records`, authConfig());
      setRecords(data.records || []);
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.clear();
        navigate("/login");
        return;
      }
      setRecordsError(errorMessage(err, "Unable to load rows."));
    } finally {
      setRecordsLoading(false);
    }
  }

  function openRowModal() {
    setRowValues(emptyRowValues(fields));
    setRowError("");
    setRowModalOpen(true);
  }

  function updateRowValue(fieldKeyName, value) {
    setRowValues((current) => ({
      ...current,
      [fieldKeyName]: value,
    }));
  }

  async function handleAddRow(event) {
    event.preventDefault();
    setRowError("");
    setRowSubmitting(true);

    const values = {};
    for (const field of fields) {
      values[field.field_key] = rowValues[field.field_key];
    }

    try {
      await axios.post(`${API_BASE}/api/datasets/${id}/records`, { values }, authConfig());
      setRowModalOpen(false);
      setRowValues({});
      setLastSavedAt(new Date().toISOString());
      await reloadRecords();
      notify("Row added");
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.clear();
        navigate("/login");
        return;
      }
      setRowError(errorMessage(err, "Unable to add this row."));
    } finally {
      setRowSubmitting(false);
    }
  }

  async function handleDeleteRow() {
    if (!deleteTarget) return;
    setDeleting(true);
    setRecordsError("");

    try {
      await axios.delete(
        `${API_BASE}/api/datasets/${id}/records/${deleteTarget.id}`,
        authConfig()
      );
      setDeleteTarget(null);
      await reloadRecords();
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.clear();
        navigate("/login");
        return;
      }
      setRecordsError(errorMessage(err, "Unable to delete this row."));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  const fields = dataset?.fields || [];
  const needle = query.trim().toLowerCase();
  const filterField = fields.find((field) => String(field.id) === String(filterFieldId)) || null;
  const filterNeedle = filterValue.trim().toLowerCase();
  const filteredRecords = records.filter((record) => {
    if (needle) {
      const matchesSearch = fields.some((field) => {
        const raw = record.values?.[field.field_key];
        const displayed = cellText(field, raw).toLowerCase();
        return displayed.includes(needle) || String(raw ?? "").toLowerCase().includes(needle);
      });
      if (!matchesSearch) return false;
    }
    if (filterField && filterNeedle) {
      const raw = record.values?.[filterField.field_key];
      const displayed = cellText(filterField, raw).toLowerCase();
      return displayed.includes(filterNeedle) || String(raw ?? "").toLowerCase().includes(filterNeedle);
    }
    return true;
  });
  const viewRecords = sort
    ? [...filteredRecords].sort((left, right) => {
        const field = fields.find((entry) => entry.id === sort.fieldId);
        if (!field) return 0;
        const compared = compareCell(field, left, right);
        return sort.direction === "desc" ? -compared : compared;
      })
    : filteredRecords;
  const filterActive = Boolean(filterField && filterNeedle);

  function cycleSort(field) {
    setSort((current) => {
      if (!current || current.fieldId !== field.id) {
        return { fieldId: field.id, direction: "asc" };
      }
      if (current.direction === "asc") {
        return { fieldId: field.id, direction: "desc" };
      }
      return null;
    });
  }

  function moveEditing(recordId, fieldIndex, direction) {
    const rowIndex = viewRecords.findIndex((row) => row.id === recordId);
    if (rowIndex < 0 || fields.length === 0) {
      setEditing(null);
      return;
    }

    let nextRow = rowIndex;
    let nextCol = fieldIndex;

    if (direction === "down") {
      if (rowIndex >= viewRecords.length - 1) {
        setEditing(null);
        return;
      }
      nextRow = rowIndex + 1;
    } else if (direction === "right") {
      nextCol += 1;
      if (nextCol >= fields.length) {
        nextCol = 0;
        nextRow += 1;
        if (nextRow >= viewRecords.length) {
          setEditing(null);
          return;
        }
      }
    } else if (direction === "left") {
      nextCol -= 1;
      if (nextCol < 0) {
        if (rowIndex === 0) {
          setEditing(null);
          return;
        }
        nextCol = fields.length - 1;
        nextRow = rowIndex - 1;
      }
    }

    setEditing({ recordId: viewRecords[nextRow].id, fieldIndex: nextCol });
  }

  async function commitCell(record, field, fieldIndex, draft, move) {
    const currentValue = record.values?.[field.field_key];
    if (!draftsMatch(field, currentValue, draft)) {
      const nextValue =
        field.field_type === "boolean" ? (draft === "" ? "" : draft === "true") : draft;
      try {
        const { data } = await axios.patch(
          `${API_BASE}/api/datasets/${id}/records/${record.id}/cells`,
          { field_id: field.id, value: nextValue },
          authConfig()
        );
        handleCellSaved(record.id, field.field_key, data.updated?.value ?? nextValue);
        const pulseKey = `${record.id}:${field.id}`;
        setSavedPulseKey(pulseKey);
        window.setTimeout(() => {
          setSavedPulseKey((current) => (current === pulseKey ? "" : current));
        }, 900);
        setLastSavedAt(new Date().toISOString());
        setCellError(null);
        notify("Cell saved");
      } catch (err) {
        if (err.response?.status === 401) {
          leaveForLogin();
          return false;
        }
        setCellError({
          key: `${record.id}:${field.id}`,
          message: errorMessage(err, "Unable to save this cell."),
        });
        setEditing({ recordId: record.id, fieldIndex });
        return false;
      }
    }

    if (move) {
      moveEditing(record.id, fieldIndex, move);
    } else {
      setEditing((current) => {
        if (current && current.recordId === record.id && current.fieldIndex === fieldIndex) {
          return null;
        }
        return current;
      });
    }
    return true;
  }

  function beginInlineRow() {
    setDraftValues(emptyRowValues(fields));
    setDraftError("");
    setDraftOpen(true);
  }

  function updateDraftValue(fieldKeyName, value) {
    setDraftValues((current) => ({
      ...current,
      [fieldKeyName]: value,
    }));
  }

  async function saveDraftRow() {
    setDraftSaving(true);
    setDraftError("");
    const values = {};
    for (const field of fields) {
      values[field.field_key] = draftValues[field.field_key];
    }

    try {
      await axios.post(`${API_BASE}/api/datasets/${id}/records`, { values }, authConfig());
      setDraftOpen(false);
      setDraftValues({});
      setLastSavedAt(new Date().toISOString());
      await reloadRecords();
      notify("Row added");
    } catch (err) {
      if (err.response?.status === 401) {
        leaveForLogin();
        return;
      }
      setDraftError(errorMessage(err, "Unable to add this row."));
    } finally {
      setDraftSaving(false);
    }
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <Database size={18} strokeWidth={1.75} />
          </span>
          <span>QTech Data Management</span>
        </div>

        <div className="header-user">
          <div className="user-meta">
            <strong>{user?.name || "Signed in"}</strong>
            <span className={roleClass}>{roleLabel}</span>
          </div>
          <button className="logout-button" type="button" onClick={handleLogout}>
            <LogOut size={16} strokeWidth={2} aria-hidden="true" />
            Logout
          </button>
        </div>
      </header>

      <main className="dashboard-main">
        <section className="dataset-card detail-card">
          <div className="dataset-card-head">
            <div>
              <button className="back-link" type="button" onClick={() => navigate("/dashboard")}>
                <ArrowLeft size={16} aria-hidden="true" />
                Datasets
              </button>
              <h1>{loading ? "Loading dataset…" : dataset?.name || "Dataset"}</h1>
              {!loading && dataset ? (
                <p>{dataset.description || "No description"}</p>
              ) : null}
            </div>
            {dataset && roleLabel === "Admin" ? (
              <button className="upload-button" type="button" onClick={openModal}>
                <Plus size={18} strokeWidth={2} aria-hidden="true" />
                Add Column
              </button>
            ) : null}
          </div>

          {error ? (
            <p className="page-error" role="alert">
              {error}
            </p>
          ) : null}

          {dataset ? (
            <div className="fields-section">
              <h2>Manage Columns / Fields</h2>

              {fields.length === 0 ? (
                <p className="page-message">No columns yet. Add the first field for this dataset.</p>
              ) : (
                <div className="dataset-table-wrap fields-table-wrap">
                  <table className="dataset-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Field key</th>
                        <th>Field type</th>
                        <th>Required</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((field) => (
                        <tr key={field.id}>
                          <td>{field.name}</td>
                          <td>
                            <code className="field-key">{field.field_key}</code>
                          </td>
                          <td>{field.field_type}</td>
                          <td>{field.is_required ? "Yes" : "No"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          {dataset ? (
            <div className="sheet-section">
              <div className="sheet-toolbar">
                <div>
                  <h2>Spreadsheet</h2>
                  <p className="sheet-count">
                    {needle || filterActive
                      ? `${viewRecords.length} of ${records.length} rows`
                      : `${records.length} ${records.length === 1 ? "row" : "rows"}`}
                  </p>
                </div>
                <div className="sheet-tools">
                  <div className="search-field">
                    <label className="sheet-search">
                      <Search size={16} aria-hidden="true" />
                      <input
                        ref={searchRef}
                        type="text"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search rows"
                        aria-label="Search rows"
                      />
                    </label>
                    {query ? (
                      <button
                        className="search-clear"
                        type="button"
                        aria-label="Clear search"
                        onClick={() => {
                          setQuery("");
                          searchRef.current?.focus();
                        }}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                    <kbd className="search-kbd">Ctrl+K /</kbd>
                  </div>
                  <div className="filter-anchor" ref={filterRef}>
                    <button
                      className={filterActive ? "logout-button filter-active" : "logout-button"}
                      type="button"
                      aria-expanded={filterOpen}
                      aria-haspopup="dialog"
                      onClick={() => setFilterOpen((open) => !open)}
                    >
                      <Filter size={16} strokeWidth={2} aria-hidden="true" />
                      Filter
                    </button>
                    {filterOpen ? (
                      <div className="filter-pop" role="dialog" aria-label="Filter rows">
                        <select
                          value={filterFieldId}
                          aria-label="Filter column"
                          onChange={(event) => setFilterFieldId(event.target.value)}
                        >
                          <option value="">Choose a column</option>
                          {fields.map((field) => (
                            <option key={field.id} value={field.id}>
                              {field.name}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={filterValue}
                          placeholder="Contains…"
                          aria-label="Filter value"
                          onChange={(event) => setFilterValue(event.target.value)}
                        />
                        <button
                          className="logout-button"
                          type="button"
                          onClick={() => {
                            setFilterFieldId("");
                            setFilterValue("");
                          }}
                        >
                          Clear filter
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <button
                    className="logout-button"
                    type="button"
                    onClick={handleExport}
                    disabled={exporting}
                  >
                    <Download size={16} strokeWidth={2} aria-hidden="true" />
                    {exporting ? "Exporting…" : "Export to Excel"}
                  </button>
                  <button className="logout-button" type="button" onClick={openImport}>
                    <Upload size={16} strokeWidth={2} aria-hidden="true" />
                    Import
                  </button>
                  <button
                    className="logout-button"
                    type="button"
                    onClick={openRowModal}
                    disabled={fields.length === 0}
                  >
                    Add with form
                  </button>
                  <button
                    className="upload-button"
                    type="button"
                    onClick={beginInlineRow}
                    disabled={fields.length === 0}
                  >
                    <Plus size={18} strokeWidth={2} aria-hidden="true" />
                    Add Row
                  </button>
                </div>
              </div>

              {recordsError ? (
                <p className="page-error" role="alert">
                  {recordsError}
                </p>
              ) : null}
              {draftError ? (
                <p className="page-error" role="alert">
                  {draftError}
                </p>
              ) : null}

              {fields.length === 0 ? (
                <p className="page-message">Add a column before entering rows.</p>
              ) : (
                <>
                  <div className="sheet-scroll">
                    <div className="dataset-table-wrap sheet-table-wrap">
                      <table className="dataset-table sheet-table">
                        <thead>
                          <tr>
                            <th className="row-num" scope="col">
                              #
                            </th>
                            {fields.map((field) => {
                              const direction =
                                sort?.fieldId === field.id ? sort.direction : "default";
                              return (
                                <th key={field.id} scope="col">
                                  <button
                                    className="col-sort"
                                    type="button"
                                    aria-label={
                                      direction === "asc"
                                        ? `${field.name}, sorted ascending`
                                        : direction === "desc"
                                          ? `${field.name}, sorted descending`
                                          : `Sort ${field.name}`
                                    }
                                    onClick={() => cycleSort(field)}
                                  >
                                    <span>{field.name}</span>
                                    {field.is_required ? (
                                      <span className="required-mark">*</span>
                                    ) : null}
                                    <span className="type-badge">{typeLabel(field.field_type)}</span>
                                    {direction === "asc" ? (
                                      <ArrowUp size={14} className="sort-icon" aria-hidden="true" />
                                    ) : direction === "desc" ? (
                                      <ArrowDown size={14} className="sort-icon" aria-hidden="true" />
                                    ) : (
                                      <ArrowUpDown
                                        size={14}
                                        className="sort-icon is-idle"
                                        aria-hidden="true"
                                      />
                                    )}
                                  </button>
                                </th>
                              );
                            })}
                            <th className="actions-col" scope="col">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {recordsLoading ? (
                            <tr>
                              <td className="sheet-empty" colSpan={fields.length + 2}>
                                Loading rows…
                              </td>
                            </tr>
                          ) : null}
                          {!recordsLoading && viewRecords.length === 0 ? (
                            <tr>
                              <td className="sheet-empty" colSpan={fields.length + 2}>
                                {records.length === 0
                                  ? "No rows yet."
                                  : "No rows match your search or filter."}
                              </td>
                            </tr>
                          ) : null}
                          {!recordsLoading
                            ? viewRecords.map((record, rowIndex) => (
                                <tr key={record.id}>
                                  <td className="row-num">{rowIndex + 1}</td>
                                  {fields.map((field, fieldIndex) => (
                                    <EditableCell
                                      key={field.id}
                                      field={field}
                                      value={record.values?.[field.field_key]}
                                      isEditing={
                                        editing?.recordId === record.id &&
                                        editing?.fieldIndex === fieldIndex
                                      }
                                      pulse={savedPulseKey === `${record.id}:${field.id}`}
                                      errorText={
                                        cellError?.key === `${record.id}:${field.id}`
                                          ? cellError.message
                                          : ""
                                      }
                                      onBegin={() =>
                                        setEditing({ recordId: record.id, fieldIndex })
                                      }
                                      onCancel={() => setEditing(null)}
                                      onCommit={(draft, move) =>
                                        commitCell(record, field, fieldIndex, draft, move)
                                      }
                                    />
                                  ))}
                                  <td className="actions-col">
                                    <button
                                      className="delete-row"
                                      type="button"
                                      onClick={() => setDeleteTarget(record)}
                                    >
                                      <Trash2 size={14} aria-hidden="true" />
                                      Delete
                                    </button>
                                  </td>
                                </tr>
                              ))
                            : null}
                          {draftOpen ? (
                            <tr className="draft-row">
                              <td className="row-num">+</td>
                              {fields.map((field, index) => (
                                <td key={field.id}>
                                  {field.field_type === "boolean" ? (
                                    <select
                                      ref={index === 0 ? draftFirstRef : undefined}
                                      className="draft-input"
                                      aria-label={field.name}
                                      value={
                                        draftValues[field.field_key] === true
                                          ? "true"
                                          : draftValues[field.field_key] === false
                                            ? "false"
                                            : ""
                                      }
                                      onChange={(event) =>
                                        updateDraftValue(
                                          field.field_key,
                                          event.target.value === ""
                                            ? ""
                                            : event.target.value === "true"
                                        )
                                      }
                                    >
                                      <option value="">—</option>
                                      <option value="true">Yes</option>
                                      <option value="false">No</option>
                                    </select>
                                  ) : (
                                    <input
                                      ref={index === 0 ? draftFirstRef : undefined}
                                      className="draft-input"
                                      type={inputTypeFor(field.field_type)}
                                      aria-label={field.name}
                                      value={draftValues[field.field_key] ?? ""}
                                      onChange={(event) =>
                                        updateDraftValue(field.field_key, event.target.value)
                                      }
                                    />
                                  )}
                                </td>
                              ))}
                              <td className="actions-col">
                                <div className="draft-actions">
                                  <button
                                    className="upload-button"
                                    type="button"
                                    onClick={saveDraftRow}
                                    disabled={draftSaving}
                                  >
                                    {draftSaving ? "Saving…" : "Save"}
                                  </button>
                                  <button
                                    className="logout-button"
                                    type="button"
                                    onClick={() => setDraftOpen(false)}
                                    disabled={draftSaving}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="sheet-stats" aria-live="polite">
                    <span>
                      Total Rows <strong>{records.length}</strong>
                    </span>
                    <span>
                      Filtered Rows <strong>{viewRecords.length}</strong>
                    </span>
                    <span>
                      Last Saved <strong>{formatTimestamp(lastSavedAt)}</strong>
                    </span>
                  </div>
                </>
              )}
            </div>
          ) : null}

          {dataset ? (
            <section className="audit-section">
              <div className="audit-heading">
                <button
                  className="audit-toggle"
                  type="button"
                  aria-expanded={logsOpen}
                  onClick={toggleLogs}
                >
                  <ChevronDown size={16} className={logsOpen ? "chevron open" : "chevron"} />
                  Audit Trail / Activity Log
                </button>
                {logsOpen ? (
                  <button
                    className="logout-button"
                    type="button"
                    onClick={loadLogs}
                    disabled={logsLoading}
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                    Refresh Logs
                  </button>
                ) : null}
              </div>

              {logsOpen ? (
                <div className="audit-body">
                  {logsError ? (
                    <p className="page-error" role="alert">
                      {logsError}
                    </p>
                  ) : null}
                  {logsLoading ? <p className="page-message">Loading activity…</p> : null}
                  {!logsLoading && !logsError && logs.length === 0 ? (
                    <p className="page-message">No cell changes have been recorded yet.</p>
                  ) : null}
                  {!logsLoading && logs.length > 0 ? (
                    <div className="dataset-table-wrap audit-table-wrap">
                      <table className="dataset-table">
                        <thead>
                          <tr>
                            <th>Timestamp</th>
                            <th>User Name</th>
                            <th>Field Name</th>
                            <th>Change</th>
                          </tr>
                        </thead>
                        <tbody>
                          {logs.map((entry) => (
                            <tr key={entry.id}>
                              <td>{formatTimestamp(entry.changed_at)}</td>
                              <td>{entry.changed_by_name || "Unknown"}</td>
                              <td>{entry.field_name || "Field"}</td>
                              <td>
                                <span className="audit-change">
                                  <span>{auditValue(entry.old_value)}</span>
                                  <span aria-hidden="true">→</span>
                                  <span>{auditValue(entry.new_value)}</span>
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </section>
      </main>

      {importOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!importing && !previewLoading) setImportOpen(false);
          }}
        >
          <div
            className="modal import-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-excel-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <h2 id="import-excel-title">Import Excel</h2>
              <button
                className="icon-button"
                type="button"
                aria-label="Close"
                onClick={() => setImportOpen(false)}
                disabled={importing || previewLoading}
              >
                <X size={18} />
              </button>
            </div>

            <div
              className={dragOver ? "dropzone dropzone-active" : "dropzone"}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                const file = event.dataTransfer.files?.[0];
                if (file) previewWorkbook(file);
              }}
            >
              <FileSpreadsheet size={28} aria-hidden="true" />
              <p>{importFile ? importFile.name : "Drop an .xlsx or .xls file here"}</p>
              <button
                className="logout-button"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={previewLoading || importing}
              >
                Choose file
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) previewWorkbook(file);
                  event.target.value = "";
                }}
              />
            </div>

            {previewError ? (
              <p className="page-error" role="alert">
                {previewError}
              </p>
            ) : null}
            {importError ? (
              <p className="page-error" role="alert">
                {importError}
              </p>
            ) : null}
            {previewLoading ? <p className="page-message">Reading spreadsheet…</p> : null}

            {preview ? (
              <div className="import-summary">
                <p>
                  {preview.totalRows} detected {preview.totalRows === 1 ? "row" : "rows"} ·{" "}
                  {preview.headers.length} detected{" "}
                  {preview.headers.length === 1 ? "column" : "columns"}
                </p>
                {preview.unmatchedHeaders.length ? (
                  <p className="import-warning" role="status">
                    {createMissing
                      ? `${preview.unmatchedHeaders.length} unmatched ${
                          preview.unmatchedHeaders.length === 1 ? "column" : "columns"
                        } will be created: ${preview.unmatchedHeaders.join(", ")}`
                      : `${preview.unmatchedHeaders.length} unmatched ${
                          preview.unmatchedHeaders.length === 1 ? "column" : "columns"
                        } will be skipped: ${preview.unmatchedHeaders.join(", ")}`}
                  </p>
                ) : (
                  <p className="import-ok">Every detected column matches this dataset.</p>
                )}

                <div className="dataset-table-wrap import-table-wrap">
                  <table className="dataset-table">
                    <thead>
                      <tr>
                        <th>Excel column</th>
                        <th>Dataset field</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.headers.map((header) => {
                        const match = preview.matchedFields.find((field) => field.header === header);
                        return (
                          <tr key={header}>
                            <td>{header}</td>
                            <td>{match ? match.name : "—"}</td>
                            <td>
                              {match ? "Matched" : createMissing ? "Will create" : "Unmatched"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {preview.preview.length ? (
                  <div className="dataset-table-wrap import-table-wrap">
                    <table className="dataset-table">
                      <thead>
                        <tr>
                          {preview.headers.map((header) => (
                            <th key={header}>{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.preview.map((row, index) => (
                          <tr key={`${importFile?.name || "row"}-${index}`}>
                            {preview.headers.map((header) => (
                              <td key={header}>{row[header] || "—"}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="page-message">No data rows were detected below the header.</p>
                )}

                {roleLabel === "Admin" ? (
                  <label className="check-row import-check">
                    <input
                      type="checkbox"
                      checked={createMissing}
                      onChange={(event) => setCreateMissing(event.target.checked)}
                      disabled={importing}
                    />
                    Create columns for unmatched headers
                  </label>
                ) : null}
              </div>
            ) : null}

            <div className="modal-actions">
              <button
                className="logout-button"
                type="button"
                onClick={() => setImportOpen(false)}
                disabled={importing}
              >
                Cancel
              </button>
              <button
                className="upload-button"
                type="button"
                onClick={handleImport}
                disabled={!preview || previewLoading || importing || preview.totalRows === 0}
              >
                {importing ? "Importing…" : "Confirm & Import"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modalOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!submitting) setModalOpen(false);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-field-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <h2 id="add-field-title">Add Column</h2>
              <button
                className="icon-button"
                type="button"
                aria-label="Close"
                onClick={() => setModalOpen(false)}
                disabled={submitting}
              >
                <X size={18} />
              </button>
            </div>

            <form className="modal-form" onSubmit={handleAddField}>
              {formError ? (
                <p className="page-error" role="alert">
                  {formError}
                </p>
              ) : null}

              <label>
                Name
                <input
                  type="text"
                  value={fieldName}
                  onChange={(event) => handleFieldNameChange(event.target.value)}
                  required
                  autoFocus
                  maxLength={255}
                />
              </label>

              <label>
                Field key
                <input
                  type="text"
                  value={fieldKey}
                  onChange={(event) => {
                    setFieldKeyTouched(true);
                    setFieldKey(event.target.value);
                  }}
                  required
                  maxLength={255}
                />
              </label>

              <label>
                Field type
                <select value={fieldType} onChange={(event) => setFieldType(event.target.value)}>
                  {FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>

              <label className="check-row">
                <input
                  type="checkbox"
                  checked={isRequired}
                  onChange={(event) => setIsRequired(event.target.checked)}
                />
                Required
              </label>

              <div className="modal-actions">
                <button
                  className="logout-button"
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button className="upload-button" type="submit" disabled={submitting}>
                  {submitting ? "Adding…" : "Add Column"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {rowModalOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!rowSubmitting) setRowModalOpen(false);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-row-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <h2 id="add-row-title">Add Row</h2>
              <button
                className="icon-button"
                type="button"
                aria-label="Close"
                onClick={() => setRowModalOpen(false)}
                disabled={rowSubmitting}
              >
                <X size={18} />
              </button>
            </div>

            <form className="modal-form" onSubmit={handleAddRow}>
              {rowError ? (
                <p className="page-error" role="alert">
                  {rowError}
                </p>
              ) : null}

              {fields.map((field, index) => (
                <label key={field.id} className={field.field_type === "boolean" ? "check-row" : undefined}>
                  {field.field_type === "boolean" ? (
                    <input
                      type="checkbox"
                      checked={Boolean(rowValues[field.field_key])}
                      onChange={(event) => updateRowValue(field.field_key, event.target.checked)}
                    />
                  ) : null}
                  <span>
                    {field.name}
                    {field.is_required ? " *" : ""}
                  </span>
                  {field.field_type === "boolean" ? null : (
                    <input
                      type={inputTypeFor(field.field_type)}
                      value={rowValues[field.field_key] ?? ""}
                      onChange={(event) => updateRowValue(field.field_key, event.target.value)}
                      required={field.is_required}
                      autoFocus={index === 0}
                    />
                  )}
                </label>
              ))}

              <div className="modal-actions">
                <button
                  className="logout-button"
                  type="button"
                  onClick={() => setRowModalOpen(false)}
                  disabled={rowSubmitting}
                >
                  Cancel
                </button>
                <button className="upload-button" type="submit" disabled={rowSubmitting}>
                  {rowSubmitting ? "Saving…" : "Add Row"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!deleting) setDeleteTarget(null);
          }}
        >
          <div
            className="modal confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-row-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="delete-row-title">Delete this row?</h2>
            <p className="confirm-copy">The row and its cell values will be removed.</p>
            <div className="modal-actions">
              <button
                className="logout-button"
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button className="delete-row" type="button" onClick={handleDeleteRow} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete row"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default DatasetDetail;
