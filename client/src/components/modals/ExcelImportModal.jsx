import { useRef, useState } from "react";
import { FileSpreadsheet, X } from "lucide-react";
import "../grid/grid.css";

function isExcelFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls");
}

function ExcelImportModal({ open, onClose, onPreview, onConfirm }) {
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  if (!open) return null;

  const previewRows = (preview?.preview || []).slice(0, 3);

  async function acceptFile(nextFile) {
    if (!nextFile) return;
    if (!isExcelFile(nextFile)) {
      setFile(null);
      setPreview(null);
      setPreviewError("Choose an .xlsx or .xls file.");
      return;
    }
    setFile(nextFile);
    setPreview(null);
    setPreviewError("");
    setImportError("");
    setPreviewLoading(true);
    try {
      const data = await onPreview(nextFile);
      setPreview(data);
    } catch (error) {
      setPreviewError(error?.message || "Unable to preview this spreadsheet.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function confirmImport() {
    if (!file || !preview) return;
    setImporting(true);
    setImportError("");
    try {
      await onConfirm(file);
      setFile(null);
      setPreview(null);
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
        if (!importing && !previewLoading) onClose();
      }}
    >
      <div
        className="modal-panel is-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="excel-import-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <h2 id="excel-import-title">Import Excel</h2>
            <p className="import-lead">Blank columns are removed. Matching headers land in existing fields, and new headers are added as text columns.</p>
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
          <button className="ghost-button" type="button" onClick={() => fileInputRef.current?.click()} disabled={previewLoading || importing}>
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

        {previewError ? <p className="sheet-banner is-error">{previewError}</p> : null}
        {importError ? <p className="sheet-banner is-error">{importError}</p> : null}
        {previewLoading ? <p className="import-summary">Reading spreadsheet…</p> : null}

        {preview && file ? (
          <div className="import-card">
            <p className="import-file">{file.name}</p>
            <p className="import-summary">
              Found {preview.headers.length} {preview.headers.length === 1 ? "column" : "columns"}, {preview.totalRows} {preview.totalRows === 1 ? "row" : "rows"}
            </p>
            <div className="preview-scroll">
              <table className="preview-table">
                <thead>
                  <tr>
                    {preview.headers.map((header) => (
                      <th key={header} className="is-mapped">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, index) => (
                    <tr key={`${file.name}-${index}`}>
                      {preview.headers.map((header) => (
                        <td key={header}>{row[header] || "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={onClose} disabled={importing}>
            Cancel
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={confirmImport}
            disabled={!preview || previewLoading || importing || preview.totalRows === 0}
          >
            {importing ? <span className="spinner" aria-hidden="true" /> : null}
            {importing ? "Importing…" : "Direct Import to Sheet"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ExcelImportModal;
