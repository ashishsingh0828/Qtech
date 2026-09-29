import { useState } from "react";
import { todayISO } from "../../lib/sheetFormat";

function ValidationModal({ open, timeZone, saving, error, onClose, onSave }) {
  const [reason, setReason] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const today = todayISO(timeZone);
  const ready = reason.trim().length >= 5 && expectedDate && expectedDate >= today;

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={() => { if (!saving) onClose(); }}>
      <form
        className="ivory-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reject-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready || saving) return;
          onSave({ reason: reason.trim(), expectedDate });
        }}
      >
        <h2 id="reject-title">Validation not accepted</h2>
        <p>Record why this row was rejected and when it should be reviewed again.</p>
        <label>
          Reason
          <textarea
            value={reason}
            minLength={5}
            rows={4}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </label>
        <label>
          Expected date
          <input type="date" min={today} value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} required />
        </label>
        {reason.trim().length > 0 && reason.trim().length < 5 ? <p className="form-hint">Use at least 5 characters.</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button className="button-secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="button-primary" type="submit" disabled={!ready || saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}

export default ValidationModal;
