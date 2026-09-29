import { useRef, useState } from "react";
import { FileSpreadsheet, X } from "lucide-react";
import "../grid/grid.css";

function isExcelFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls");
}

function choiceValue(choice) {
  if (choice?.action === "create") return "create";
  if (choice?.action === "field" && choice.fieldId) return `field:${choice.fieldId}`;
  return "skip";
}

function buildInitialMapping(data, canCreateColumns) {
  const used = new Set();
  const mapping = {};
  for (const header of data.headers || []) {
    const match = (data.matchedFields || []).find((field) => field.header === header);
    if (match && !used.has(String(match.field_id))) {
      mapping[header] = { action: "field", fieldId: String(match.field_id) };
      used.add(String(match.field_id));
    } else if (canCreateColumns) {
      mapping[header] = { action: "create", fieldId: "" };
    } else {
      mapping[header] = { action: "skip", fieldId: "" };
    }
  }
  return mapping;
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
  const [mapping, setMapping] = useState({});
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  if (!open) return null;

  const datasetFields = preview?.datasetFields || [];

  async function acceptFile(nextFile) {
    if (!nextFile) return;
    if (!isExcelFile(nextFile)) {
      setFile(null);
      setPreview(null);
      setMapping({});
      setPreviewError("Choose an .xlsx or .xls file.");
      return;
    }
    setFile(nextFile);
    setPreview(null);
    setMapping({});
    setPreviewError("");
    setImportError("");
    setPreviewLoading(true);
    try {
      const data = await onPreview(nextFile);
      setPreview(data);
      setMapping(buildInitialMapping(data, canCreateColumns));
    } catch (error) {
      setPreviewError(error?.message || "Unable to preview this spreadsheet.");
    } finally {
      setPreviewLoading(false);
    }
  }

  function assignHeader(header, value) {
    setMapping((current) => {
      const next = { ...current };
      if (value === "skip") {
        next[header] = { action: "skip", fieldId: "" };
        return next;
      }
      if (value === "create") {
        next[header] = { action: "create", fieldId: "" };
        return next;
      }
      const fieldId = value.replace("field:", "");
      for (const [otherHeader, choice] of Object.entries(next)) {
        if (otherHeader !== header && choice.action === "field" && choice.fieldId === fieldId) {
          next[otherHeader] = { action: "skip", fieldId: "" };
        }
      }
      next[header] = { action: "field", fieldId };
      return next;
    });
  }

  async function confirmImport() {
    if (!file || !preview) return;
    const payload = (preview.headers || []).map((header) => {
      const choice = mapping[header] || { action: "skip", fieldId: "" };
      return {
        header,
        action: choice.action,
        field_id: choice.action === "field" ? Number(choice.fieldId) : undefined,
      };
    });
    const active = payload.filter((item) => item.action !== "skip");
    if (!active.length) {
      setImportError("Map at least one Excel column before importing.");
      return;
    }
    setImporting(true);
    setImportError("");
    try {
      await onConfirm(file, payload);
      setFile(null);
      setPreview(null);
      setMapping({});
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
            <p className="toolbar-title">Match each Excel header to a dataset column, or create a new one.</p>
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
              Detected {preview.totalRows} rows and {preview.headers.length} columns
            </p>
            <div className="mapping-list">
              {preview.headers.map((header) => {
                const choice = mapping[header] || { action: "skip", fieldId: "" };
                return (
                  <label key={header} className="mapping-row">
                    <span className="mapping-source" title={header}>{header}</span>
                    <select
                      aria-label={`Map ${header}`}
                      value={choiceValue(choice)}
                      disabled={importing}
                      onChange={(event) => assignHeader(header, event.target.value)}
                    >
                      <option value="skip">Skip Column</option>
                      {canCreateColumns ? <option value="create">Create New Column</option> : null}
                      {datasetFields.map((field) => (
                        <option key={field.id} value={`field:${field.id}`}>
                          {field.name}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
            <div className="preview-scroll">
              <table className="preview-table">
                <thead>
                  <tr>
                    {preview.headers.map((header) => {
                      const choice = mapping[header] || { action: "skip" };
                      const field = datasetFields.find((entry) => String(entry.id) === String(choice.fieldId));
                      const label = choice.action === "create"
                        ? `${header} · New`
                        : choice.action === "field"
                          ? field?.name || header
                          : `${header} · Skipped`;
                      const tone = choice.action === "field" ? "is-mapped" : choice.action === "create" ? "is-new" : "is-skipped";
                      return (
                        <th key={header} className={tone} title={label}>{label}</th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {(preview.preview || []).slice(0, 5).map((row, index) => (
                    <tr key={`${file?.name || "row"}-${index}`}>
                      {preview.headers.map((header) => (
                        <td key={header} title={row[header] || ""}>{row[header] || "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
