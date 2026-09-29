import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API_BASE, authConfig, clearSession, errorMessage } from "../lib/session";
import { auditValue, formatTimestamp } from "../lib/cells";
import "../components/grid/grid.css";
import "../components/layout/shell.css";

function AuditPage() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const { data } = await axios.get(`${API_BASE}/api/audit-logs`, authConfig());
        if (!active) return;
        setLogs(data.logs || []);
      } catch (err) {
        if (!active) return;
        if (err.response?.status === 401) {
          clearSession(navigate);
          return;
        }
        setError(errorMessage(err, "Unable to load the audit trail."));
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <div className="page-frame">
      <div className="page-heading">
        <div>
          <h1>Audit Trail</h1>
          <p>Recent cell changes across datasets you can view.</p>
        </div>
      </div>
      {error ? <p className="sheet-banner is-error">{error}</p> : null}
      {loading ? <p>Loading activity…</p> : null}
      {!loading && logs.length === 0 ? <p>No cell changes have been recorded yet.</p> : null}
      {!loading && logs.length > 0 ? (
        <section className="users-card">
          <table className="perm-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Dataset</th>
                <th>User</th>
                <th>Field</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatTimestamp(entry.changed_at)}</td>
                  <td>
                    <button className="col-name" type="button" onClick={() => navigate(`/datasets/${entry.dataset_id}`)}>
                      {entry.dataset_name}
                    </button>
                  </td>
                  <td>{entry.changed_by_name || "Unknown"}</td>
                  <td>{entry.field_name}</td>
                  <td>{auditValue(entry.old_value)} → {auditValue(entry.new_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

export default AuditPage;
