import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import SheetGrid from "../components/grid/SheetGrid";
import RowDrawer from "../components/sheet/RowDrawer";
import ValidationModal from "../components/sheet/ValidationModal";
import { useToast } from "../components/toast-context";
import { useAuth } from "../auth/AuthProvider";
import { editDenialMessage, getEditableColumnKeys } from "@shared/permissions.js";
import {
  API_BASE,
  authConfig,
  clearSession,
  downloadName,
  errorMessage,
  messageFromResponse,
} from "../lib/session";
import "../components/sheet/sheet-actions.css";

const TABS = [
  ["all", "All"],
  ["needs_validation", "Needs Validation"],
  ["validation_overdue", "Validation Overdue"],
  ["pending_verification", "Pending Verification"],
  ["amc_due", "AMC Due"],
];

function DatasetDetail() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const { session } = useAuth();
  const permissions = session?.permissions || {};
  const { id } = useParams();
  const [dataset, setDataset] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [counts, setCounts] = useState(null);
  const [summaryError, setSummaryError] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [drawerRow, setDrawerRow] = useState(null);
  const [rejectRow, setRejectRow] = useState(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [revision, setRevision] = useState(0);
  const filterKey = `${id}|${tab}|${debounced}`;
  const [seenFilter, setSeenFilter] = useState(filterKey);
  if (seenFilter !== filterKey) {
    setSeenFilter(filterKey);
    setLoading(true);
    setError("");
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = query.trim();
      setDebounced((current) => (current === next ? current : next));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    let ignore = false;
    Promise.all([
      axios.get(`${API_BASE}/api/datasets/${id}`, authConfig()),
      axios.get(`${API_BASE}/api/datasets/${id}/rows`, { ...authConfig(), params: { tab, q: debounced } }),
    ])
      .then(([sheetResponse, rowsResponse]) => {
        if (ignore) return;
        setDataset(sheetResponse.data.dataset);
        setRows(rowsResponse.data.rows || []);
        setDrawerRow((current) => {
          if (!current) return current;
          return (rowsResponse.data.rows || []).find((row) => row.id === current.id) || current;
        });
      })
      .catch((err) => {
        if (ignore) return;
        if (err.response?.status === 401) {
          clearSession(navigate);
          return;
        }
        setDataset(null);
        setRows([]);
        setError(errorMessage(err, "Unable to load this dataset."));
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [id, tab, debounced, navigate, revision]);

  useEffect(() => {
    let ignore = false;
    axios
      .get(`${API_BASE}/api/datasets/${id}/summary`, authConfig())
      .then(({ data }) => {
        if (!ignore) setCounts(data.counts || null);
      })
      .catch((err) => {
        if (!ignore) setSummaryError(errorMessage(err, "Unable to load filter counts."));
      })
      .finally(() => {
        if (!ignore) setSummaryLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [id, revision]);

  function replaceRow(next) {
    setRows((current) => current.map((entry) => (entry.id === next.id ? next : entry)));
    setDrawerRow((current) => (current && current.id === next.id ? next : current));
    setSummaryLoading(true);
    setRevision((value) => value + 1);
  }

  async function runAction(request) {
    setActing(true);
    setActionError("");
    try {
      const { data } = await request();
      if (data?.row) replaceRow(data.row);
      if (data?.dataset) setDataset(data.dataset);
      return data;
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        return null;
      }
      const message = errorMessage(err, "Unable to save this change.");
      setActionError(message);
      notify(message);
      throw new Error(message);
    } finally {
      setActing(false);
    }
  }

  async function patchCell(row, key, value) {
    await runAction(() => axios.patch(
      `${API_BASE}/api/datasets/${id}/rows/${row.id}`,
      { values: { [key]: value } },
      authConfig()
    ));
  }

  async function renameColumn(key, label) {
    try {
      const { data } = await axios.patch(
        `${API_BASE}/api/datasets/${id}/columns/${encodeURIComponent(key)}`,
        { label },
        authConfig()
      );
      setDataset(data.dataset);
      notify("Column renamed");
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        return;
      }
      throw new Error(errorMessage(err, "Unable to rename this column."));
    }
  }

  async function addRow() {
    setAdding(true);
    try {
      const { data } = await axios.post(`${API_BASE}/api/datasets/${id}/rows`, {}, authConfig());
      setRows((current) => [...current, data.row]);
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        return;
      }
      setError(errorMessage(err, "Unable to add a row."));
    } finally {
      setAdding(false);
    }
  }

  async function deleteRow(row) {
    try {
      await axios.delete(`${API_BASE}/api/datasets/${id}/rows/${row.id}`, authConfig());
      setRows((current) => current.filter((entry) => entry.id !== row.id));
      if (drawerRow?.id === row.id) setDrawerRow(null);
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        return;
      }
      setError(errorMessage(err, "Unable to delete this row."));
    }
  }

  async function validate(row, result, extra) {
    if (result === "No" && !extra) {
      setRejectRow(row);
      return;
    }
    try {
      await runAction(() => axios.post(
        `${API_BASE}/api/datasets/${id}/rows/${row.id}/validate`,
        { result, ...extra },
        authConfig()
      ));
      setRejectRow(null);
      notify("Validation saved");
    } catch {
      /* The action already surfaced the error. */
    }
  }

  async function verify(row, verified) {
    try {
      await runAction(() => axios.post(
        `${API_BASE}/api/datasets/${id}/rows/${row.id}/verify`,
        { verified },
        authConfig()
      ));
      notify("Verification saved");
    } catch {
      /* The action already surfaced the error. */
    }
  }

  async function updateAmc(row, body) {
    try {
      await runAction(() => axios.post(
        `${API_BASE}/api/datasets/${id}/rows/${row.id}/amc`,
        body,
        authConfig()
      ));
      notify("AMC status updated");
    } catch {
      /* The action already surfaced the error. */
    }
  }

  async function exportSheet() {
    setExporting(true);
    try {
      const response = await axios.get(`${API_BASE}/api/datasets/${id}/export`, {
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

  const autoNamed = (dataset?.schema?.columns || []).filter((column) => column.autoNamed).length;
  const timeZone = dataset?.timezone || "Asia/Kolkata";

  return (
    <div className="sheet-page">
      <header className="sheet-page-bar">
        <div>
          <h1 className="sheet-title">{dataset?.name || "Dataset"}</h1>
          <p>{dataset?.sourceFileName || "Sheet"}</p>
        </div>
        <button className="button-secondary" type="button" onClick={exportSheet} disabled={exporting || loading}>
          {exporting ? "Exporting…" : "Export .xlsx"}
        </button>
      </header>
      <div className="sheet-toolbar">
        <div className="sheet-tabs" role="tablist" aria-label="Quick filters">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              className={tab === value ? "sheet-tab is-active" : "sheet-tab"}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
            >
              {label}
              {summaryLoading ? <span className="count-pill">…</span> : <span className="count-pill">{counts?.[value] ?? 0}</span>}
            </button>
          ))}
        </div>
        <label className="sheet-search">
          <input value={query} placeholder="Search rows" aria-label="Search rows" onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      {summaryError ? <p className="sheet-inline-error" role="alert">{summaryError}</p> : null}
      <SheetGrid
        schema={dataset?.schema}
        rows={rows}
        loading={loading}
        error={error}
        emptyLabel={tab === "all" && !debounced ? "No rows yet." : "No rows in this view."}
        timeZone={timeZone}
        onRetry={() => setRevision((value) => value + 1)}
        onPatch={patchCell}
        onRename={renameColumn}
        onAddRow={addRow}
        onDeleteRow={deleteRow}
        onOpenRow={setDrawerRow}
        onValidate={validate}
        onVerify={verify}
        canDelete={Boolean(permissions.canDeleteRow)}
        canAddRow={Boolean(permissions.canAddRow)}
        canRename={Boolean(permissions.canEditSchema)}
        canValidate={Boolean(permissions.canValidate)}
        canVerify={Boolean(permissions.canVerify)}
        canClearValidation={Boolean(permissions.canClearValidation)}
        editableKeys={getEditableColumnKeys(session?.role, dataset?.schema)}
        denialMessage={editDenialMessage(session?.role, dataset?.schema)}
        adding={adding}
        autoNamed={autoNamed}
        acting={acting}
      />
      {drawerRow ? (
        <RowDrawer
          key={drawerRow.id}
          datasetId={id}
          row={drawerRow}
          schema={dataset?.schema}
          timeZone={timeZone}
          permissions={permissions}
          acting={acting}
          actionError={actionError}
          onClose={() => setDrawerRow(null)}
          onValidate={validate}
          onVerify={verify}
          onAmc={updateAmc}
        />
      ) : null}
      <ValidationModal
        key={rejectRow?.id || "closed"}
        open={Boolean(rejectRow)}
        timeZone={timeZone}
        saving={acting}
        error={actionError}
        onClose={() => { if (!acting) setRejectRow(null); }}
        onSave={(extra) => { if (rejectRow) void validate(rejectRow, "No", extra); }}
      />
    </div>
  );
}

export default DatasetDetail;
