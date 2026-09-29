import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API_BASE, authConfig, clearSession, errorMessage, formatRole, isAdminRole, readUser } from "../lib/session";
import "../components/grid/grid.css";
import "../components/layout/shell.css";

function UsersPage() {
  const navigate = useNavigate();
  const admin = isAdminRole(readUser()?.role);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(admin);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    if (!admin) return undefined;
    let active = true;
    async function load() {
      try {
        const { data } = await axios.get(`${API_BASE}/api/users`, authConfig());
        if (!active) return;
        setUsers(data.users || []);
      } catch (err) {
        if (!active) return;
        if (err.response?.status === 401) {
          clearSession(navigate);
          return;
        }
        setError(errorMessage(err, "Unable to load users."));
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [admin, navigate]);

  async function changeRole(person, role) {
    setSavingId(person.id);
    setError("");
    try {
      const { data } = await axios.patch(`${API_BASE}/api/users/${person.id}/role`, { role }, authConfig());
      setUsers((current) => current.map((entry) => (entry.id === person.id ? { ...entry, ...data.user } : entry)));
      const session = readUser();
      if (session && Number(session.id) === Number(person.id)) {
        localStorage.setItem("user", JSON.stringify({ ...session, role: data.user.role }));
      }
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        return;
      }
      setError(errorMessage(err, "Unable to update this role."));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="page-frame">
      <div className="page-heading">
        <div>
          <h1>Users & Permissions</h1>
          <p>Assign workspace roles. Column view and edit access is set from a dataset’s Permissions button.</p>
        </div>
      </div>
      {!admin ? (
        <section className="users-card">
          <p>Only an Admin can change user roles. Ask an Admin to open a dataset and use Permissions to set your column access.</p>
        </section>
      ) : null}
      {error ? <p className="sheet-banner is-error">{error}</p> : null}
      {admin && loading ? <p>Loading users…</p> : null}
      {admin && !loading ? (
        <section className="users-card">
          <table className="perm-table">
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
                      value={formatRole(person.role)}
                      disabled={savingId === person.id}
                      aria-label={`Role for ${person.name}`}
                      onChange={(event) => changeRole(person, event.target.value)}
                    >
                      <option value="Admin">Admin</option>
                      <option value="Manager">Manager</option>
                      <option value="Validator">Validator</option>
                      <option value="Service">Service</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

export default UsersPage;
