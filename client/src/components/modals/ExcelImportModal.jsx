import { useRef, useState } from "react";
import { FileSpreadsheet, X } from "lucide-react";
import "../grid/grid.css";

function isExcelFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls");
}

function ExcelImportModal({
  open,
  canCreateColumns,
  onClose,
  onPreview,
  onConfirm,
}) {
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [createMissing, setCreateMissing] = useState(canCreateColumns);

  if (!open) return null;

  const matched = new Set((preview?.matchedFields || []).map((field) => field.header));

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
      await onConfirm(file, createMissing);
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
            <p className="toolbar-title">Drop a workbook to preview the first rows before they land in the sheet.</p>
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

        {preview ? (
          <>
            <p className="import-summary">
              Found {preview.totalRows} rows, {preview.headers.length} columns detected in {preview.sheetName || "Sheet1"}
            </p>
            <div className="preview-scroll">
              <table className="preview-table">
                <thead>
                  <tr>
                    {preview.headers.map((header) => (
                      <th key={header} className={matched.has(header) ? "is-mapped" : "is-new"}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map((row, index) => (
                    <tr key={`${file?.name || "row"}-${index}`}>
                      {preview.headers.map((header) => (
                        <td key={header}>{row[header] || "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canCreateColumns ? (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={createMissing}
                  onChange={(event) => setCreateMissing(event.target.checked)}
                  disabled={importing}
                />
                Create columns for unmatched headers
              </label>
            ) : null}
          </>
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
            {importing ? "Importing…" : "Confirm & Import to Sheet"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ExcelImportModal;
