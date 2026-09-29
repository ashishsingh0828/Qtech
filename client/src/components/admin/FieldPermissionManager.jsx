import { useEffect, useState } from "react";
import axios from "axios";
import { X } from "lucide-react";
import { API_BASE, authConfig, clearSession, errorMessage, formatRole } from "../../lib/session";
import "../grid/grid.css";

function FieldPermissionManager({ open, datasetId, onClose, navigate }) {
  const [people, setPeople] = useState([]);
  const [userId, setUserId] = useState("");
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    let active = true;

    async function loadPeople() {
      try {
        const { data } = await axios.get(`${API_BASE}/api/users`, authConfig());
        if (!active) return;
        const managers = (data.users || []).filter((person) => formatRole(person.role) === "Managing Person");
        setPeople(managers);
        setUserId(managers[0] ? String(managers[0].id) : "");
      } catch (err) {
        if (!active) return;
        if (err.response?.status === 401) {
          clearSession(navigate);
          return;
        }
        setError(errorMessage(err, "Unable to load managing persons."));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadPeople();
    return () => {
      active = false;
    };
  }, [open, navigate]);

  useEffect(() => {
    if (!open || !userId) return undefined;
    let active = true;

    async function loadAccess() {
      try {
        const { data } = await axios.get(`${API_BASE}/api/datasets/${datasetId}/permissions`, {
          ...authConfig(),
          params: { user_id: userId },
        });
        if (!active) return;
        setFields(data.fields || []);
      } catch (err) {
        if (!active) return;
        if (err.response?.status === 401) {
          clearSession(navigate);
          return;
        }
        setError(errorMessage(err, "Unable to load column permissions."));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadAccess();
    return () => {
      active = false;
    };
  }, [open, userId, datasetId, navigate]);

  function updateFlag(fieldId, key, checked) {
    setFields((current) =>
      current.map((field) => {
        if (Number(field.id) !== Number(fieldId)) return field;
        const next = { ...field, [key]: checked };
        if (key === "can_edit" && checked) next.can_view = true;
        if (key === "can_view" && !checked) next.can_edit = false;
        return next;
      })
    );
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await axios.put(
        `${API_BASE}/api/datasets/${datasetId}/permissions`,
        {
          user_id: Number(userId),
          fields: fields.map((field) => ({
            field_id: field.id,
            can_view: Boolean(field.can_view),
            can_edit: Boolean(field.can_edit),
          })),
        },
        authConfig()
      );
      onClose(true);
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        return;
      }
      setError(errorMessage(err, "Unable to save column permissions."));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={() => { if (!saving) onClose(false); }}>
      <div
        className="modal-panel is-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="field-permissions-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <h2 id="field-permissions-title">Column permissions</h2>
            <p className="toolbar-title">Choose what each Managing Person can see and change in this dataset.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close" onClick={() => onClose(false)} disabled={saving}>
            <X size={18} />
          </button>
        </div>

        {error ? <p className="sheet-banner is-error">{error}</p> : null}

        <form onSubmit={save}>
          <label className="perm-label">
            Managing Person
            <select value={userId} onChange={(event) => setUserId(event.target.value)} disabled={!people.length || saving}>
              {people.length === 0 ? <option value="">No managing persons</option> : null}
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name} · {person.email}
                </option>
              ))}
            </select>
          </label>

          {loading ? <p className="import-summary">Loading columns…</p> : null}

          {!loading && userId && fields.length > 0 ? (
            <table className="perm-table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Type</th>
                  <th>View</th>
                  <th>Edit</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field) => (
                  <tr key={field.id}>
                    <td>{field.name}</td>
                    <td>{field.field_type}</td>
                    <td className="toggle-cell">
                      <input
                        type="checkbox"
                        checked={Boolean(field.can_view)}
                        aria-label={`View ${field.name}`}
                        onChange={(event) => updateFlag(field.id, "can_view", event.target.checked)}
                      />
                    </td>
                    <td className="toggle-cell">
                      <input
                        type="checkbox"
                        checked={Boolean(field.can_edit)}
                        aria-label={`Edit ${field.name}`}
                        onChange={(event) => updateFlag(field.id, "can_edit", event.target.checked)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          <div className="modal-actions">
            <button className="ghost-button" type="button" onClick={() => onClose(false)} disabled={saving}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={saving || !userId || fields.length === 0}>
              {saving ? "Saving…" : "Save permissions"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default FieldPermissionManager;
