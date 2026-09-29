import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { Download, FolderOpen, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import ExcelDropzone from "../components/import/ExcelDropzone";
import "./Dashboard.css";
import { useToast } from "../components/toast-context";

const API_BASE = "http://localhost:5000";

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
  if (normalized === "manager" || normalized === "managing person" || normalized === "managingperson") {
    return "Manager";
  }
  if (normalized === "validator") return "Validator";
  if (normalized === "service") return "Service";

  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

function relativeTime(value) {
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

function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
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

function downloadName(datasetName) {
  const cleaned = String(datasetName || "dataset").replace(/[^\w.\- ]+/g, "").trim();
  return `${cleaned || "dataset"}.xlsx`;
}

function Dashboard() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const sessionUser = readUser();
  const isAdmin = formatRole(sessionUser?.role) === "Admin";
  const canDelete = formatRole(sessionUser?.role) === "Admin" || formatRole(sessionUser?.role) === "Manager";
  const [searchParams] = useSearchParams();
  const datasetQuery = (searchParams.get("q") || "").trim().toLowerCase();

  const [datasets, setDatasets] = useState([]);
  const [stats, setStats] = useState({
    total_datasets: 0,
    total_records: 0,
    active_users: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [restoringId, setRestoringId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [menuId, setMenuId] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameName, setRenameName] = useState("");
  const [renameDescription, setRenameDescription] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadDatasets() {
      setLoading(true);
      setError("");

      try {
        const response = await axios.get(`${API_BASE}/api/datasets`, {
          ...authConfig(),
          params: showArchived ? { include_deleted: true } : undefined,
        });
        if (!active) return;
        const rows = response.data.datasets || [];
        setDatasets(showArchived ? rows.filter((dataset) => dataset.is_deleted) : rows);
        if (response.data.stats) {
          setStats(response.data.stats);
        }
      } catch (err) {
        if (!active) return;
        if (err.response?.status === 401) {
          localStorage.clear();
          navigate("/login");
          return;
        }
        setError(errorMessage(err, "Unable to load datasets."));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadDatasets();

    return () => {
      active = false;
    };
  }, [navigate, refreshKey, showArchived]);

  useEffect(() => {
    const dialogOpen = modalOpen || deleteTarget || renameTarget;
    if (!dialogOpen) return undefined;

    function onKeyDown(event) {
      if (event.key !== "Escape" || submitting || deleting) return;
      setModalOpen(false);
      setDeleteTarget(null);
      if (!renaming) setRenameTarget(null);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, deleteTarget, renameTarget, submitting, deleting, renaming]);

  useEffect(() => {
    if (menuId == null) return undefined;

    function onPointerDown(event) {
      if (!event.target.closest?.("[data-menu-root]")) {
        setMenuId(null);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuId]);

  function openModal() {
    setName("");
    setDescription("");
    setFormError("");
    setModalOpen(true);
  }

  async function handleCreate(event) {
    event.preventDefault();
    setFormError("");
    setSubmitting(true);

    try {
      await axios.post(
        `${API_BASE}/api/datasets`,
        {
          name: name.trim(),
          description: description.trim(),
          created_by: sessionUser?.id,
        },
        authConfig()
      );
      setModalOpen(false);
      setShowArchived(false);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.clear();
        navigate("/login");
        return;
      }
      setFormError(errorMessage(err, "Unable to create the dataset."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDownload(dataset) {
    setDownloadingId(dataset.id);
    setError("");

    try {
      const response = await axios.get(`${API_BASE}/api/datasets/${dataset.id}/export`, {
        ...authConfig(),
        responseType: "blob",
      });
      const blob = new Blob([response.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName(dataset.name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      notify("Export ready");
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.clear();
        navigate("/login");
        return;
      }
      setError(await messageFromResponse(err, "Unable to download this dataset."));
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError("");

    try {
      await axios.delete(`${API_BASE}/api/datasets/${deleteTarget.id}`, authConfig());
      setDeleteTarget(null);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.clear();
        navigate("/login");
        return;
      }
      setError(errorMessage(err, "Unable to archive this dataset."));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  async function handleRestore(dataset) {
    setRestoringId(dataset.id);
    setError("");

    try {
      await axios.patch(`${API_BASE}/api/datasets/${dataset.id}/restore`, {}, authConfig());
      setRefreshKey((value) => value + 1);
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.clear();
        navigate("/login");
        return;
      }
      setError(errorMessage(err, "Unable to restore this dataset."));
    } finally {
      setRestoringId(null);
    }
  }

  function openRename(dataset) {
    setMenuId(null);
    setRenameTarget(dataset);
    setRenameName(dataset.name || "");
    setRenameDescription(dataset.description || "");
    setRenameError("");
  }

  async function handleRename(event) {
    event.preventDefault();
    if (!renameTarget) return;
    setRenaming(true);
    setRenameError("");

    try {
      await axios.patch(
        `${API_BASE}/api/datasets/${renameTarget.id}`,
        {
          name: renameName.trim(),
          description: renameDescription.trim(),
        },
        authConfig()
      );
      setRenameTarget(null);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.clear();
        navigate("/login");
        return;
      }
      setRenameError(errorMessage(err, "Unable to rename this dataset."));
    } finally {
      setRenaming(false);
    }
  }

  const visibleDatasets = datasets.filter((dataset) => {
    if (!datasetQuery) return true;
    const haystack = `${dataset.name || ""} ${dataset.description || ""}`.toLowerCase();
    return haystack.includes(datasetQuery);
  });

  return (
    <div className="dashboard">
      <main className="dashboard-main">
        <section className="dataset-card">
          <div className="dataset-card-head">
            <div>
              <h1>Datasets / Recent Files</h1>
              <p>
                {showArchived
                  ? "Archived datasets can be restored by an Admin."
                  : "Datasets available in the workspace."}
              </p>
            </div>
            <div className="header-actions">
              {isAdmin ? (
                <button
                  className={showArchived ? "row-action" : "logout-button"}
                  type="button"
                  onClick={() => setShowArchived((value) => !value)}
                >
                  {showArchived ? "View Active Datasets" : "View Archived / Deleted Datasets"}
                </button>
              ) : null}
              {!showArchived ? (
                <button className="upload-button" type="button" onClick={openModal}>
                  <Plus size={18} strokeWidth={2} aria-hidden="true" />
                  Create Dataset
                </button>
              ) : null}
            </div>
          </div>

          {!showArchived ? (
            <ExcelDropzone
              navigate={navigate}
              onImported={(dataset) => {
                if (dataset?.id) navigate(`/datasets/${dataset.id}`);
              }}
            />
          ) : null}

          <div className="stats-banner">
            <article>
              <span>Total Equipment</span>
              <strong>{stats.total_equipment ?? stats.total_records ?? 0}</strong>
            </article>
            <article>
              <span>Validation Overdue</span>
              <strong>{stats.validation_overdue ?? 0}</strong>
            </article>
            <article>
              <span>Pending Verifications</span>
              <strong>{stats.pending_verifications ?? 0}</strong>
            </article>
            <article>
              <span>Active AMCs</span>
              <strong>{stats.active_amcs ?? 0}</strong>
            </article>
          </div>

          {error ? (
            <p className="page-error" role="alert">
              {error}
            </p>
          ) : null}

          {loading ? <p className="page-message">Loading datasets…</p> : null}

          {!loading && !error && visibleDatasets.length === 0 ? (
            <div className="dataset-placeholder">
              <FolderOpen size={28} strokeWidth={1.5} aria-hidden="true" />
              <p>
                {datasetQuery
                  ? "No datasets match that search."
                  : showArchived
                    ? "No archived datasets."
                    : "No datasets yet. Create one to get started."}
              </p>
            </div>
          ) : null}

          {!loading && visibleDatasets.length > 0 ? (
            <div className="file-grid">
              {visibleDatasets.map((dataset) => {
                const author = dataset.last_modified_by || dataset.created_by_name || "";
                const menuOpen = menuId === dataset.id;
                return (
                  <article className="file-card" key={dataset.id}>
                    <div className="file-card-top">
                      <h2>
                        {dataset.is_deleted ? (
                          dataset.name
                        ) : (
                          <button type="button" onClick={() => navigate(`/datasets/${dataset.id}`)}>
                            {dataset.name}
                          </button>
                        )}
                      </h2>
                      <div className="menu-root" data-menu-root>
                        <button
                          className="icon-button"
                          type="button"
                          aria-label={`Actions for ${dataset.name}`}
                          aria-expanded={menuOpen}
                          aria-haspopup="menu"
                          onClick={() => setMenuId(menuOpen ? null : dataset.id)}
                        >
                          <MoreHorizontal size={18} aria-hidden="true" />
                        </button>
                        {menuOpen ? (
                          <div className="card-menu" role="menu">
                            {!dataset.is_deleted ? (
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => navigate(`/datasets/${dataset.id}`)}
                              >
                                <FolderOpen size={14} aria-hidden="true" />
                                Open
                              </button>
                            ) : null}
                            {!dataset.is_deleted ? (
                              <button
                                type="button"
                                role="menuitem"
                                disabled={downloadingId === dataset.id}
                                onClick={() => {
                                  setMenuId(null);
                                  handleDownload(dataset);
                                }}
                              >
                                <Download size={14} aria-hidden="true" />
                                {downloadingId === dataset.id ? "Exporting…" : "Export"}
                              </button>
                            ) : null}
                            {!dataset.is_deleted ? (
                              <button type="button" role="menuitem" onClick={() => openRename(dataset)}>
                                <Pencil size={14} aria-hidden="true" />
                                Rename
                              </button>
                            ) : null}
                            {canDelete && !dataset.is_deleted ? (
                              <button
                                className="menu-danger"
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setMenuId(null);
                                  setDeleteTarget(dataset);
                                }}
                              >
                                <Trash2 size={14} aria-hidden="true" />
                                Delete Dataset
                              </button>
                            ) : null}
                            {isAdmin && dataset.is_deleted ? (
                              <button
                                type="button"
                                role="menuitem"
                                disabled={restoringId === dataset.id}
                                onClick={() => {
                                  setMenuId(null);
                                  handleRestore(dataset);
                                }}
                              >
                                <RotateCcw size={14} aria-hidden="true" />
                                {restoringId === dataset.id ? "Restoring…" : "Restore"}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <p className="file-card-desc">{dataset.description || "No description"}</p>
                    <div className="file-card-badges">
                      <span className="count-badge">{dataset.row_count ?? dataset.records_count ?? 0} records</span>
                      <span className="count-badge">{dataset.column_count ?? dataset.fields_count ?? 0} columns</span>
                    </div>
                    {!dataset.is_deleted ? (
                      <div className="file-card-actions">
                        <button type="button" onClick={() => navigate(`/datasets/${dataset.id}`)}>
                          Open
                        </button>
                        <button
                          type="button"
                          disabled={downloadingId === dataset.id}
                          onClick={() => handleDownload(dataset)}
                        >
                          {downloadingId === dataset.id ? "Exporting…" : "Export (.xlsx)"}
                        </button>
                        {canDelete ? (
                          <button className="is-danger" type="button" onClick={() => setDeleteTarget(dataset)}>
                            Delete Dataset
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="file-card-foot">
                      <span className="avatar" title={author || "Unknown"}>
                        {initials(author)}
                      </span>
                      <span>{relativeTime(dataset.last_modified_at || dataset.updated_at)}</span>
                    </div>
                  </article>
                );
              })}
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
            aria-labelledby="create-dataset-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <h2 id="create-dataset-title">Create Dataset</h2>
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

            <form className="modal-form" onSubmit={handleCreate}>
              {formError ? (
                <p className="page-error" role="alert">
                  {formError}
                </p>
              ) : null}

              <label>
                Name
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  autoFocus
                  maxLength={255}
                />
              </label>

              <label>
                Description
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={4}
                />
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
                  {submitting ? "Creating…" : "Create Dataset"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {renameTarget ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!renaming) setRenameTarget(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-dataset-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <h2 id="rename-dataset-title">Rename dataset</h2>
              <button
                className="icon-button"
                type="button"
                aria-label="Close"
                onClick={() => setRenameTarget(null)}
                disabled={renaming}
              >
                <X size={18} />
              </button>
            </div>
            <form className="modal-form" onSubmit={handleRename}>
              {renameError ? (
                <p className="page-error" role="alert">
                  {renameError}
                </p>
              ) : null}
              <label>
                Name
                <input
                  type="text"
                  value={renameName}
                  onChange={(event) => setRenameName(event.target.value)}
                  required
                  autoFocus
                  maxLength={255}
                />
              </label>
              <label>
                Description
                <textarea
                  value={renameDescription}
                  onChange={(event) => setRenameDescription(event.target.value)}
                  rows={4}
                />
              </label>
              <div className="modal-actions">
                <button
                  className="logout-button"
                  type="button"
                  onClick={() => setRenameTarget(null)}
                  disabled={renaming}
                >
                  Cancel
                </button>
                <button className="upload-button" type="submit" disabled={renaming}>
                  {renaming ? "Saving…" : "Save"}
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
            aria-labelledby="delete-dataset-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="delete-dataset-title">Archive this dataset?</h2>
            <p className="confirm-copy">
              {deleteTarget.name} will be hidden from the active list. An Admin can restore it later.
            </p>
            <div className="modal-actions">
              <button
                className="logout-button"
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button className="delete-row" type="button" onClick={handleDelete} disabled={deleting}>
                {deleting ? "Archiving…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default Dashboard;
