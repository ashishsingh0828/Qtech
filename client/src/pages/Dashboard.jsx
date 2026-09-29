import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import ExcelDropzone from "../components/import/ExcelDropzone";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../components/toast-context";
import {
  API_BASE,
  authConfig,
  clearSession,
  downloadName,
  errorMessage,
  initials,
  messageFromResponse,
  relativeTime,
} from "../lib/session";
import "../components/sheet/sheet-actions.css";
import "./Dashboard.css";

const PILL = {
  needs_validation: ["Needs validation", "sapphire"],
  validation_overdue: ["Overdue", "ruby"],
  pending_verification: ["Pending review", "amber"],
  amc_due: ["AMC due", "amber"],
  active_amcs: ["Active AMC", "emerald"],
  proposal_sent: ["Proposal", "sapphire"],
  follow_up_due: ["Follow-up", "stone"],
};

function Dashboard() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const { session } = useAuth();
  const canUpload = Boolean(session?.permissions?.canUpload);
  const canDelete = Boolean(session?.permissions?.canDeleteDataset);
  const [searchParams] = useSearchParams();
  const query = (searchParams.get("q") || "").trim().toLowerCase();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [openMetric, setOpenMetric] = useState("");
  const [pending, setPending] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [exportingId, setExportingId] = useState(0);
  const [archived, setArchived] = useState(false);
  const [archiveRows, setArchiveRows] = useState([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [restoringId, setRestoringId] = useState(0);

  useEffect(() => {
    let ignore = false;
    axios
      .get(`${API_BASE}/api/dashboard`, authConfig())
      .then(({ data }) => {
        if (ignore) return;
        setPayload(data);
        setError("");
      })
      .catch((err) => {
        if (ignore) return;
        if (err.response?.status === 401) {
          clearSession(navigate);
          return;
        }
        setError(errorMessage(err, "Unable to load the dashboard."));
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [navigate, revision]);

  useEffect(() => {
    if (!archived) return undefined;
    let ignore = false;
    axios
      .get(`${API_BASE}/api/datasets`, { ...authConfig(), params: { include_deleted: true } })
      .then(({ data }) => {
        if (!ignore) setArchiveRows((data.datasets || []).filter((dataset) => dataset.is_deleted));
      })
      .catch((err) => {
        if (!ignore) setArchiveError(errorMessage(err, "Unable to load archived datasets."));
      })
      .finally(() => {
        if (!ignore) setArchiveLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [archived, revision]);

  const datasets = (payload?.datasets || []).filter((dataset) => {
    if (!query) return true;
    return String(dataset.name || "").toLowerCase().includes(query);
  });

  function openCard(metric) {
    if (!metric.tab || !metric.targets?.length) return;
    if (metric.targets.length === 1) {
      navigate(`/datasets/${metric.targets[0].id}?tab=${metric.tab}`);
      return;
    }
    setOpenMetric((current) => (current === metric.key ? "" : metric.key));
  }

  async function exportDataset(dataset) {
    setExportingId(dataset.id);
    try {
      const response = await axios.get(`${API_BASE}/api/datasets/${dataset.id}/export`, {
        ...authConfig(),
        responseType: "blob",
      });
      const blob = new Blob([response.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName(dataset.name);
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
      notify(await messageFromResponse(err, "Unable to export this dataset."));
    } finally {
      setExportingId(0);
    }
  }

  async function confirmDelete() {
    if (!pending) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await axios.delete(`${API_BASE}/api/datasets/${pending.id}`, authConfig());
      setPending(null);
      setLoading(true);
      setRevision((value) => value + 1);
      notify("Dataset archived");
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        return;
      }
      setDeleteError(errorMessage(err, "Unable to delete this dataset."));
    } finally {
      setDeleting(false);
    }
  }

  async function restoreDataset(dataset) {
    setRestoringId(dataset.id);
    setArchiveError("");
    try {
      await axios.patch(`${API_BASE}/api/datasets/${dataset.id}/restore`, {}, authConfig());
      setArchiveLoading(true);
      setLoading(true);
      setRevision((value) => value + 1);
      notify("Dataset restored");
    } catch (err) {
      setArchiveError(errorMessage(err, "Unable to restore this dataset."));
    } finally {
      setRestoringId(0);
    }
  }

  function showArchive() {
    setArchived(true);
    setArchiveLoading(true);
    setArchiveError("");
    setArchiveRows([]);
  }

  return (
    <div className="exec-home">
      <header className="exec-hero">
        {loading && !payload ? <div className="exec-skel exec-skel-title" /> : (
          <>
            <h1>{payload?.greeting || "Good afternoon"}, {payload?.name || session?.user?.name || "there"}</h1>
            <p>{payload?.dateLabel || "Today"}</p>
          </>
        )}
      </header>

      {error ? (
        <div className="exec-error" role="alert">
          <p>{error}</p>
          <button className="button-secondary" type="button" onClick={() => { setLoading(true); setRevision((value) => value + 1); }}>
            Try again
          </button>
        </div>
      ) : null}

      <section className="exec-metrics" aria-label="Workspace metrics">
        {loading && !payload
          ? Array.from({ length: 4 }, (_, index) => <div key={index} className="exec-metric exec-skel" />)
          : (payload?.metrics || []).map((metric) => {
            const interactive = Boolean(metric.tab && metric.targets?.length);
            return (
              <article key={metric.key} className="exec-metric">
                <button
                  className="exec-metric-hit"
                  type="button"
                  disabled={!interactive}
                  onClick={() => openCard(metric)}
                >
                  <span>{metric.label}</span>
                  <strong>{metric.count}</strong>
                  <small>{metric.subtitle}</small>
                </button>
                {openMetric === metric.key ? (
                  <div className="exec-pop" role="menu">
                    {metric.targets.map((target) => (
                      <button
                        key={target.id}
                        type="button"
                        role="menuitem"
                        onClick={() => navigate(`/datasets/${target.id}?tab=${metric.tab}`)}
                      >
                        <span>{target.name}</span>
                        <span className="count-pill">{target.count}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
      </section>

      {canUpload ? (
        <ExcelDropzone
          navigate={navigate}
          onImported={(dataset) => {
            if (dataset?.id) navigate(`/datasets/${dataset.id}`);
          }}
        />
      ) : null}

      <section className="exec-registry">
        <div className="exec-registry-head">
          <h2>Datasets</h2>
          {canDelete ? (
            <button
              className="button-secondary"
              type="button"
              onClick={() => (archived ? setArchived(false) : showArchive())}
            >
              {archived ? "Active datasets" : "Archived"}
            </button>
          ) : null}
        </div>

        {!archived && !loading && !error && datasets.length === 0 ? (
          <p className="exec-empty">{query ? "No datasets match that search." : "No datasets yet."}</p>
        ) : null}

        {!archived ? (
          <div className="exec-grid">
            {datasets.map((dataset) => (
              <article key={dataset.id} className="exec-card">
                <header>
                  <h3>{dataset.name}</h3>
                  <span className="exec-uploader" title={dataset.uploaderName || "Uploader"}>
                    {initials(dataset.uploaderName)}
                  </span>
                </header>
                <p>
                  {dataset.rowCount} × {dataset.columnCount}
                  <span>{relativeTime(dataset.updatedAt)}</span>
                </p>
                <div className="exec-pills">
                  {Object.entries(dataset.pills || {}).filter(([, count]) => count > 0).map(([key, count]) => {
                    const [label, tone] = PILL[key] || [key, "stone"];
                    return <span key={key} className={`status-pill tone-${tone}`}>{label} {count}</span>;
                  })}
                </div>
                <div className="exec-actions">
                  <button className="button-primary" type="button" onClick={() => navigate(`/datasets/${dataset.id}`)}>Open</button>
                  <button className="button-secondary" type="button" disabled={exportingId === dataset.id} onClick={() => exportDataset(dataset)}>
                    {exportingId === dataset.id ? "Exporting…" : "Export .xlsx"}
                  </button>
                  {canDelete ? (
                    <button className="button-secondary" type="button" onClick={() => { setDeleteError(""); setPending(dataset); }}>
                      Delete
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {archived ? (
          <div className="exec-archive">
            {archiveLoading ? <div className="exec-skel exec-skel-row" /> : null}
            {archiveError ? (
              <div className="exec-error" role="alert">
                <p>{archiveError}</p>
                <button className="button-secondary" type="button" onClick={showArchive}>Try again</button>
              </div>
            ) : null}
            {!archiveLoading && !archiveError && archiveRows.length === 0 ? <p className="exec-empty">No archived datasets.</p> : null}
            {archiveRows.map((dataset) => (
              <article key={dataset.id} className="exec-card exec-card-row">
                <h3>{dataset.name}</h3>
                <button
                  className="button-secondary"
                  type="button"
                  disabled={restoringId === dataset.id}
                  onClick={() => restoreDataset(dataset)}
                >
                  {restoringId === dataset.id ? "Restoring…" : "Restore"}
                </button>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      {pending ? (
        <div className="exec-backdrop" onMouseDown={() => { if (!deleting) setPending(null); }}>
          <div className="exec-dialog" role="dialog" aria-labelledby="delete-title" onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="delete-title">Delete dataset</h2>
            <p>Archive {pending.name}. It leaves the active registry and can be restored later.</p>
            {deleteError ? <p className="exec-dialog-error" role="alert">{deleteError}</p> : null}
            <div className="exec-dialog-actions">
              <button className="button-secondary" type="button" disabled={deleting} onClick={() => setPending(null)}>Cancel</button>
              <button className="button-primary" type="button" disabled={deleting} onClick={confirmDelete}>
                {deleting ? "Deleting…" : "Delete dataset"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default Dashboard;
