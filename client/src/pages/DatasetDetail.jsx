import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import axios from "axios";
import { RefreshCw, X } from "lucide-react";
import GridToolbar from "../components/grid/GridToolbar";
import SpreadsheetWorkspace from "../components/grid/SpreadsheetWorkspace";
import ExcelImportModal from "../components/modals/ExcelImportModal";
import FieldPermissionManager from "../components/admin/FieldPermissionManager";
import { useToast } from "../components/toast-context";
import {
  API_BASE,
  authConfig,
  canDeleteRole,
  clearSession,
  downloadName,
  errorMessage,
  formatRole,
  isAdminRole,
  messageFromResponse,
  readUser,
} from "../lib/session";
import { FIELD_TYPES, auditValue, formatTimestamp, toFieldKey } from "../lib/cells";
import "../components/grid/grid.css";

function DatasetDetail() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const user = readUser();
  const roleLabel = formatRole(user?.role);
  const admin = isAdminRole(user?.role);
  const canDeleteRows = canDeleteRole(user?.role);
  const canVerify = roleLabel === "Admin" || roleLabel === "Manager";

  const [dataset, setDataset] = useState(null);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState([]);
  const [draftFieldId, setDraftFieldId] = useState("");
  const [draftValue, setDraftValue] = useState("");
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [savedPulseKey, setSavedPulseKey] = useState("");
  const [cellError, setCellError] = useState(null);
  const recordParam = Number(searchParams.get("record"));
  const linkedRecordId = Number.isInteger(recordParam) && recordParam > 0 ? recordParam : null;
  const [focusRecordId, setFocusRecordId] = useState(linkedRecordId);
  const [seenLink, setSeenLink] = useState(linkedRecordId);
  if (linkedRecordId !== seenLink) {
    setSeenLink(linkedRecordId);
    if (linkedRecordId) setFocusRecordId(linkedRecordId);
  }
  const [workflowTab, setWorkflowTab] = useState("all");
  const [workflowBusy, setWorkflowBusy] = useState(null);
  const [columnModal, setColumnModal] = useState(null);
  const [fieldName, setFieldName] = useState("");
  const [fieldKey, setFieldKey] = useState("");
  const [fieldKeyTouched, setFieldKeyTouched] = useState(false);
  const [fieldType, setFieldType] = useState("text");
  const [isRequired, setIsRequired] = useState(false);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleteRow, setDeleteRow] = useState(null);
  const [deleteColumn, setDeleteColumn] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importKey, setImportKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");
  const filterRef = useRef(null);

  const fields = dataset?.fields || [];

  async function loadSheet() {
    setLoading(true);
    setError("");
    try {
      const [datasetResponse, recordsResponse] = await Promise.all([
        axios.get(`${API_BASE}/api/datasets/${id}`, authConfig()),
        axios.get(`${API_BASE}/api/datasets/${id}/records`, authConfig()),
      ]);
      setDataset(datasetResponse.data.dataset);
      setRecords(recordsResponse.data.records || []);
      setLastSyncAt(new Date().toISOString());
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        return;
      }
      setDataset(null);
      setRecords([]);
      setError(errorMessage(err, "Unable to load this dataset."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function run() {
      try {
        const [datasetResponse, recordsResponse] = await Promise.all([
          axios.get(`${API_BASE}/api/datasets/${id}`, authConfig()),
          axios.get(`${API_BASE}/api/datasets/${id}/records`, authConfig()),
        ]);
        if (!active) return;
        setDataset(datasetResponse.data.dataset);
        setRecords(recordsResponse.data.records || []);
        setLastSyncAt(new Date().toISOString());
        setError("");
      } catch (err) {
        if (!active) return;
        if (err.response?.status === 401) {
          clearSession(navigate);
          return;
        }
        setDataset(null);
        setRecords([]);
        setError(errorMessage(err, "Unable to load this dataset."));
      } finally {
        if (active) setLoading(false);
      }
    }

    run();
    return () => {
      active = false;
    };
  }, [id, navigate]);

  useEffect(() => {
    function onKeyDown(event) {
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector(".tool-search input")?.focus();
      } else if (event.key === "/" && !typing) {
        event.preventDefault();
        document.querySelector(".tool-search input")?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!filterOpen) return undefined;
    function onPointer(event) {
      if (!filterRef.current?.contains(event.target)) setFilterOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [filterOpen]);

  async function reloadRecords() {
    const { data } = await axios.get(`${API_BASE}/api/datasets/${id}/records`, authConfig());
    setRecords(data.records || []);
    setLastSyncAt(new Date().toISOString());
  }

  async function saveCell(record, field, nextValue) {
    try {
      const { data } = await axios.patch(
        `${API_BASE}/api/datasets/${id}/records/${record.id}/cells`,
        { field_id: field.id, value: nextValue },
        authConfig()
      );
      const saved = data.updated?.value ?? nextValue;
      setRecords((current) =>
        current.map((entry) =>
          entry.id === record.id
            ? { ...entry, values: { ...entry.values, [field.field_key]: saved } }
            : entry
        )
      );
      const pulseKey = `${record.id}:${field.id}`;
      setSavedPulseKey(pulseKey);
      window.setTimeout(() => {
        setSavedPulseKey((current) => (current === pulseKey ? "" : current));
      }, 900);
      setCellError(null);
      setLastSyncAt(new Date().toISOString());
      notify("Cell saved");
      if (logsOpen) loadLogs();
      return true;
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        return false;
      }
      setCellError({
        key: `${record.id}:${field.id}`,
        message: errorMessage(err, "Unable to save this cell."),
      });
      return false;
    }
  }

  async function insertRow(anchor, placement) {
    setError("");
    try {
      const { data } = await axios.post(
        `${API_BASE}/api/datasets/${id}/records`,
        {
          values: {},
          blank: true,
          insert: anchor ? { record_id: anchor.id, placement } : undefined,
        },
        authConfig()
      );
      await reloadRecords();
      setFocusRecordId(data.record?.id || null);
      notify("Row added");
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        return;
      }
      setError(errorMessage(err, "Unable to add this row."));
    }
  }

  async function confirmDeleteRow() {
    if (!deleteRow) return;
    const ids = Array.isArray(deleteRow.ids) ? deleteRow.ids : [deleteRow.id];
    setDeleting(true);
    try {
      for (const recordId of ids) {
        await axios.delete(`${API_BASE}/api/datasets/${id}/records/${recordId}`, authConfig());
      }
      setDeleteRow(null);
      await reloadRecords();
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        return;
      }
      setError(errorMessage(err, "Unable to delete this row."));
      setDeleteRow(null);
    } finally {
      setDeleting(false);
    }
  }

  function openColumnModal(anchor, placement) {
    setFieldName("");
    setFieldKey("");
    setFieldKeyTouched(false);
    setFieldType("text");
    setIsRequired(false);
    setFormError("");
    setColumnModal({ anchorId: anchor?.id || null, placement: placement || null });
  }

  async function submitColumn(event) {
    event.preventDefault();
    setSubmitting(true);
    setFormError("");
    try {
      await axios.post(
        `${API_BASE}/api/datasets/${id}/fields`,
        {
          name: fieldName.trim(),
          field_key: fieldKey.trim(),
          field_type: fieldType,
          is_required: isRequired,
          anchor_field_id: columnModal?.anchorId || undefined,
          placement: columnModal?.placement || undefined,
        },
        authConfig()
      );
      setColumnModal(null);
      await loadSheet();
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        return;
      }
      setFormError(errorMessage(err, "Unable to add this column."));
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDeleteColumn() {
    if (!deleteColumn) return;
    setDeleting(true);
    try {
      await axios.delete(`${API_BASE}/api/datasets/${id}/fields/${deleteColumn.id}`, authConfig());
      setDeleteColumn(null);
      await loadSheet();
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        return;
      }
      setError(errorMessage(err, "Unable to delete this column."));
      setDeleteColumn(null);
    } finally {
      setDeleting(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    setError("");
    try {
      const response = await axios.get(`${API_BASE}/api/datasets/${id}/export-excel`, {
        ...authConfig(),
        responseType: "blob",
      });
      const blob = new Blob([response.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName(dataset?.name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      notify("Export ready");
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        return;
      }
      setError(await messageFromResponse(err, "Unable to export this dataset."));
    } finally {
      setExporting(false);
    }
  }

  async function confirmImport(file) {
    const form = new FormData();
    form.append("file", file);
    try {
      const { data } = await axios.post(`${API_BASE}/api/datasets/${id}/import-excel`, form, authConfig());
      setImportOpen(false);
      await loadSheet();
      const columns = data.totalColumns ?? 0;
      const rows = data.totalRows ?? 0;
      notify(`Successfully imported ${columns} columns and ${rows} rows`);
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        throw new Error("Sign in required");
      }
      throw new Error(await messageFromResponse(err, "Unable to import this spreadsheet."));
    }
  }

  async function loadLogs() {
    setLogsLoading(true);
    setLogsError("");
    try {
      const { data } = await axios.get(`${API_BASE}/api/datasets/${id}/audit-logs`, authConfig());
      setLogs(Array.isArray(data) ? data : data.logs || []);
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        return;
      }
      setLogsError(errorMessage(err, "Unable to load the activity log."));
    } finally {
      setLogsLoading(false);
    }
  }

  async function runWorkflow(record, action, body, successText) {
    setWorkflowBusy({ recordId: record.id, action });
    setError("");
    try {
      const { data } = await axios.patch(
        `${API_BASE}/api/datasets/${id}/records/${record.id}/workflow/${action}`,
        body,
        authConfig()
      );
      setRecords((current) => current.map((entry) => (
        entry.id === record.id
          ? { ...entry, values: { ...entry.values, ...(data.values || {}) } }
          : entry
      )));
      setLastSyncAt(new Date().toISOString());
      notify(successText);
      if (logsOpen) loadLogs();
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        return;
      }
      setError(errorMessage(err, "Unable to update this record."));
    } finally {
      setWorkflowBusy(null);
    }
  }

  function toggleLogs() {
    const next = !logsOpen;
    setLogsOpen(next);
    if (next) loadLogs();
  }

  return (
    <div className="sheet-page">
      <GridToolbar
        title={loading ? "Loading dataset…" : dataset?.name || "Dataset"}
        description={dataset?.description || ""}
        query={query}
        onQueryChange={setQuery}
        filterOpen={filterOpen}
        filters={filters}
        draftFieldId={draftFieldId}
        draftValue={draftValue}
        fields={fields}
        onToggleFilter={() => setFilterOpen((open) => !open)}
        onDraftField={setDraftFieldId}
        onDraftValue={setDraftValue}
        onAddFilter={() => {
          if (!draftFieldId || !draftValue.trim()) return;
          setFilters((current) => [
            ...current,
            { id: `${draftFieldId}-${Date.now()}`, fieldId: draftFieldId, value: draftValue.trim() },
          ]);
          setDraftValue("");
          setFilterOpen(false);
        }}
        onRemoveFilter={(filterId) => setFilters((current) => current.filter((filter) => filter.id !== filterId))}
        onClearFilters={() => setFilters([])}
        onAddRow={() => insertRow(null, null)}
        onAddColumn={() => openColumnModal(null, null)}
        canAddColumn={admin}
        onImport={() => {
          setImportKey((value) => value + 1);
          setImportOpen(true);
        }}
        onExport={handleExport}
        exporting={exporting}
        auditOpen={logsOpen}
        onToggleAudit={toggleLogs}
        onPermissions={() => setPermissionsOpen(true)}
        canManagePermissions={admin}
        filterRef={filterRef}
        workflowTab={workflowTab}
        onWorkflowTab={setWorkflowTab}
      />

      {error ? <p className="sheet-banner is-error">{error}</p> : null}

      <SpreadsheetWorkspace
        fields={fields}
        records={records}
        loading={loading}
        query={query}
        filters={filters}
        onSaveCell={saveCell}
        onInsertRow={insertRow}
        onDeleteRow={(record) => setDeleteRow(record)}
        onDeleteRows={(rows) => {
          if (!rows.length) return;
          setDeleteRow({ ids: rows.map((row) => row.id), count: rows.length });
        }}
        onInsertColumn={(field, placement) => openColumnModal(field, placement)}
        onDeleteColumn={setDeleteColumn}
        isAdmin={admin}
        canVerify={canVerify}
        canDeleteRows={canDeleteRows}
        roleLabel={roleLabel}
        workflowTab={workflowTab}
        workflowBusy={workflowBusy}
        onValidate={(record) => runWorkflow(record, "validate", { isValidated: true }, "Record validated")}
        onVerify={(record) => runWorkflow(record, "verify", {}, "Record verified")}
        onProposal={(record, patch) => runWorkflow(record, "proposal", patch, "Proposal updated")}
        savedPulseKey={savedPulseKey}
        cellError={cellError}
        lastSyncAt={lastSyncAt}
        focusRecordId={focusRecordId}
      />

      {logsOpen ? (
        <section className="audit-drawer">
          <header>
            <h2>Audit history</h2>
            <button className="ghost-button" type="button" onClick={loadLogs} disabled={logsLoading}>
              <RefreshCw size={14} aria-hidden="true" />
              Refresh
            </button>
          </header>
          {logsError ? <p className="sheet-banner is-error">{logsError}</p> : null}
          {logsLoading ? <p className="import-summary">Loading activity…</p> : null}
          {!logsLoading && !logsError && logs.length === 0 ? (
            <p className="import-summary">No cell changes have been recorded yet.</p>
          ) : null}
          {!logsLoading && logs.length > 0 ? (
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Field</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatTimestamp(entry.changed_at)}</td>
                    <td>{entry.changed_by_name || "Unknown"}</td>
                    <td>{entry.field_name || "Field"}</td>
                    <td>
                      {auditValue(entry.old_value)} → {auditValue(entry.new_value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}

      <ExcelImportModal
        key={importKey}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onConfirm={confirmImport}
      />
      <FieldPermissionManager
        open={permissionsOpen}
        datasetId={id}
        navigate={navigate}
        onClose={(saved) => {
          setPermissionsOpen(false);
          if (saved) loadSheet();
        }}
      />

      {columnModal ? (
        <div className="modal-backdrop" onClick={() => { if (!submitting) setColumnModal(null); }}>
          <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="add-column-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <h2 id="add-column-title">
                {columnModal.placement === "left"
                  ? "Insert column left"
                  : columnModal.placement === "right"
                    ? "Insert column right"
                    : "Add column"}
              </h2>
              <button className="icon-button" type="button" aria-label="Close" onClick={() => setColumnModal(null)}>
                <X size={18} />
              </button>
            </div>
            <form className="modal-form" onSubmit={submitColumn}>
              {formError ? <p className="sheet-banner is-error">{formError}</p> : null}
              <label>
                Name
                <input
                  type="text"
                  value={fieldName}
                  autoFocus
                  required
                  maxLength={255}
                  onChange={(event) => {
                    setFieldName(event.target.value);
                    if (!fieldKeyTouched) setFieldKey(toFieldKey(event.target.value));
                  }}
                />
              </label>
              <label>
                Field key
                <input
                  type="text"
                  value={fieldKey}
                  required
                  maxLength={255}
                  onChange={(event) => {
                    setFieldKeyTouched(true);
                    setFieldKey(event.target.value);
                  }}
                />
              </label>
              <label>
                Field type
                <select value={fieldType} onChange={(event) => setFieldType(event.target.value)}>
                  {FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label className="check-row">
                <input type="checkbox" checked={isRequired} onChange={(event) => setIsRequired(event.target.checked)} />
                Required
              </label>
              <div className="modal-actions">
                <button className="ghost-button" type="button" onClick={() => setColumnModal(null)} disabled={submitting}>Cancel</button>
                <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Adding…" : "Add column"}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteRow ? (
        <div className="modal-backdrop" onClick={() => { if (!deleting) setDeleteRow(null); }}>
          <div className="modal-panel" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h2>{Array.isArray(deleteRow.ids) && deleteRow.ids.length > 1 ? `Delete ${deleteRow.ids.length} rows?` : "Delete this row?"}</h2>
            <p>The selected rows and their cell values will be removed.</p>
            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setDeleteRow(null)} disabled={deleting}>Cancel</button>
              <button className="delete-link" type="button" onClick={confirmDeleteRow} disabled={deleting}>{deleting ? "Deleting…" : "Delete row"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteColumn ? (
        <div className="modal-backdrop" onClick={() => { if (!deleting) setDeleteColumn(null); }}>
          <div className="modal-panel" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h2>Delete {deleteColumn.name}?</h2>
            <p>The column will be hidden from the sheet. Existing values stay in the database.</p>
            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setDeleteColumn(null)} disabled={deleting}>Cancel</button>
              <button className="delete-link" type="button" onClick={confirmDeleteColumn} disabled={deleting}>{deleting ? "Deleting…" : "Delete column"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default DatasetDetail;
