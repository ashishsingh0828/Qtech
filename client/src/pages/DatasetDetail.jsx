import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import SheetGrid from "../components/grid/SheetGrid";
import { useToast } from "../components/toast-context";
import {
  API_BASE,
  authConfig,
  canDeleteRole,
  clearSession,
  downloadName,
  errorMessage,
  messageFromResponse,
  readUser,
} from "../lib/session";

function DatasetDetail() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const { id } = useParams();
  const canDelete = canDeleteRole(readUser()?.role);
  const [dataset, setDataset] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [sheetResponse, rowsResponse] = await Promise.all([
        axios.get(`${API_BASE}/api/datasets/${id}`, authConfig()),
        axios.get(`${API_BASE}/api/datasets/${id}/rows`, authConfig()),
      ]);
      setDataset(sheetResponse.data.dataset);
      setRows(rowsResponse.data.rows || []);
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        return;
      }
      setDataset(null);
      setRows([]);
      setError(errorMessage(err, "Unable to load this dataset."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    async function run() {
      setLoading(true);
      setError("");
      try {
        const [sheetResponse, rowsResponse] = await Promise.all([
          axios.get(`${API_BASE}/api/datasets/${id}`, authConfig()),
          axios.get(`${API_BASE}/api/datasets/${id}/rows`, authConfig()),
        ]);
        if (!active) return;
        setDataset(sheetResponse.data.dataset);
        setRows(rowsResponse.data.rows || []);
      } catch (err) {
        if (!active) return;
        if (err.response?.status === 401) {
          clearSession(navigate);
          return;
        }
        setDataset(null);
        setRows([]);
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

  async function patchCell(row, key, value) {
    try {
      const { data } = await axios.patch(
        `${API_BASE}/api/datasets/${id}/rows/${row.id}`,
        { values: { [key]: value } },
        authConfig()
      );
      setRows((current) => current.map((entry) => (entry.id === row.id ? data.row : entry)));
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        return;
      }
      throw new Error(errorMessage(err, "Unable to save this cell."));
    }
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
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        return;
      }
      setError(errorMessage(err, "Unable to delete this row."));
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

  return (
    <div className="sheet-page">
      <header className="sheet-page-bar">
        <div>
          <h1>{dataset?.name || "Dataset"}</h1>
          <p>{dataset?.sourceFileName || "Sheet"}</p>
        </div>
        <button className="sheet-text-button" type="button" onClick={exportSheet} disabled={exporting || loading}>
          {exporting ? "Exporting…" : "Export .xlsx"}
        </button>
      </header>
      <SheetGrid
        schema={dataset?.schema}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={load}
        onPatch={patchCell}
        onRename={renameColumn}
        onAddRow={addRow}
        onDeleteRow={deleteRow}
        canDelete={canDelete}
        adding={adding}
        autoNamed={autoNamed}
      />
    </div>
  );
}

export default DatasetDetail;
