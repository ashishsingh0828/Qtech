import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Database, Download, FolderOpen, LogOut, Plus, RotateCcw, Trash2, Users, X } from "lucide-react";
import "./Dashboard.css";

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
  if (normalized === "managing person" || normalized === "managingperson") {
    return "Managing Person";
  }

  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value) {
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
  const [sessionUser, setSessionUser] = useState(readUser);
  const roleLabel = formatRole(sessionUser?.role);
  const isAdmin = roleLabel === "Admin";
  const roleClass =
    roleLabel === "Admin"
      ? "role-badge role-admin"
      : roleLabel === "Managing Person"
        ? "role-badge role-manager"
        : "role-badge";

  const [datasets, setDatasets] = useState([]);
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
  const [adminOpen, setAdminOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [roleSavingId, setRoleSavingId] = useState(null);

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
    const dialogOpen = modalOpen || adminOpen || deleteTarget;
    if (!dialogOpen) return undefined;

    function onKeyDown(event) {
      if (event.key !== "Escape" || submitting || deleting) return;
      setModalOpen(false);
      setAdminOpen(false);
      setDeleteTarget(null);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, adminOpen, deleteTarget, submitting, deleting]);

  function handleLogout() {
    localStorage.clear();
    navigate("/login");
  }

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
      const response = await axios.get(`${API_BASE}/api/datasets/${dataset.id}/export-excel`, {
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

  async function openAdminPanel() {
    setAdminOpen(true);
    setUsersLoading(true);
    setUsersError("");

    try {
      const { data } = await axios.get(`${API_BASE}/api/users`, authConfig());
      setUsers(data.users || []);
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.clear();
        navigate("/login");
        return;
      }
      setUsersError(errorMessage(err, "Unable to load users."));
    } finally {
      setUsersLoading(false);
    }
  }

  async function changeRole(person, role) {
    setRoleSavingId(person.id);
    setUsersError("");

    try {
      const { data } = await axios.patch(
        `${API_BASE}/api/users/${person.id}/role`,
        { role },
        authConfig()
      );
      const updated = data.user;
      setUsers((current) =>
        current.map((entry) => (entry.id === person.id ? { ...entry, ...updated } : entry))
      );

      if (sessionUser && Number(sessionUser.id) === Number(person.id)) {
        const nextUser = { ...sessionUser, role: updated.role };
        localStorage.setItem("user", JSON.stringify(nextUser));
        setSessionUser(nextUser);
      }
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.clear();
        navigate("/login");
        return;
      }
      setUsersError(errorMessage(err, "Unable to update this role."));
    } finally {
      setRoleSavingId(null);
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
            <strong>{sessionUser?.name || "Signed in"}</strong>
            <span className={roleClass}>{roleLabel}</span>
          </div>
          {isAdmin ? (
            <button className="logout-button" type="button" onClick={openAdminPanel}>
              <Users size={16} strokeWidth={2} aria-hidden="true" />
              Admin Panel
            </button>
          ) : null}
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

          {error ? (
            <p className="page-error" role="alert">
              {error}
            </p>
          ) : null}

          {loading ? <p className="page-message">Loading datasets…</p> : null}

          {!loading && !error && datasets.length === 0 ? (
            <div className="dataset-placeholder">
              <FolderOpen size={28} strokeWidth={1.5} aria-hidden="true" />
              <p>
                {showArchived
                  ? "No archived datasets."
                  : "No datasets yet. Create one to get started."}
              </p>
            </div>
          ) : null}

          {!loading && datasets.length > 0 ? (
            <div className="dataset-table-wrap">
              <table className="dataset-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Description</th>
                    <th>Last Modified At</th>
                    <th>Last Modified By</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {datasets.map((dataset) => (
                    <tr key={dataset.id}>
                      <td>{dataset.name}</td>
                      <td>{dataset.description || "—"}</td>
                      <td>{formatDate(dataset.last_modified_at || dataset.updated_at)}</td>
                      <td>{dataset.last_modified_by || "—"}</td>
                      <td>
                        <div className="row-actions">
                          {!dataset.is_deleted ? (
                            <button
                              className="row-action"
                              type="button"
                              onClick={() => navigate(`/datasets/${dataset.id}`)}
                            >
                              Open
                            </button>
                          ) : null}
                          {!dataset.is_deleted ? (
                            <button
                              className="row-action"
                              type="button"
                              onClick={() => handleDownload(dataset)}
                              disabled={downloadingId === dataset.id}
                            >
                              <Download size={14} aria-hidden="true" />
                              {downloadingId === dataset.id ? "Downloading…" : "Download"}
                            </button>
                          ) : null}
                          {isAdmin && !dataset.is_deleted ? (
                            <button
                              className="delete-row"
                              type="button"
                              onClick={() => setDeleteTarget(dataset)}
                            >
                              <Trash2 size={14} aria-hidden="true" />
                              Delete
                            </button>
                          ) : null}
                          {isAdmin && dataset.is_deleted ? (
                            <button
                              className="row-action"
                              type="button"
                              onClick={() => handleRestore(dataset)}
                              disabled={restoringId === dataset.id}
                            >
                              <RotateCcw size={14} aria-hidden="true" />
                              {restoringId === dataset.id ? "Restoring…" : "Restore"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

      {adminOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!roleSavingId) setAdminOpen(false);
          }}
        >
          <div
            className="modal admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-panel-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <h2 id="admin-panel-title">Admin Panel</h2>
              <button
                className="icon-button"
                type="button"
                aria-label="Close"
                onClick={() => setAdminOpen(false)}
                disabled={Boolean(roleSavingId)}
              >
                <X size={18} />
              </button>
            </div>
            <p className="confirm-copy">Registered users and their roles.</p>
            {usersError ? (
              <p className="page-error" role="alert">
                {usersError}
              </p>
            ) : null}
            {usersLoading ? <p className="page-message">Loading users…</p> : null}
            {!usersLoading && users.length > 0 ? (
              <div className="dataset-table-wrap admin-table-wrap">
                <table className="dataset-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((person) => (
                      <tr key={person.id}>
                        <td>{person.name}</td>
                        <td>{person.email}</td>
                        <td>
                          <select
                            className="role-select"
                            value={formatRole(person.role)}
                            disabled={roleSavingId === person.id}
                            aria-label={`Role for ${person.name}`}
                            onChange={(event) => changeRole(person, event.target.value)}
                          >
                            <option value="Admin">Admin</option>
                            <option value="Managing Person">Managing Person</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default Dashboard;
