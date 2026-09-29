import { useEffect, useMemo, useRef, useState } from "react";
import { formatCell, orderedColumns, pinnedCount, rawCell } from "../../lib/sheetFormat";
import "./SheetGrid.css";

const ROW_H = 36;
const HEAD_H = 72;
const GUTTER = 56;
const OVERSCAN = 8;

function SheetGrid({
  schema,
  rows,
  loading,
  error,
  onRetry,
  onPatch,
  onRename,
  onAddRow,
  onDeleteRow,
  canDelete,
  adding,
  autoNamed,
}) {
  const scrollerRef = useRef(null);
  const [viewport, setViewport] = useState({ width: 1440, height: 900, top: 0, left: 0 });
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [cellError, setCellError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(true);

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
  }, [columns.length, rows.length]);

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

  function beginEdit(row, column) {
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
    } catch (err) {
      setCellError(err?.message || "Unable to save this cell.");
      setEditing({ rowId: row.id, key: column.key });
    } finally {
      setSaving(false);
    }
  }

  function beginRename(column) {
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

  if (loading) return <div className="sheet-state">Loading sheet…</div>;
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
            <div className="sheet-line">
              <div className="sheet-gutter is-sticky" style={{ left: 0, zIndex: 8 }} />
              {groups.map((group) => {
                const end = group.startIndex + group.span;
                const width = (widths[end] || totalWidth) - widths[group.startIndex];
                const sticks = (widths[end] || 0) > pinWidth;
                return (
                  <div
                    key={group.id}
                    className={`sheet-banner tint-${group.tint || "general"}`}
                    style={{ width }}
                  >
                    <span className="sheet-banner-label" style={{ left: sticks ? pinWidth : 8 }}>{group.label}</span>
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
            {rows.length === 0 ? <div className="sheet-state in-body">No rows yet.</div> : null}
            {visibleRows.map(({ index, row }) => (
              <div key={row.id} className="sheet-row" style={{ top: index * ROW_H, width: totalWidth, height: ROW_H }}>
                <div className="sheet-gutter is-sticky" style={{ left: 0, zIndex: 3 }}>
                  <span>{index + 1}</span>
                  {canDelete ? (
                    <button type="button" className="sheet-row-delete" aria-label={`Delete row ${index + 1}`} onClick={() => onDeleteRow(row)}>
                      ×
                    </button>
                  ) : null}
                </div>
                {columns.map((column, columnIndex) => {
                  if (!columnVisible(columnIndex)) return <div key={column.key} style={{ width: column.width || 160, flex: "none" }} />;
                  const active = editing?.rowId === row.id && editing?.key === column.key;
                  const shown = formatCell(column, row.data?.[column.key]);
                  const pinned = columnIndex < pinCount;
                  return (
                    <div
                      key={column.key}
                      className={pinned ? "sheet-cell is-sticky" : "sheet-cell"}
                      style={{
                        width: column.width || 160,
                        left: pinned ? widths[columnIndex] : undefined,
                        zIndex: pinned ? 2 : 1,
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
        <button className="sheet-text-button" type="button" onClick={onAddRow} disabled={adding || !columns.length}>
          {adding ? "Adding row…" : "Add row"}
        </button>
        <span>{rows.length} rows</span>
        <span>{columns.length} columns</span>
        <span>{groups.length} groups</span>
      </div>
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
