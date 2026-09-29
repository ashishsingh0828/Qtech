import { useRef, useState } from "react";
import axios from "axios";
import { Upload } from "lucide-react";
import { useToast } from "../toast-context";
import { API_BASE, authConfig, clearSession, errorMessage } from "../../lib/session";
import "../grid/SheetGrid.css";

const MAX_BYTES = 25 * 1024 * 1024;

function ExcelDropzone({ onImported, navigate }) {
  const { notify } = useToast();
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  async function upload(file) {
    if (!file || busy) return;
    const name = String(file.name || "").toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
      setError("Upload an .xlsx or .xls file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Excel files must be 25 MB or smaller.");
      return;
    }
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await axios.post(`${API_BASE}/api/datasets/import`, form, {
        ...authConfig(),
        onUploadProgress(event) {
          if (!event.total) return;
          setProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
        },
      });
      notify(`Imported ${data.rows} rows x ${data.columns} columns in ${data.groups} groups`);
      onImported(data.dataset);
    } catch (err) {
      if (err.response?.status === 401) {
        clearSession(navigate);
        return;
      }
      setError(errorMessage(err, "Unable to import this workbook."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={dragOver ? "excel-drop is-over" : "excel-drop"}
      onDragOver={(event) => {
        event.preventDefault();
        if (!busy) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        upload(event.dataTransfer.files?.[0]);
      }}
    >
      <h2>Upload Excel</h2>
      <p>{busy && progress >= 100 ? "Reading workbook…" : "Drop an .xlsx or .xls file, or choose one. The first sheet opens in the grid."}</p>
      <div className="excel-drop-actions">
        <button className="upload-button" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Upload size={18} aria-hidden="true" />
          {busy ? "Uploading…" : "Upload Excel"}
        </button>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => {
            upload(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      {busy ? (
        <div className="excel-progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} role="progressbar">
          <span style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      {error ? <p className="excel-drop-error">{error}</p> : null}
    </div>
  );
}

export default ExcelDropzone;
