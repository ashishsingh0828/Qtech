import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";
import {
  canEditField,
  cellText,
  columnLetter,
  compareCell,
  draftFromValue,
  draftsMatch,
  statusTone,
  typeLabel,
} from "../../lib/cells";
import { syncLabel } from "../../lib/session";
import "./grid.css";

function Editor({ field, value, onCommit, onCancel }) {
  const [draft, setDraft] = useState(() => draftFromValue(field, value));
  const inputRef = useRef(null);
  const skipBlur = useRef(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      if (field.field_type !== "date") inputRef.current?.select?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [field.field_type]);

  async function finish(move) {
    if (skipBlur.current) return;
    skipBlur.current = true;
    const saved = await onCommit(draft, move);
    if (!saved) {
      skipBlur.current = false;
      inputRef.current?.focus();
    }
  }

  function onKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      void finish("down");
    } else if (event.key === "Tab") {
      event.preventDefault();
      void finish(event.shiftKey ? "left" : "right");
    } else if (event.key === "Escape") {
      event.preventDefault();
      skipBlur.current = true;
      onCancel();
    }
  }

  if (field.field_type === "boolean") {
    return (
      <select
        ref={inputRef}
        className="cell-input"
        value={draft}
        aria-label={field.name}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => { void finish(null); }}
        onKeyDown={onKeyDown}
      >
        <option value="">—</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }

  return (
    <input
      ref={inputRef}
      className="cell-input"
      type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : field.field_type === "email" ? "email" : "text"}
      value={draft}
      aria-label={field.name}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => { void finish(null); }}
      onKeyDown={onKeyDown}
    />
  );
}

function SpreadsheetWorkspace({
  fields,
  records,
  loading,
  query,
  filterFieldId,
  filterValue,
  onSaveCell,
  onInsertRow,
  onDeleteRow,
  onInsertColumn,
  onDeleteColumn,
  isAdmin,
  savedPulseKey,
  cellError,
  lastSyncAt,
  focusRecordId,
}) {
  const [selection, setSelection] = useState(null);
  const [editing, setEditing] = useState(false);
  const [trackedFocus, setTrackedFocus] = useState(null);
  const [sort, setSort] = useState(null);
  const [columnMenu, setColumnMenu] = useState(null);
  const [rowMenu, setRowMenu] = useState(null);
  const gridRef = useRef(null);

  const needle = query.trim().toLowerCase();
  const filterField = fields.find((field) => String(field.id) === String(filterFieldId)) || null;
  const filterNeedle = filterValue.trim().toLowerCase();
  const filtered = records.filter((record) => {
    if (needle) {
      const matches = fields.some((field) => {
        const raw = record.values?.[field.field_key];
        return cellText(field, raw).toLowerCase().includes(needle) || String(raw ?? "").toLowerCase().includes(needle);
      });
      if (!matches) return false;
    }
    if (filterField && filterNeedle) {
      const raw = record.values?.[filterField.field_key];
      return cellText(filterField, raw).toLowerCase().includes(filterNeedle) || String(raw ?? "").toLowerCase().includes(filterNeedle);
    }
    return true;
  });
  const viewRecords = sort
    ? [...filtered].sort((left, right) => {
        const field = fields.find((entry) => entry.id === sort.fieldId);
        if (!field) return 0;
        const compared = compareCell(field, left, right);
        return sort.direction === "desc" ? -compared : compared;
      })
    : filtered;

  if (focusRecordId && fields.length && trackedFocus !== focusRecordId) {
    setTrackedFocus(focusRecordId);
    setSelection({ recordId: focusRecordId, fieldIndex: 0 });
    setEditing(false);
  }

  useEffect(() => {
    if (!focusRecordId) return;
    gridRef.current?.focus();
  }, [focusRecordId]);

  useEffect(() => {
    if (columnMenu == null && rowMenu == null) return undefined;
    function onPointer(event) {
      if (!event.target.closest?.("[data-grid-menu]")) {
        setColumnMenu(null);
        setRowMenu(null);
      }
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [columnMenu, rowMenu]);

  function moveSelection(direction) {
    if (!selection || !viewRecords.length || !fields.length) return;
    const rowIndex = viewRecords.findIndex((record) => record.id === selection.recordId);
    if (rowIndex < 0) return;
    let nextRow = rowIndex;
    let nextCol = selection.fieldIndex;
    if (direction === "down") nextRow = Math.min(viewRecords.length - 1, rowIndex + 1);
    if (direction === "up") nextRow = Math.max(0, rowIndex - 1);
    if (direction === "right") {
      nextCol += 1;
      if (nextCol >= fields.length) {
        nextCol = 0;
        nextRow = Math.min(viewRecords.length - 1, rowIndex + 1);
      }
    }
    if (direction === "left") {
      nextCol -= 1;
      if (nextCol < 0) {
        nextCol = fields.length - 1;
        nextRow = Math.max(0, rowIndex - 1);
      }
    }
    setSelection({ recordId: viewRecords[nextRow].id, fieldIndex: nextCol });
    setEditing(false);
  }

  function onGridKeyDown(event) {
    if (!selection || editing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      const field = fields[selection.fieldIndex];
      if (field && canEditField(field)) setEditing(true);
    } else if (event.key === "Tab") {
      event.preventDefault();
      moveSelection(event.shiftKey ? "left" : "right");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection("down");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection("up");
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      moveSelection("right");
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveSelection("left");
    }
  }

  async function commitEditor(record, field, fieldIndex, draft, move) {
    const current = record.values?.[field.field_key];
    if (!draftsMatch(field, current, draft)) {
      const nextValue = field.field_type === "boolean" ? (draft === "" ? "" : draft === "true") : draft;
      const saved = await onSaveCell(record, field, nextValue);
      if (!saved) {
        setEditing(true);
        setSelection({ recordId: record.id, fieldIndex });
        return false;
      }
    }
    setEditing(false);
    if (move) moveSelection(move);
    return true;
  }

  const selectedRecord = selection ? viewRecords.find((record) => record.id === selection.recordId) : null;
  const selectedField = selection ? fields[selection.fieldIndex] : null;
  const selectedIndex = selectedRecord ? viewRecords.findIndex((record) => record.id === selectedRecord.id) : -1;
  const selectedLabel = selectedField && selectedIndex >= 0
    ? `${columnLetter(selection.fieldIndex)}${selectedIndex + 1} · ${selectedField.name}`
    : "None";

  function sortAscending(field) {
    setSort({ fieldId: field.id, direction: "asc" });
    setColumnMenu(null);
  }

  return (
    <>
      <div className="grid-canvas">
        <div className="grid-scroll" ref={gridRef} tabIndex={0} onKeyDown={onGridKeyDown}>
          <table className="grid-table">
            <thead>
              <tr>
                <th className="row-num">#</th>
                {fields.map((field) => {
                  const direction = sort?.fieldId === field.id ? sort.direction : "";
                  return (
                    <th key={field.id} className="col-head" scope="col">
                      <div className="col-head-main">
                        <button
                          className="col-name"
                          type="button"
                          onClick={() => {
                            setSort((current) => {
                              if (!current || current.fieldId !== field.id) return { fieldId: field.id, direction: "asc" };
                              if (current.direction === "asc") return { fieldId: field.id, direction: "desc" };
                              return null;
                            });
                          }}
                        >
                          {field.name}
                          {field.is_required ? " *" : ""}
                        </button>
                        <span className="type-badge">{typeLabel(field.field_type)}</span>
                        {direction === "asc" ? <ArrowUp size={14} aria-hidden="true" /> : null}
                        {direction === "desc" ? <ArrowDown size={14} aria-hidden="true" /> : null}
                        <button
                          className="col-menu-btn"
                          type="button"
                          aria-label={`Column actions for ${field.name}`}
                          aria-expanded={columnMenu === field.id}
                          onClick={() => {
                            setRowMenu(null);
                            setColumnMenu((current) => (current === field.id ? null : field.id));
                          }}
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>
                      {columnMenu === field.id ? (
                        <div className="col-menu" data-grid-menu role="menu">
                          {isAdmin ? (
                            <button className="menu-item" type="button" onClick={() => { setColumnMenu(null); onInsertColumn(field, "left"); }}>
                              <Plus size={14} aria-hidden="true" />
                              Insert column left
                            </button>
                          ) : null}
                          {isAdmin ? (
                            <button className="menu-item" type="button" onClick={() => { setColumnMenu(null); onInsertColumn(field, "right"); }}>
                              <Plus size={14} aria-hidden="true" />
                              Insert column right
                            </button>
                          ) : null}
                          <button className="menu-item" type="button" onClick={() => sortAscending(field)}>
                            <ArrowUp size={14} aria-hidden="true" />
                            Sort A-Z
                          </button>
                          {isAdmin ? (
                            <button className="menu-item is-danger" type="button" onClick={() => { setColumnMenu(null); onDeleteColumn(field); }}>
                              <Trash2 size={14} aria-hidden="true" />
                              Delete column
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </th>
                  );
                })}
                <th className="actions-cell"> </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="grid-empty" colSpan={fields.length + 2}>Loading rows…</td>
                </tr>
              ) : null}
              {!loading && fields.length === 0 ? (
                <tr>
                  <td className="grid-empty" colSpan={2}>Add a column before entering rows.</td>
                </tr>
              ) : null}
              {!loading && fields.length > 0 && viewRecords.length === 0 ? (
                <tr>
                  <td className="grid-empty" colSpan={fields.length + 2}>
                    {records.length === 0 ? "No rows yet." : "No rows match your search or filter."}
                  </td>
                </tr>
              ) : null}
              {!loading
                ? viewRecords.map((record, rowIndex) => (
                    <tr key={record.id}>
                      <td className="row-num">
                        <button
                          className="row-menu-btn"
                          type="button"
                          aria-label={`Row actions for ${rowIndex + 1}`}
                          aria-expanded={rowMenu === record.id}
                          onClick={() => {
                            setColumnMenu(null);
                            setRowMenu((current) => (current === record.id ? null : record.id));
                          }}
                        >
                          <ChevronDown size={14} />
                        </button>
                        {rowIndex + 1}
                        {rowMenu === record.id ? (
                          <div className="row-menu" data-grid-menu role="menu">
                            <button className="menu-item" type="button" onClick={() => { setRowMenu(null); onInsertRow(record, "above"); }}>
                              Insert row above
                            </button>
                            <button className="menu-item" type="button" onClick={() => { setRowMenu(null); onInsertRow(record, "below"); }}>
                              Insert row below
                            </button>
                          </div>
                        ) : null}
                      </td>
                      {fields.map((field, fieldIndex) => {
                        const locked = !canEditField(field);
                        const isSelected = selection?.recordId === record.id && selection?.fieldIndex === fieldIndex;
                        const isEditing = isSelected && editing && !locked;
                        const shown = cellText(field, record.values?.[field.field_key]);
                        const tone = statusTone(shown);
                        const className = [
                          "grid-cell",
                          isSelected ? "is-selected" : "",
                          isEditing ? "is-editing" : "",
                          locked ? "is-locked" : "",
                          savedPulseKey === `${record.id}:${field.id}` ? "cell-saved-pulse" : "",
                        ].filter(Boolean).join(" ");
                        return (
                          <td
                            key={field.id}
                            className={className}
                            onClick={() => {
                              setSelection({ recordId: record.id, fieldIndex });
                              setEditing(false);
                              gridRef.current?.focus();
                            }}
                            onDoubleClick={() => {
                              if (locked) return;
                              setSelection({ recordId: record.id, fieldIndex });
                              setEditing(true);
                            }}
                          >
                            {isEditing ? (
                              <Editor
                                field={field}
                                value={record.values?.[field.field_key]}
                                onCancel={() => setEditing(false)}
                                onCommit={(draft, move) => commitEditor(record, field, fieldIndex, draft, move)}
                              />
                            ) : (
                              <div className="cell-line">
                                {tone ? (
                                  <span className={`status-pill status-${tone}`}>{shown}</span>
                                ) : (
                                  <span className={shown ? undefined : "cell-empty"}>{shown || "—"}</span>
                                )}
                                {locked ? <Lock className="lock-icon" size={13} aria-label="Read only" /> : null}
                                {cellError?.key === `${record.id}:${field.id}` ? (
                                  <span className="cell-error">{cellError.message}</span>
                                ) : null}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="actions-cell">
                        <button className="delete-link" type="button" onClick={() => onDeleteRow(record)}>
                          <Trash2 size={13} aria-hidden="true" />
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        </div>
      </div>
      <div className="sheet-status" aria-live="polite">
        <span>Showing <strong>{viewRecords.length}</strong> of <strong>{records.length}</strong> rows</span>
        <span>Selected Cell <strong>{selectedLabel}</strong></span>
        <span>Last Sync: <strong>{syncLabel(lastSyncAt)}</strong></span>
      </div>
    </>
  );
}

export default SpreadsheetWorkspace;
