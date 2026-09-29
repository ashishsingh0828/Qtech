import { Download, Filter, History, Plus, Search, Shield, Upload, X } from "lucide-react";
import "./grid.css";

function GridToolbar({
  title,
  description,
  query,
  onQueryChange,
  filterOpen,
  filterActive,
  filterFieldId,
  filterValue,
  fields,
  onToggleFilter,
  onFilterField,
  onFilterValue,
  onClearFilter,
  onAddRow,
  onAddColumn,
  canAddColumn,
  onImport,
  onExport,
  exporting,
  auditOpen,
  onToggleAudit,
  onPermissions,
  canManagePermissions,
  filterRef,
}) {
  return (
    <div className="grid-toolbar">
      <div className="toolbar-title">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="toolbar-actions">
        <label className="tool-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search rows"
            aria-label="Search rows"
          />
          {query ? (
            <button className="icon-clear" type="button" aria-label="Clear search" onClick={() => onQueryChange("")}>
              <X size={14} />
            </button>
          ) : null}
          <kbd className="type-badge">Ctrl+K</kbd>
        </label>
        <div className="filter-anchor" ref={filterRef}>
          <button
            className={filterActive ? "tool-button filter-active" : "tool-button"}
            type="button"
            aria-expanded={filterOpen}
            onClick={onToggleFilter}
          >
            <Filter size={16} aria-hidden="true" />
            Filter
          </button>
          {filterOpen ? (
            <div className="filter-pop" role="dialog" aria-label="Filter by column">
              <select value={filterFieldId} aria-label="Filter column" onChange={(event) => onFilterField(event.target.value)}>
                <option value="">Choose a column</option>
                {fields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={filterValue}
                placeholder="Contains…"
                aria-label="Filter value"
                onChange={(event) => onFilterValue(event.target.value)}
              />
              <button className="ghost-button" type="button" onClick={onClearFilter}>
                Clear filter
              </button>
            </div>
          ) : null}
        </div>
        <button className="primary-button" type="button" onClick={onAddRow} disabled={fields.length === 0}>
          <Plus size={16} aria-hidden="true" />
          Add Row
        </button>
        {canAddColumn ? (
          <button className="tool-button" type="button" onClick={onAddColumn}>
            <Plus size={16} aria-hidden="true" />
            Add Column
          </button>
        ) : null}
        <button className="tool-button" type="button" onClick={onImport}>
          <Upload size={16} aria-hidden="true" />
          Import Excel
        </button>
        <button className="tool-button" type="button" onClick={onExport} disabled={exporting}>
          <Download size={16} aria-hidden="true" />
          {exporting ? "Exporting…" : "Export Excel"}
        </button>
        <button className={auditOpen ? "tool-button is-active" : "tool-button"} type="button" onClick={onToggleAudit}>
          <History size={16} aria-hidden="true" />
          Audit History
        </button>
        {canManagePermissions ? (
          <button className="tool-button" type="button" onClick={onPermissions}>
            <Shield size={16} aria-hidden="true" />
            Permissions
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default GridToolbar;
