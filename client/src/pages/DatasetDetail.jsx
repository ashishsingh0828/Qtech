import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { ArrowLeft, Database, LogOut, Plus, X } from "lucide-react";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [fieldName, setFieldName] = useState("");
  const [fieldKey, setFieldKey] = useState("");
  const [fieldKeyTouched, setFieldKeyTouched] = useState(false);
  const [fieldType, setFieldType] = useState("text");
  const [isRequired, setIsRequired] = useState(false);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadDataset() {
      setLoading(true);
      setError("");

      try {
        const { data } = await axios.get(`${API_BASE}/api/datasets/${id}`, authConfig());
        if (active) setDataset(data.dataset);
      } catch (err) {
        if (!active) return;
        if (err.response?.status === 401) {
          localStorage.clear();
          navigate("/login");
          return;
        }
        setDataset(null);
        setError(errorMessage(err, "Unable to load this dataset."));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadDataset();

    return () => {
      active = false;
    };
  }, [id, navigate, refreshKey]);

  useEffect(() => {
    if (!modalOpen) return undefined;

    function onKeyDown(event) {
      if (event.key === "Escape" && !submitting) {
        setModalOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, submitting]);

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

  const fields = dataset?.fields || [];

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
        <section className="dataset-card">
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
    </div>
  );
}

export default DatasetDetail;
