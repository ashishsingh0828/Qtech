import { useNavigate } from "react-router-dom";
import { Database, FolderOpen, LogOut, Plus } from "lucide-react";
import "./Dashboard.css";

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

function Dashboard() {
  const navigate = useNavigate();
  const user = readUser();
  const roleLabel = formatRole(user?.role);
  const roleClass =
    roleLabel === "Admin"
      ? "role-badge role-admin"
      : roleLabel === "Managing Person"
        ? "role-badge role-manager"
        : "role-badge";

  function handleLogout() {
    localStorage.clear();
    navigate("/login");
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
        <section className="dataset-card">
          <div className="dataset-card-head">
            <div>
              <h1>Datasets / Recent Files</h1>
              <p>Uploads and datasets you can review will be listed here.</p>
            </div>
            <button className="upload-button" type="button">
              <Plus size={18} strokeWidth={2} aria-hidden="true" />
              Create / Upload New Dataset
            </button>
          </div>

          <div className="dataset-placeholder">
            <FolderOpen size={28} strokeWidth={1.5} aria-hidden="true" />
            <p>No datasets or recent files yet.</p>
          </div>
        </section>
      </main>
    </div>
  );
}

export default Dashboard;
