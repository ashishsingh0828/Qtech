import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import {
  ArrowLeft,
  ChevronDown,
  Database,
  LogOut,
  Pencil,
  Plus,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import "./Dashboard.css";
import "./DatasetDetail.css";

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

function EditableCell({ field, value, recordId, datasetId, onSaved, onUnauthorized }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [statusText, setStatusText] = useState("");
  const skipCommit = useRef(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (typeof inputRef.current.select === "function" && field.field_type !== "date") {
        inputRef.current.select();
      }
    }
  }, [editing, field.field_type]);

  function beginEdit() {
    skipCommit.current = false;
    setDraft(draftFromValue(field, value));
    setStatus("");
    setStatusText("");
    setEditing(true);
  }

  function cancelEdit() {
    skipCommit.current = true;
    setEditing(false);
  }

  async function commitEdit() {
    if (skipCommit.current) {
      skipCommit.current = false;
      return;
    }

    setEditing(false);

    if (draftsMatch(field, value, draft)) {
      return;
    }

    const nextValue =
      field.field_type === "boolean" ? (draft === "" ? "" : draft === "true") : draft;
    setStatus("saving");
    setStatusText("Saving…");

    try {
      const { data } = await axios.patch(
        `${API_BASE}/api/datasets/${datasetId}/records/${recordId}/cells`,
        { field_id: field.id, value: nextValue },
        authConfig()
      );
      onSaved(recordId, field.field_key, data.updated?.value ?? nextValue);
      setStatus("saved");
      setStatusText("Saved");
      window.setTimeout(() => {
        setStatus((current) => (current === "saved" ? "" : current));
      }, 1200);
    } catch (err) {
      if (err.response?.status === 401) {
        onUnauthorized();
        return;
      }
      setStatus("error");
      setStatusText(errorMessage(err, "Unable to save this cell."));
    }
  }

  function onKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
    }
  }

  const shown = cellText(field, value);

  return (
    <td className={`editable-cell ${status ? `cell-${status}` : ""}`}>
      {editing ? (
        field.field_type === "boolean" ? (
          <select
            ref={inputRef}
            className="cell-input"
            value={draft}
            aria-label={field.name}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitEdit}
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
            onBlur={commitEdit}
            onKeyDown={onKeyDown}
          />
        )
      ) : (
        <div className="cell-display" onDoubleClick={beginEdit}>
          <span className={shown ? undefined : "cell-empty"}>{shown || "—"}</span>
          <button
            className="cell-edit"
            type="button"
            aria-label={`Edit ${field.name}`}
            onClick={beginEdit}
          >
            <Pencil size={13} aria-hidden="true" />
          </button>
          {statusText ? <span className="cell-status">{statusText}</span> : null}
        </div>
      )}
    </td>
  );
}

function DatasetDetail() {
  const navigate = useNavigate();
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
  const fileInputRef = useRef(null);

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
    setCreateMissing(true);
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
      await reloadRecords();
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
  const filteredRecords = records.filter((record) => {
    if (!needle) return true;
    return fields.some((field) => {
      const raw = record.values?.[field.field_key];
      const displayed = cellText(field, raw).toLowerCase();
      return displayed.includes(needle) || String(raw ?? "").toLowerCase().includes(needle);
    });
  });

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
            {dataset ? (
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
                    {needle
                      ? `${filteredRecords.length} of ${records.length} rows`
                      : `${records.length} ${records.length === 1 ? "row" : "rows"}`}
                  </p>
                </div>
                <div className="sheet-tools">
                  <label className="sheet-search">
                    <Search size={16} aria-hidden="true" />
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search rows"
                      aria-label="Search rows"
                    />
                  </label>
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
                    Import Excel
                  </button>
                  <button
                    className="upload-button"
                    type="button"
                    onClick={openRowModal}
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

              {fields.length === 0 ? (
                <p className="page-message">Add a column before entering rows.</p>
              ) : null}

              {fields.length > 0 && recordsLoading ? (
                <p className="page-message">Loading rows…</p>
              ) : null}

              {fields.length > 0 && !recordsLoading && filteredRecords.length === 0 ? (
                <p className="page-message">
                  {records.length === 0 ? "No rows yet." : "No rows match your search."}
                </p>
              ) : null}

              {fields.length > 0 && !recordsLoading && filteredRecords.length > 0 ? (
                <div className="dataset-table-wrap sheet-table-wrap">
                  <table className="dataset-table sheet-table">
                    <thead>
                      <tr>
                        {fields.map((field) => (
                          <th key={field.id}>
                            {field.name}
                            {field.is_required ? <span className="required-mark">*</span> : null}
                          </th>
                        ))}
                        <th className="actions-col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRecords.map((record) => (
                        <tr key={record.id}>
                          {fields.map((field) => (
                            <EditableCell
                              key={field.id}
                              field={field}
                              value={record.values?.[field.field_key]}
                              recordId={record.id}
                              datasetId={id}
                              onSaved={handleCellSaved}
                              onUnauthorized={leaveForLogin}
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
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
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

                <label className="check-row import-check">
                  <input
                    type="checkbox"
                    checked={createMissing}
                    onChange={(event) => setCreateMissing(event.target.checked)}
                    disabled={importing}
                  />
                  Create columns for unmatched headers
                </label>
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
