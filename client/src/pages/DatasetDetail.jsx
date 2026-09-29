import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { ArrowLeft, Database, LogOut, Plus, Search, Trash2, X } from "lucide-react";
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
    const dialogOpen = modalOpen || rowModalOpen || deleteTarget;
    if (!dialogOpen) return undefined;

    function onKeyDown(event) {
      if (event.key !== "Escape" || submitting || rowSubmitting || deleting) return;
      setModalOpen(false);
      setRowModalOpen(false);
      setDeleteTarget(null);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, rowModalOpen, deleteTarget, submitting, rowSubmitting, deleting]);

  function handleLogout() {
    localStorage.clear();
    navigate("/login");
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
                            <td key={field.id}>{cellText(field, record.values?.[field.field_key])}</td>
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
        </section>
      </main>

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
