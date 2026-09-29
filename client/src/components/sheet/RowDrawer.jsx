import { useEffect, useState } from "react";
import axios from "axios";
import { X } from "lucide-react";
import { API_BASE, authConfig, errorMessage } from "../../lib/session";
import { formatStamp, statusTone } from "../../lib/sheetFormat";

const STEPS = ["Not Due", "AMC Due", "Proposal Sent"];
const ENDINGS = ["Acknowledged", "Declined"];

function readSemantic(row, schema, semantic) {
  const column = (schema?.columns || []).find((entry) => entry.semantic === semantic);
  if (!column) return "";
  const value = row?.data?.[column.key];
  return value == null ? "" : String(value);
}

function columnLabel(schema, key) {
  return (schema?.columns || []).find((column) => column.key === key)?.label || key || "Field";
}

function RowDrawer({
  datasetId,
  row,
  schema,
  timeZone,
  permissions,
  acting,
  actionError,
  onClose,
  onValidate,
  onVerify,
  onAmc,
}) {
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [proposalDate, setProposalDate] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!row) return undefined;
    let ignore = false;
    axios
      .get(`${API_BASE}/api/datasets/${datasetId}/rows/${row.id}/activity`, authConfig())
      .then(({ data }) => {
        if (!ignore) setActivity(data.activity || []);
      })
      .catch((err) => {
        if (!ignore) setError(errorMessage(err, "Unable to load activity."));
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [datasetId, row, reload]);

  if (!row) return null;

  const customerGroup = (schema?.groups || []).find((group) => group.groupKey === "customer_detail");
  const customerColumns = (schema?.columns || []).filter((column) => column.groupId === customerGroup?.id).slice(0, 4);
  const name = readSemantic(row, schema, "customer_name") || "Record";
  const warranty = readSemantic(row, schema, "warranty_live") || "Unknown";
  const amc = readSemantic(row, schema, "amc_status") || "Not Due";
  const validated = readSemantic(row, schema, "validated");
  const verified = readSemantic(row, schema, "verified");

  return (
    <div className="drawer-root">
      <button className="drawer-backdrop" type="button" aria-label="Close record" onClick={onClose} />
      <aside className="record-drawer" role="dialog" aria-label="Record">
        <header className="drawer-head">
          <div>
            <p className="drawer-kicker">Customer</p>
            <h2>{name}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close" onClick={onClose}>
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>
        <div className="drawer-body">
          <div className="customer-facts">
            {customerColumns.map((column) => (
              <p key={column.key}>
                <span>{column.label}</span>
                <strong>{row.data?.[column.key] ? String(row.data[column.key]) : "—"}</strong>
              </p>
            ))}
            <p>
              <span>Warranty</span>
              <strong><span className={`status-pill tone-${statusTone(warranty) || "stone"}`}>{warranty}</span></strong>
            </p>
          </div>

          <section>
            <h3>AMC</h3>
            <ol className="amc-stepper">
              {STEPS.map((step) => (
                <li key={step} className={step === amc ? "is-current" : ""}>{step}</li>
              ))}
              <li className={ENDINGS.includes(amc) ? "is-current" : ""}>{ENDINGS.includes(amc) ? amc : "Acknowledged / Declined"}</li>
            </ol>
            {permissions.canManageAmc && amc === "AMC Due" ? (
              <div className="drawer-actions">
                <label>
                  Proposal date
                  <input type="date" value={proposalDate} onChange={(event) => setProposalDate(event.target.value)} />
                </label>
                <button className="button-primary" type="button" disabled={acting} onClick={() => onAmc(row, { action: "proposal_sent", date: proposalDate || undefined })}>
                  {acting ? "Saving…" : "Mark proposal sent"}
                </button>
              </div>
            ) : null}
            {permissions.canManageAmc && amc === "Proposal Sent" ? (
              <div className="drawer-actions">
                <label>
                  Note
                  <textarea value={note} rows={3} onChange={(event) => setNote(event.target.value)} />
                </label>
                <button className="button-primary" type="button" disabled={acting} onClick={() => onAmc(row, { action: "acknowledge", note })}>Acknowledged</button>
                <button className="button-secondary" type="button" disabled={acting} onClick={() => onAmc(row, { action: "decline", note })}>Declined</button>
              </div>
            ) : null}
            {permissions.canResetAmc && amc !== "Not Due" && amc !== "AMC Due" ? (
              <button className="button-secondary" type="button" disabled={acting} onClick={() => onAmc(row, { action: "reset" })}>Reset AMC</button>
            ) : null}
          </section>

          <section>
            <h3>Validation</h3>
            <p className="drawer-status">Validated: {validated || "—"} · Verified: {verified || "—"}</p>
            <div className="drawer-actions">
              {permissions.canValidate ? (
                <>
                  <button className="button-secondary" type="button" disabled={acting} onClick={() => onValidate(row, "Yes")}>Mark yes</button>
                  <button className="button-secondary" type="button" disabled={acting} onClick={() => onValidate(row, "No")}>Mark no</button>
                </>
              ) : null}
              {permissions.canClearValidation && validated ? (
                <button className="button-secondary" type="button" disabled={acting} onClick={() => onValidate(row, "")}>Clear</button>
              ) : null}
              {permissions.canVerify ? (
                <>
                  <button className="button-primary" type="button" disabled={acting || validated !== "Yes"} onClick={() => onVerify(row, true)}>Verify</button>
                  <button className="button-secondary" type="button" disabled={acting || validated !== "Yes"} onClick={() => onVerify(row, false)}>Revert</button>
                </>
              ) : null}
            </div>
          </section>

          {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}

          <section>
            <h3>Activity</h3>
            {loading ? (
              <div className="drawer-loading" aria-busy="true">
                <span className="skeleton-bar" />
                <span className="skeleton-bar" />
              </div>
            ) : null}
            {!loading && error ? (
              <div className="drawer-empty">
                <p>{error}</p>
                <button className="button-secondary" type="button" onClick={() => { setLoading(true); setError(""); setReload((value) => value + 1); }}>Try again</button>
              </div>
            ) : null}
            {!loading && !error && activity.length === 0 ? <p className="drawer-empty">No activity yet.</p> : null}
            {!loading && !error && activity.length > 0 ? (
              <ol className="activity-list">
                {activity.map((entry) => (
                  <li key={entry.id}>
                    <strong>{entry.actorName}</strong>
                    <span>{entry.action === "cell_edit" ? `Edited ${columnLabel(schema, entry.columnKey)}` : entry.action === "validation" ? "Validation" : entry.action === "verification" ? "Verification" : "AMC status"}</span>
                    <em>{entry.fromValue || "—"} → {entry.toValue || "—"}</em>
                    <time className="tabular">{formatStamp(entry.at, timeZone)}</time>
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
        </div>
      </aside>
    </div>
  );
}

export default RowDrawer;
