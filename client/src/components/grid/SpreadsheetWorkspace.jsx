import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { isOutOfWarranty, isYes, matchesWorkflowTab, readField, workflowColumn } from "../../lib/workflow";
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

function fieldSize(columnWidths, fieldId) {
  const width = columnWidths[fieldId];
  if (width) return { width, minWidth: width };
  return { minWidth: 160 };
}

function cellKeyFieldId(key, recordId) {
  const marker = `${recordId}:`;
  if (!key || !key.startsWith(marker)) return null;
  const fieldId = Number(key.slice(marker.length));
  return Number.isInteger(fieldId) ? fieldId : null;
}

const SheetRow = memo(function SheetRow({
  record,
  rowIndex,
  fields,
  columnWidths,
  selectedFieldIndex,
  editing,
  checked,
  menuOpen,
  pulseFieldId,
  errorFieldId,
  errorMessage,
  onSelectCell,
  onEditCell,
  onToggleChecked,
  onToggleMenu,
  onInsertRow,
  onDeleteRow,
  onCommit,
  canVerify,
  busyAction,
  onValidate,
  onVerify,
  onProposal,
}) {
  return (
    <tr className="grid-row">
      <td className="row-num">
        <label className="row-check">
          <input
            type="checkbox"
            checked={checked}
            aria-label={`Select row ${rowIndex + 1}`}
            onChange={() => onToggleChecked(record.id)}
            onClick={(event) => event.stopPropagation()}
          />
        </label>
        <button
          className="row-menu-btn"
          type="button"
          aria-label={`Row actions for ${rowIndex + 1}`}
          aria-expanded={menuOpen}
          onClick={() => onToggleMenu(record.id)}
        >
          <ChevronDown size={14} />
        </button>
        {rowIndex + 1}
        {menuOpen ? (
          <div className="row-menu" data-grid-menu role="menu">
            <button className="menu-item" type="button" onClick={() => onInsertRow(record, "above")}>
              Insert row above
            </button>
            <button className="menu-item" type="button" onClick={() => onInsertRow(record, "below")}>
              Insert row below
            </button>
          </div>
        ) : null}
      </td>
      {fields.map((field, fieldIndex) => {
        const locked = !canEditField(field);
        const isSelected = selectedFieldIndex === fieldIndex;
        const columnKind = workflowColumn(field);
        const shown = cellText(field, record.values?.[field.field_key]);
        const tone = statusTone(shown);
        const validated = isYes(readField(fields, record, "Validated"));
        const validatedBy = readField(fields, record, "Validated By");
        const verification = readField(fields, record, "Verification Status");
        const verifiedBy = readField(fields, record, "Verified By");
        const proposalSent = readField(fields, record, "Proposal Sent");
        const statusValue = readField(fields, record, "Status");
        const followUp = readField(fields, record, "Follow-up Date").slice(0, 10);
        const outOfWarranty = isOutOfWarranty(statusValue);
        const verified = verification.trim().toLowerCase() === "verified ok";
        const isEditing = isSelected && editing && !locked && columnKind !== "validated" && columnKind !== "verification" && columnKind !== "proposal" && !(columnKind === "followup" && outOfWarranty);
        const className = [
          "grid-cell",
          isSelected ? "is-selected" : "",
          isEditing ? "is-editing" : "",
          locked ? "is-locked" : "",
          pulseFieldId === field.id ? "cell-saved-pulse" : "",
        ].filter(Boolean).join(" ");
        return (
          <td
            key={field.id}
            className={className}
            style={fieldSize(columnWidths, field.id)}
            onClick={() => onSelectCell(record.id, fieldIndex)}
            onDoubleClick={() => {
              if (locked || columnKind === "validated" || columnKind === "verification" || columnKind === "proposal") return;
              if (columnKind === "followup" && outOfWarranty) return;
              onEditCell(record.id, fieldIndex);
            }}
          >
            {isEditing ? (
              <Editor
                field={field}
                value={record.values?.[field.field_key]}
                onCancel={() => onSelectCell(record.id, fieldIndex)}
                onCommit={(draft, move) => onCommit(record, field, fieldIndex, draft, move)}
              />
            ) : (
              <div className="cell-line">
                {columnKind === "validated" ? (
                  validated ? (
                    <span className="workflow-lock" title={validatedBy}>✓ Validated by {validatedBy || "user"}</span>
                  ) : (
                    <button
                      className="workflow-action"
                      type="button"
                      disabled={busyAction === "validate"}
                      onClick={(event) => {
                        event.stopPropagation();
                        onValidate(record);
                      }}
                    >
                      {busyAction === "validate" ? "Saving…" : "Validate"}
                    </button>
                  )
                ) : null}
                {columnKind === "verification" ? (
                  verified ? (
                    <span className="workflow-lock">✓ Verified OK ({verifiedBy || "Manager"})</span>
                  ) : validated && canVerify ? (
                    <button
                      className="workflow-action"
                      type="button"
                      disabled={busyAction === "verify"}
                      onClick={(event) => {
                        event.stopPropagation();
                        onVerify(record);
                      }}
                    >
                      {busyAction === "verify" ? "Saving…" : "Verify"}
                    </button>
                  ) : (
                    <span className="status-pill status-pending">Pending</span>
                  )
                ) : null}
                {columnKind === "proposal" ? (
                  outOfWarranty ? (
                    <span className="proposal-line">
                      <span className={proposalSent.trim().toLowerCase() === "yes" ? "status-pill status-active" : proposalSent.trim().toLowerCase() === "na" ? "status-pill status-completed" : "status-pill status-pending"}>
                        {proposalSent.trim().toLowerCase() === "yes" ? "Sent" : proposalSent.trim().toLowerCase() === "na" ? "NA" : "Pending"}
                      </span>
                      {proposalSent.trim().toLowerCase() !== "yes" ? (
                        <button
                          className="workflow-action"
                          type="button"
                          disabled={busyAction === "proposal"}
                          onClick={(event) => {
                            event.stopPropagation();
                            onProposal(record, { proposalSent: "Yes" });
                          }}
                        >
                          Mark sent
                        </button>
                      ) : null}
                    </span>
                  ) : (
                    <span className={shown ? "cell-clip" : "cell-empty cell-clip"}>{shown || "—"}</span>
                  )
                ) : null}
                {columnKind === "followup" && outOfWarranty ? (
                  <input
                    className="follow-input"
                    type="date"
                    aria-label="Follow-up date"
                    value={/^\d{4}-\d{2}-\d{2}$/.test(followUp) ? followUp : ""}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => onProposal(record, { followUpDate: event.target.value })}
                  />
                ) : null}
                {columnKind === "status" && tone ? (
                  <span className={`status-pill status-${tone}`} title={shown}>{shown}</span>
                ) : null}
                {columnKind === "status" && !tone ? (
                  <span className={shown ? "cell-clip" : "cell-empty cell-clip"} title={shown || ""}>{shown || "—"}</span>
                ) : null}
                {!columnKind || (columnKind === "followup" && !outOfWarranty) ? (
                  tone ? (
                    <span className={`status-pill status-${tone}`} title={shown}>{shown}</span>
                  ) : (
                    <span className={shown ? "cell-clip" : "cell-empty cell-clip"} title={shown || ""}>{shown || "—"}</span>
                  )
                ) : null}
                {locked && columnKind !== "verification" ? <Lock className="lock-icon" size={13} aria-label="Read only" /> : null}
                {errorFieldId === field.id ? <span className="cell-error">{errorMessage}</span> : null}
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
  );
});

function SpreadsheetWorkspace({
  fields,
  records,
  loading,
  query,
  filters,
  onSaveCell,
  onInsertRow,
  onDeleteRow,
  onDeleteRows,
  onInsertColumn,
  onDeleteColumn,
  onValidate,
  onVerify,
  onProposal,
  workflowTab,
  canVerify,
  workflowBusy,
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
  const [checkedIds, setCheckedIds] = useState([]);
  const [columnWidths, setColumnWidths] = useState({});
  const gridRef = useRef(null);
  const scrollPos = useRef({ top: 0, left: 0 });
  const actionRef = useRef({});

  const needle = query.trim().toLowerCase();
  const activeFilters = (filters || []).filter((filter) => filter.fieldId && String(filter.value || "").trim());
  const filtered = records.filter((record) => {
    if (!matchesWorkflowTab(fields, record, workflowTab)) return false;
    if (needle) {
      const matches = fields.some((field) => {
        const raw = record.values?.[field.field_key];
        return cellText(field, raw).toLowerCase().includes(needle) || String(raw ?? "").toLowerCase().includes(needle);
      });
      if (!matches) return false;
    }
    return activeFilters.every((filter) => {
      const field = fields.find((entry) => String(entry.id) === String(filter.fieldId));
      if (!field) return true;
      const raw = record.values?.[field.field_key];
      const needleValue = String(filter.value).trim().toLowerCase();
      return cellText(field, raw).toLowerCase().includes(needleValue) || String(raw ?? "").toLowerCase().includes(needleValue);
    });
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

  useLayoutEffect(() => {
    const node = gridRef.current;
    if (!node) return;
    if (node.scrollTop !== scrollPos.current.top) node.scrollTop = scrollPos.current.top;
    if (node.scrollLeft !== scrollPos.current.left) node.scrollLeft = scrollPos.current.left;
  });

  function rememberScroll() {
    const node = gridRef.current;
    if (!node) return;
    scrollPos.current = { top: node.scrollTop, left: node.scrollLeft };
  }

  function columnSize(fieldId) {
    const width = columnWidths[fieldId];
    if (width) return { width, minWidth: width };
    return { minWidth: 160 };
  }

  function beginResize(fieldId, event) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[fieldId] || 180;
    function onMove(moveEvent) {
      const next = Math.max(96, startWidth + moveEvent.clientX - startX);
      setColumnWidths((current) => ({ ...current, [fieldId]: next }));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const selectCell = useCallback((recordId, fieldIndex) => {
    setSelection({ recordId, fieldIndex });
    setEditing(false);
    gridRef.current?.focus();
  }, []);

  const editCell = useCallback((recordId, fieldIndex) => {
    setSelection({ recordId, fieldIndex });
    setEditing(true);
  }, []);

  const toggleChecked = useCallback((recordId) => {
    setCheckedIds((current) => (
      current.includes(recordId) ? current.filter((id) => id !== recordId) : [...current, recordId]
    ));
  }, []);

  const toggleRowMenu = useCallback((recordId) => {
    setColumnMenu(null);
    setRowMenu((current) => (current === recordId ? null : recordId));
  }, []);

  const insertRelative = useCallback((record, placement) => {
    setRowMenu(null);
    actionRef.current.onInsertRow(record, placement);
  }, []);

  const deleteOne = useCallback((record) => {
    actionRef.current.onDeleteRow(record);
  }, []);

  const commitCell = useCallback((record, field, fieldIndex, draft, move) => {
    return actionRef.current.commit(record, field, fieldIndex, draft, move);
  }, []);

  const validateRow = useCallback((record) => actionRef.current.onValidate(record), []);
  const verifyRow = useCallback((record) => actionRef.current.onVerify(record), []);
  const proposeRow = useCallback((record, patch) => actionRef.current.onProposal(record, patch), []);

  function toggleAllVisible() {
    const visibleIds = viewRecords.map((record) => record.id);
    const allOn = visibleIds.length > 0 && visibleIds.every((id) => checkedIds.includes(id));
    setCheckedIds(allOn ? checkedIds.filter((id) => !visibleIds.includes(id)) : [...new Set([...checkedIds, ...visibleIds])]);
  }

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

  useEffect(() => {
    actionRef.current = {
      onInsertRow,
      onDeleteRow,
      onValidate,
      onVerify,
      onProposal,
      commit: commitEditor,
    };
  });

  const selectedRecord = selection ? viewRecords.find((record) => record.id === selection.recordId) : null;
  const selectedField = selection ? fields[selection.fieldIndex] : null;
  const selectedIndex = selectedRecord ? viewRecords.findIndex((record) => record.id === selectedRecord.id) : -1;
  const selectedLabel = selectedField && selectedIndex >= 0
    ? `${columnLetter(selection.fieldIndex)}${selectedIndex + 1} · ${selectedField.name}`
    : "None";

  function sortColumn(field, direction) {
    setSort({ fieldId: field.id, direction });
    setColumnMenu(null);
  }

  const checkedRecords = records.filter((record) => checkedIds.includes(record.id));
  const visibleIds = viewRecords.map((record) => record.id);
  const allVisibleChecked = visibleIds.length > 0 && visibleIds.every((id) => checkedIds.includes(id));

  return (
    <>
      <div className="grid-canvas">
        <div
          className="grid-scroll"
          ref={gridRef}
          tabIndex={0}
          onKeyDown={onGridKeyDown}
          onScroll={rememberScroll}
        >
          <table className="grid-table">
            <thead>
              <tr>
                <th className="row-num">
                  <label className="row-check">
                    <input
                      type="checkbox"
                      checked={allVisibleChecked}
                      onChange={toggleAllVisible}
                      aria-label="Select all visible rows"
                    />
                    <span>#</span>
                  </label>
                </th>
                {fields.map((field) => {
                  const direction = sort?.fieldId === field.id ? sort.direction : "";
                  return (
                    <th key={field.id} className="col-head" scope="col" style={columnSize(field.id)}>
                      <div className="col-head-main">
                        <button
                          className="col-name"
                          type="button"
                          title={field.name}
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
                          <button className="menu-item" type="button" onClick={() => sortColumn(field, "asc")}>
                            <ArrowUp size={14} aria-hidden="true" />
                            Sort A-Z
                          </button>
                          <button className="menu-item" type="button" onClick={() => sortColumn(field, "desc")}>
                            <ArrowDown size={14} aria-hidden="true" />
                            Sort Z-A
                          </button>
                          {isAdmin ? (
                            <button className="menu-item is-danger" type="button" onClick={() => { setColumnMenu(null); onDeleteColumn(field); }}>
                              <Trash2 size={14} aria-hidden="true" />
                              Delete column
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      <span
                        className="col-resizer"
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${field.name}`}
                        onMouseDown={(event) => beginResize(field.id, event)}
                      />
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
                ? viewRecords.map((record, rowIndex) => {
                    const errorFieldId = cellKeyFieldId(cellError?.key, record.id);
                    return (
                    <SheetRow
                      key={record.id}
                      record={record}
                      rowIndex={rowIndex}
                      fields={fields}
                      columnWidths={columnWidths}
                      selectedFieldIndex={selection?.recordId === record.id ? selection.fieldIndex : -1}
                      editing={Boolean(editing && selection?.recordId === record.id)}
                      checked={checkedIds.includes(record.id)}
                      menuOpen={rowMenu === record.id}
                      pulseFieldId={cellKeyFieldId(savedPulseKey, record.id)}
                      errorFieldId={errorFieldId}
                      errorMessage={errorFieldId != null ? cellError.message : ""}
                      onSelectCell={selectCell}
                      onEditCell={editCell}
                      onToggleChecked={toggleChecked}
                      onToggleMenu={toggleRowMenu}
                      onInsertRow={insertRelative}
                      onDeleteRow={deleteOne}
                      onCommit={commitCell}
                      canVerify={canVerify}
                      busyAction={workflowBusy?.recordId === record.id ? workflowBusy.action : ""}
                      onValidate={validateRow}
                      onVerify={verifyRow}
                      onProposal={proposeRow}
                    />
                    );
                  })
                : null}
            </tbody>
          </table>
        </div>
      </div>
      <div className="sheet-status" aria-live="polite">
        <span>Total Rows <strong>{records.length}</strong></span>
        <span>Filtered Rows <strong>{viewRecords.length}</strong></span>
        <span>Selected Cell <strong>{selectedLabel}</strong></span>
        <span>Sync <strong>{syncLabel(lastSyncAt)}</strong></span>
        {checkedRecords.length ? (
          <button className="delete-link" type="button" onClick={() => onDeleteRows(checkedRecords)}>
            Delete {checkedRecords.length} selected
          </button>
        ) : null}
      </div>
    </>
  );
}

export default SpreadsheetWorkspace;
