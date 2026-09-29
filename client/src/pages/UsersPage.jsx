import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API_BASE, authConfig, clearSession, errorMessage, initials } from "../lib/session";
import "./UsersPage.css";

const ROLES = [
  ["admin", "Admin"],
  ["manager", "Manager"],
  ["validator", "Validator"],
  ["service", "Service"],
];

function UsersPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "service", password: "" });
  const [resetFor, setResetFor] = useState(null);
  const [resetPassword, setResetPassword] = useState("");

  useEffect(() => {
    let active = true;
    axios
      .get(`${API_BASE}/api/users`, authConfig())
      .then(({ data }) => {
        if (!active) return;
        setUsers(data.users || []);
      })
      .catch((err) => {
        if (!active) return;
        if (err.response?.status === 401) {
          clearSession(navigate);
          return;
        }
        setError(errorMessage(err, "Unable to load users."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  function patchUser(next) {
    setUsers((current) => current.map((entry) => (entry.id === next.id ? next : entry)));
  }

  async function createUser(event) {
    event.preventDefault();
    setCreating(true);
    setError("");
    try {
      const { data } = await axios.post(`${API_BASE}/api/users`, form, authConfig());
      setUsers((current) => [...current, data.user].sort((left, right) => left.name.localeCompare(right.name)));
      setForm({ name: "", email: "", role: "service", password: "" });
    } catch (err) {
      setError(errorMessage(err, "Unable to create this user."));
    } finally {
      setCreating(false);
    }
  }

  async function changeRole(person, role) {
    setSavingId(person.id);
    setError("");
    try {
      const { data } = await axios.patch(`${API_BASE}/api/users/${person.id}/role`, { role }, authConfig());
      patchUser(data.user);
    } catch (err) {
      setError(errorMessage(err, "Unable to update this role."));
    } finally {
      setSavingId(null);
    }
  }

  async function changeStatus(person) {
    setSavingId(person.id);
    setError("");
    try {
      const { data } = await axios.patch(
        `${API_BASE}/api/users/${person.id}/status`,
        { isActive: !person.isActive },
        authConfig()
      );
      patchUser(data.user);
    } catch (err) {
      setError(errorMessage(err, "Unable to update this user."));
    } finally {
      setSavingId(null);
    }
  }

  async function submitReset(event) {
    event.preventDefault();
    setSavingId(resetFor.id);
    setError("");
    try {
      await axios.post(`${API_BASE}/api/users/${resetFor.id}/reset-password`, { password: resetPassword }, authConfig());
      setResetFor(null);
      setResetPassword("");
    } catch (err) {
      setError(errorMessage(err, "Unable to reset this password."));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="page-frame users-page">
      <div className="page-heading">
        <div>
          <h1>Users</h1>
          <p>Create accounts and assign one of the four workspace roles.</p>
        </div>
      </div>
      {error ? <p className="sheet-banner is-error">{error}</p> : null}
      <form className="user-create" onSubmit={createUser}>
        <input placeholder="Name" aria-label="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        <input type="email" placeholder="Email" aria-label="Email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
        <select aria-label="Role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
          {ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input type="password" placeholder="Initial password" aria-label="Initial password" minLength={8} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
        <button type="submit" disabled={creating}>{creating ? "Creating…" : "Create user"}</button>
      </form>
      {loading ? <p>Loading users…</p> : null}
      {!loading ? (
        <section className="users-card">
          <table className="user-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={6}>No users yet.</td></tr>
              ) : null}
              {users.map((person) => (
                <tr key={person.id}>
                  <td>
                    <span className="user-name">
                      <span className="avatar">{initials(person.name)}</span>
                      {person.name}
                    </span>
                  </td>
                  <td>{person.email}</td>
                  <td>
                    <select
                      className={`role-pill role-${person.role}`}
                      value={person.role}
                      disabled={savingId === person.id}
                      aria-label={`Role for ${person.name}`}
                      onChange={(event) => changeRole(person, event.target.value)}
                    >
                      {ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </td>
                  <td>{person.isActive ? "Active" : "Inactive"}</td>
                  <td>{person.lastLoginAt ? new Date(person.lastLoginAt).toLocaleString() : "—"}</td>
                  <td className="user-actions">
                    <button type="button" disabled={savingId === person.id} onClick={() => changeStatus(person)}>
                      {person.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                    <button type="button" onClick={() => { setResetFor(person); setResetPassword(""); }}>Reset password</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {resetFor ? (
        <form className="user-create" onSubmit={submitReset}>
          <strong>Reset password for {resetFor.name}</strong>
          <input type="password" minLength={8} aria-label="New password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} required />
          <button type="submit" disabled={savingId === resetFor.id}>Save password</button>
          <button type="button" onClick={() => setResetFor(null)}>Cancel</button>
        </form>
      ) : null}
    </div>
  );
}

export default UsersPage;
