import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Clock,
  Database,
  LogOut,
  PanelLeft,
  Search,
  Settings,
  Shield,
  Users,
} from "lucide-react";
import { formatRole, initials, isAdminRole, readUser } from "../../lib/session";
import "./shell.css";

const NAV = [
  { to: "/dashboard", label: "Datasets", icon: Database, adminOnly: false },
  { to: "/users", label: "Users & Permissions", icon: Users, adminOnly: false },
  { to: "/audit", label: "Audit Trail", icon: Clock, adminOnly: false },
  { to: "/settings", label: "Settings", icon: Settings, adminOnly: false },
];

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = readUser();
  const roleLabel = formatRole(user?.role);
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const bleed = location.pathname.startsWith("/datasets/");

  function handleLogout() {
    localStorage.clear();
    navigate("/login");
  }

  function submitSearch(event) {
    event.preventDefault();
    const term = search.trim();
    navigate(term ? `/dashboard?q=${encodeURIComponent(term)}` : "/dashboard");
  }

  return (
    <div className="shell">
      <aside className={collapsed ? "sidebar is-collapsed" : "sidebar"}>
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">
            <Database size={18} />
          </span>
          <strong>QTech</strong>
        </div>
        <nav className="side-nav" aria-label="Workspace">
          {NAV.filter((item) => !item.adminOnly || isAdminRole(user?.role)).map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                title={item.label}
                className={({ isActive }) => (isActive ? "side-link is-active" : "side-link")}
              >
                <Icon size={18} aria-hidden="true" />
                <span className="nav-label">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <button className="collapse-button" type="button" onClick={() => setCollapsed((value) => !value)}>
            <PanelLeft size={18} aria-hidden="true" />
            <span className="collapse-label">{collapsed ? "Expand" : "Collapse"}</span>
          </button>
        </div>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <form className="topbar-search" onSubmit={submitSearch}>
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search datasets"
              aria-label="Search datasets"
            />
          </form>
          <div className="topbar-profile">
            <div className="profile-copy">
              <strong>{user?.name || "Signed in"}</strong>
              <span className={roleLabel === "Managing Person" ? "role-badge role-manager" : "role-badge"}>
                <Shield size={12} aria-hidden="true" />
                {roleLabel}
              </span>
            </div>
            <span className="avatar" title={user?.name || "User"}>
              {initials(user?.name)}
            </span>
            <button className="profile-logout" type="button" onClick={handleLogout}>
              <LogOut size={16} aria-hidden="true" />
              Logout
            </button>
          </div>
        </header>
        <div className={bleed ? "shell-content is-bleed" : "shell-content"}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default AppShell;
