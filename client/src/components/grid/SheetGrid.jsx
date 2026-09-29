import { useEffect, useMemo, useRef, useState } from "react";
import { Lock, MoreHorizontal, Trash2 } from "lucide-react";
import { useToast } from "../toast-context";
import { formatCell, orderedColumns, pinnedCount, rawCell, statusTone } from "../../lib/sheetFormat";
import "./SheetGrid.css";

const ROW_H = 36;
const BANNER_H = 32;
const SUB_H = 36;
const HEAD_H = BANNER_H + SUB_H;
const GUTTER = 72;
const OVERSCAN = 8;

function SheetGrid({
  schema,
  rows,
  loading,
  error,
  emptyLabel,
  timeZone,
  onRetry,
  onPatch,
  onRename,
  onAddRow,
  onDeleteRow,
  onOpenRow,
  onValidate,
  onVerify,
  canDelete,
  canAddRow,
  canRename,
  canValidate,
  canVerify,
  canClearValidation,
  editableKeys,
  denialMessage,
  adding,
  autoNamed,
  acting,
}) {
  const { notify } = useToast();
  const editable = new Set(editableKeys || []);
  const scrollerRef = useRef(null);
  const [viewport, setViewport] = useState({ width: 1440, height: 900, top: 0, left: 0 });
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [cellError, setCellError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(true);
  const [selected, setSelected] = useState(null);
  const [flash, setFlash] = useState(null);
  const [popover, setPopover] = useState(null);
  const [menu, setMenu] = useState(null);

  const columns = useMemo(() => orderedColumns(schema), [schema]);
  const pinCount = pinnedCount(columns);
  const groups = schema?.groups || [];
  const widths = useMemo(() => {
    const prefix = [GUTTER];
    columns.forEach((column) => {
      prefix.push(prefix[prefix.length - 1] + (column.width || 160));
    });
    return prefix;
  }, [columns]);
  const totalWidth = widths[widths.length - 1] || GUTTER;
  const pinWidth = widths[pinCount] || GUTTER;

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return undefined;
    const update = () => {
      setViewport({
        width: node.clientWidth,
        height: node.clientHeight,
        top: node.scrollTop,
        left: node.scrollLeft,
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    node.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      node.removeEventListener("scroll", update);
    };
  }, [columns.length, rows.length, loading]);

  useEffect(() => {
    if (!popover && !menu) return undefined;
    function close(event) {
      if (event.target.closest?.(".float-layer, .sheet-row-menu, .sheet-cell")) return;
      setPopover(null);
      setMenu(null);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [popover, menu]);

  const firstRow = Math.max(0, Math.floor((viewport.top - HEAD_H) / ROW_H) - OVERSCAN);
  const lastRow = Math.min(rows.length, Math.ceil((viewport.top + viewport.height - HEAD_H) / ROW_H) + OVERSCAN);
  const visibleRows = [];
  for (let index = firstRow; index < lastRow; index += 1) {
    if (rows[index]) visibleRows.push({ index, row: rows[index] });
  }

  function columnVisible(index) {
    if (index < pinCount) return true;
    const start = widths[index];
    const end = widths[index + 1];
    return end > viewport.left && start < viewport.left + viewport.width + 240;
  }

  function openPopover(kind, row, event) {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu(null);
    setPopover({ kind, row, top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 220) });
  }

  function beginEdit(row, column) {
    if (column.semantic === "validated") {
      if (!canValidate) notify(denialMessage || "You cannot edit that column.");
      return;
    }
    if (column.semantic === "verified" || column.computed) {
      if (!(column.semantic === "verified" && canVerify)) notify(denialMessage || "You cannot edit that column.");
      return;
    }
    if (!editable.has(column.key)) {
      notify(denialMessage || "You cannot edit that column.");
      return;
    }
    setPopover(null);
    setCellError("");
    setRenaming(null);
    setEditing({ rowId: row.id, key: column.key });
    setDraft(rawCell(row.data?.[column.key]));
  }

  async function commitEdit(row, column) {
    if (!editing || saving) return;
    const current = rawCell(row.data?.[column.key]);
    setEditing(null);
    if (draft === current) return;
    setSaving(true);
    setCellError("");
    try {
      await onPatch(row, column.key, draft);
      setFlash({ rowId: row.id, key: column.key });
      window.setTimeout(() => setFlash(null), 700);
    } catch (err) {
      setCellError(err?.message || "Unable to save this cell.");
      setEditing({ rowId: row.id, key: column.key });
    } finally {
      setSaving(false);
    }
  }

  function beginRename(column) {
    if (!canRename || column.system) return;
    setEditing(null);
    setRenaming(column.key);
    setRenameDraft(column.label);
  }

  async function commitRename(column) {
    const next = renameDraft.replace(/\s+/g, " ").trim().replace(/:+$/g, "").trim();
    setRenaming(null);
    if (!next || next === column.label) return;
    setSaving(true);
    setCellError("");
    try {
      await onRename(column.key, next);
    } catch (err) {
      setCellError(err?.message || "Unable to rename this column.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="sheet-state" aria-busy="true">
        <span className="skeleton-bar" />
        <span className="skeleton-bar" />
        <span className="skeleton-bar" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="sheet-state is-error">
        <p>{error}</p>
        <button className="sheet-text-button" type="button" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  if (!columns.length) return <div className="sheet-state">This dataset has no columns yet.</div>;

  return (
    <div className="sheet-frame" style={{ "--pin-width": `${pinWidth}px` }}>
      {autoNamed > 0 && notice ? (
        <div className="sheet-notice">
          <p>{autoNamed} columns had no header and were auto-named. Double-click a header to rename.</p>
          <button type="button" onClick={() => setNotice(false)}>Dismiss</button>
        </div>
      ) : null}
      {cellError ? <p className="sheet-cell-error">{cellError}</p> : null}
      <div className="sheet-scroll" ref={scrollerRef}>
        <div className="sheet-canvas" style={{ width: totalWidth, height: HEAD_H + Math.max(rows.length, 1) * ROW_H }}>
          <div className="sheet-head" style={{ width: totalWidth }}>
            <div className="sheet-line is-banner">
              <div className="sheet-gutter is-sticky" style={{ left: 0, zIndex: 8 }} />
              {groups.map((group) => {
                const end = group.startIndex + group.span;
                const width = (widths[end] || totalWidth) - widths[group.startIndex];
                const sticks = (widths[end] || 0) > pinWidth;
                const locked = columns.every((column) => column.groupId !== group.id || !editable.has(column.key));
                return (
                  <div key={group.id} className={`sheet-banner tint-${group.tint || "general"}`} style={{ width }}>
                    <span className="sheet-banner-label" style={{ left: sticks ? pinWidth : 8 }}>
                      {group.label}
                      {locked ? (
                        <span className="sheet-lock" title={denialMessage || "Read only"}>
                          <Lock size={12} strokeWidth={1.5} aria-label="Read only" />
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="sheet-line">
              <div className="sheet-gutter is-sticky" style={{ left: 0, zIndex: 8 }} />
              {columns.map((column, index) => (
                <div
                  key={column.key}
                  className={index < pinCount ? "sheet-subhead is-sticky" : "sheet-subhead"}
                  style={{
                    width: column.width || 160,
                    left: index < pinCount ? widths[index] : undefined,
                    zIndex: index < pinCount ? 7 : 1,
                  }}
                >
                  <HeaderLabel
                    column={column}
                    renaming={renaming === column.key}
                    renameDraft={renameDraft}
                    onDraft={setRenameDraft}
                    onBegin={() => beginRename(column)}
                    onCommit={() => { void commitRename(column); }}
                    onCancel={() => setRenaming(null)}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="sheet-body" style={{ height: Math.max(rows.length, 1) * ROW_H }}>
            {rows.length === 0 ? <div className="sheet-state in-body">{emptyLabel || "No rows yet."}</div> : null}
            {visibleRows.map(({ index, row }) => (
              <div key={row.id} className="sheet-row" style={{ top: index * ROW_H, width: totalWidth, height: ROW_H }}>
                <div className="sheet-gutter is-sticky" style={{ left: 0, zIndex: 3 }}>
                  <button
                    type="button"
                    className="sheet-row-menu"
                    aria-label={`Actions for row ${index + 1}`}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setPopover(null);
                      setMenu({ row, top: rect.bottom + 4, left: rect.left });
                    }}
                  >
                    <MoreHorizontal size={16} strokeWidth={1.5} />
                  </button>
                  <span onDoubleClick={() => onOpenRow(row)}>{index + 1}</span>
                  {canDelete ? (
                    <button type="button" className="sheet-row-delete" aria-label={`Delete row ${index + 1}`} onClick={() => onDeleteRow(row)}>
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                  ) : null}
                </div>
                {columns.map((column, columnIndex) => {
                  if (!columnVisible(columnIndex)) return <div key={column.key} style={{ width: column.width || 160, flex: "none" }} />;
                  const active = editing?.rowId === row.id && editing?.key === column.key;
                  const value = row.data?.[column.key];
                  const shown = formatCell(column, value, timeZone);
                  const tone = statusTone(value);
                  const pinned = columnIndex < pinCount;
                  const isSelected = selected?.rowId === row.id && selected?.key === column.key;
                  const isFlash = flash?.rowId === row.id && flash?.key === column.key;
                  return (
                    <div
                      key={column.key}
                      className={[
                        "sheet-cell",
                        pinned ? "is-sticky" : "",
                        pinned && columnIndex === pinCount - 1 ? "is-pin-edge" : "",
                        editable.has(column.key) ? "" : "is-readonly",
                        isSelected ? "is-selected" : "",
                        isFlash ? "is-saved" : "",
                      ].filter(Boolean).join(" ")}
                      style={{
                        width: column.width || 160,
                        left: pinned ? widths[columnIndex] : undefined,
                        zIndex: pinned ? 2 : 1,
                      }}
                      onClick={(event) => {
                        setSelected({ rowId: row.id, key: column.key });
                        if (column.semantic === "validated" && canValidate) openPopover("validate", row, event);
                        else if (column.semantic === "verified" && canVerify) openPopover("verify", row, event);
                      }}
                      onDoubleClick={() => beginEdit(row, column)}
                    >
                      {active ? (
                        <input
                          className="sheet-input"
                          value={draft}
                          aria-label={column.label}
                          autoFocus
                          onChange={(event) => setDraft(event.target.value)}
                          onBlur={(event) => {
                            if (event.currentTarget.dataset.cancel === "1") return;
                            void commitEdit(row, column);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.currentTarget.blur();
                            } else if (event.key === "Escape") {
                              event.currentTarget.dataset.cancel = "1";
                              setEditing(null);
                              event.currentTarget.blur();
                            }
                          }}
                        />
                      ) : tone ? (
                        <span className={`status-pill tone-${tone}`}>{shown}</span>
                      ) : (
                        <span className={shown ? "sheet-value" : "sheet-empty"} title={shown}>{shown || ""}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="sheet-foot">
        {canAddRow ? (
          <button className="sheet-text-button" type="button" onClick={onAddRow} disabled={adding || !columns.length}>
            {adding ? "Adding row…" : "Add row"}
          </button>
        ) : null}
        <span className="tabular">{rows.length} rows</span>
        <span className="tabular">{columns.length} columns</span>
        <span className="tabular">{groups.length} groups</span>
      </div>
      {popover ? (
        <div className="float-layer cell-popover" style={{ top: popover.top, left: popover.left }} role="dialog">
          {popover.kind === "validate" ? (
            <>
              <button type="button" disabled={acting} onClick={() => { setPopover(null); onValidate(popover.row, "Yes"); }}>Yes</button>
              <button type="button" disabled={acting} onClick={() => { setPopover(null); onValidate(popover.row, "No"); }}>No</button>
              {canClearValidation ? (
                <button type="button" disabled={acting} onClick={() => { setPopover(null); onValidate(popover.row, ""); }}>Clear</button>
              ) : null}
            </>
          ) : (
            <>
              <button type="button" disabled={acting} onClick={() => { setPopover(null); onVerify(popover.row, true); }}>Verified OK</button>
              <button type="button" disabled={acting} onClick={() => { setPopover(null); onVerify(popover.row, false); }}>Pending</button>
            </>
          )}
        </div>
      ) : null}
      {menu ? (
        <div className="float-layer cell-popover" style={{ top: menu.top, left: menu.left }} role="menu">
          <button type="button" onClick={() => { setMenu(null); onOpenRow(menu.row); }}>Open record</button>
        </div>
      ) : null}
    </div>
  );
}

function HeaderLabel({ column, renaming, renameDraft, onDraft, onBegin, onCommit, onCancel }) {
  if (renaming) {
    return (
      <input
        className="sheet-input"
        value={renameDraft}
        aria-label={`Rename ${column.label}`}
        autoFocus
        onChange={(event) => onDraft(event.target.value)}
        onBlur={(event) => {
          if (event.currentTarget.dataset.cancel === "1") return;
          onCommit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.currentTarget.dataset.cancel = "1";
            onCancel();
            event.currentTarget.blur();
          }
        }}
      />
    );
  }
  return (
    <button className="sheet-header-label" type="button" title={column.label} onDoubleClick={onBegin}>
      {column.label}
    </button>
  );
}

export default SheetGrid;
