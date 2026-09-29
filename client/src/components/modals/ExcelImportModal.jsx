import { useRef, useState } from "react";
import { FileSpreadsheet, X } from "lucide-react";
import "../grid/grid.css";

function isExcelFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls");
}

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function ExcelImportModal({ open, onClose, onConfirm }) {
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  if (!open) return null;

  function acceptFile(nextFile) {
    if (!nextFile) return;
    if (!isExcelFile(nextFile)) {
      setFile(null);
      setFileError("Choose an .xlsx or .xls file.");
      return;
    }
    setFile(nextFile);
    setFileError("");
    setImportError("");
  }

  async function confirmImport() {
    if (!file || importing) return;
    setImporting(true);
    setImportError("");
    try {
      await onConfirm(file);
      setFile(null);
    } catch (error) {
      setImportError(error?.message || "Unable to import this spreadsheet.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!importing) onClose();
      }}
    >
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="excel-import-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <h2 id="excel-import-title">Import Excel</h2>
            <p className="import-lead">Every header and every data row in the first sheet is written to this dataset.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close" onClick={onClose} disabled={importing}>
            <X size={18} />
          </button>
        </div>

        <div
          className={dragOver ? "dropzone is-active" : "dropzone"}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            acceptFile(event.dataTransfer.files?.[0]);
          }}
        >
          <FileSpreadsheet size={32} aria-hidden="true" />
          <p>{file ? file.name : "Drag an .xlsx or .xls file here"}</p>
          <button className="ghost-button" type="button" onClick={() => fileInputRef.current?.click()} disabled={importing}>
            Choose file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            hidden
            accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => {
              acceptFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>

        {file ? (
          <div className="import-card">
            <p className="import-file">{file.name}</p>
            <p className="import-summary">{formatFileSize(file.size)}</p>
          </div>
        ) : null}

        {fileError ? <p className="import-error">{fileError}</p> : null}
        {importError ? <p className="import-error">{importError}</p> : null}

        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={onClose} disabled={importing}>
            Cancel
          </button>
          <button className="primary-button" type="button" onClick={confirmImport} disabled={!file || importing}>
            {importing ? <span className="spinner" aria-hidden="true" /> : null}
            {importing ? "Importing all rows and columns..." : "Confirm & Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ExcelImportModal;
