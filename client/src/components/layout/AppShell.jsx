import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Clock,
  Database,
  LogOut,
  PanelLeft,
  Search,
  Settings,
  Users,
} from "lucide-react";
import axios from "axios";
import NotificationBell from "./NotificationBell";
import CommandPalette from "./CommandPalette";
import { useAuth } from "../../auth/AuthProvider";
import { useToast } from "../toast-context";
import { API_BASE, authConfig, clearSession, errorMessage, initials } from "../../lib/session";
import "./shell.css";

const NAV = [
  { to: "/dashboard", label: "Home", icon: Database, adminOnly: false },
  { to: "/users", label: "Users", icon: Users, manageUsers: true },
  { to: "/audit", label: "Audit Trail", icon: Clock, adminOnly: false },
  { to: "/settings", label: "Settings", icon: Settings, adminOnly: false },
];

function pageTitle(pathname) {
  if (pathname.startsWith("/datasets/")) return "Spreadsheet";
  if (pathname.startsWith("/users")) return "Users & Permissions";
  if (pathname.startsWith("/audit")) return "Audit Trail";
  if (pathname.startsWith("/settings")) return "Settings";
  return "Home";
}

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { notify } = useToast();
  const { session } = useAuth();
  const user = session?.user;
  const permissions = session?.permissions || {};
  const roleLabel = user?.roleTitle || "User";
  const searchRef = useRef(null);
  const menuRef = useRef(null);
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const bleed = location.pathname.startsWith("/datasets/");
  const title = pageTitle(location.pathname);

  useEffect(() => {
    function onKey(event) {
      const target = event.target;
      const typing = target instanceof HTMLElement
        && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function onPointer(event) {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [menuOpen]);

  function handleLogout() {
    clearSession(navigate);
  }

  async function savePassword(event) {
    event.preventDefault();
    setSavingPassword(true);
    setPasswordError("");
    try {
      await axios.patch(
        `${API_BASE}/api/auth/password`,
        { currentPassword, newPassword: nextPassword },
        authConfig()
      );
      setPasswordOpen(false);
      setCurrentPassword("");
      setNextPassword("");
      notify("Password updated");
    } catch (err) {
      setPasswordError(errorMessage(err, "Unable to change password."));
    } finally {
      setSavingPassword(false);
    }
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
          {NAV.filter((item) => !item.manageUsers || permissions.canManageUsers).map((item) => {
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
          <span className={`role-pill role-${user?.role || "user"}`}>{roleLabel}</span>
          <button className="collapse-button" type="button" onClick={() => setCollapsed((value) => !value)}>
            <PanelLeft size={18} aria-hidden="true" />
            <span className="collapse-label">{collapsed ? "Expand" : "Collapse"}</span>
          </button>
        </div>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <div className="topbar-title">
            <p>QTech</p>
            <h1>{title}</h1>
          </div>
          <form className="topbar-search" onSubmit={submitSearch}>
            <Search size={16} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search datasets"
              aria-label="Search datasets"
            />
            <kbd>/</kbd>
          </form>
          <div className="topbar-profile">
            <NotificationBell />
            <div className="avatar-menu" ref={menuRef}>
              <button
                className="avatar-trigger"
                type="button"
                aria-expanded={menuOpen}
                aria-label="Account menu"
                onClick={() => setMenuOpen((value) => !value)}
              >
                <span className="avatar" title={user?.name || "User"}>
                  {initials(user?.name)}
                </span>
                <span className="profile-copy">
                  <strong>{user?.name || "Signed in"}</strong>
                  <span className={`role-pill role-${user?.role || "user"}`}>{roleLabel}</span>
                </span>
              </button>
              {menuOpen ? (
                <div className="avatar-pop" role="menu">
                  <p>{user?.email || "Signed in"}</p>
                  <button className="profile-logout" type="button" role="menuitem" onClick={() => { setMenuOpen(false); setPasswordOpen(true); }}>
                    Change password
                  </button>
                  <button className="profile-logout" type="button" role="menuitem" onClick={handleLogout}>
                    <LogOut size={16} aria-hidden="true" />
                    Logout
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <div className={bleed ? "shell-content is-bleed" : "shell-content"}>
          <Outlet />
        </div>
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        {passwordOpen ? (
          <div className="modal-backdrop" onClick={() => { if (!savingPassword) setPasswordOpen(false); }}>
            <form className="password-card" onSubmit={savePassword} onClick={(event) => event.stopPropagation()}>
              <h2>Change password</h2>
              <label>
                Current password
                <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
              </label>
              <label>
                New password
                <input type="password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} minLength={8} required />
              </label>
              {passwordError ? <p className="login-error">{passwordError}</p> : null}
              <div className="password-actions">
                <button className="profile-logout" type="button" onClick={() => setPasswordOpen(false)} disabled={savingPassword}>Cancel</button>
                <button className="login-submit" type="submit" disabled={savingPassword}>{savingPassword ? "Saving…" : "Update password"}</button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default AppShell;
