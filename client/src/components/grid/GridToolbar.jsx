import { useRef, useState } from "react";
import { Download, Filter, History, Plus, Search, Shield, Upload, X } from "lucide-react";
import "./grid.css";

function GridToolbar({
  title,
  description,
  query,
  onQueryChange,
  filterOpen,
  filters,
  draftFieldId,
  draftValue,
  fields,
  onToggleFilter,
  onDraftField,
  onDraftValue,
  onAddFilter,
  onRemoveFilter,
  onClearFilters,
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
  const [searchText, setSearchText] = useState(query);
  const searchTimer = useRef(null);

  function changeSearch(next) {
    setSearchText(next);
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => onQueryChange(next), 180);
  }

  function clearSearch() {
    setSearchText("");
    window.clearTimeout(searchTimer.current);
    onQueryChange("");
  }

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
            value={searchText}
            onChange={(event) => changeSearch(event.target.value)}
            placeholder="Search rows"
            aria-label="Search rows"
          />
          {searchText ? (
            <button className="icon-clear" type="button" aria-label="Clear search" onClick={clearSearch}>
              <X size={14} />
            </button>
          ) : null}
          <kbd className="type-badge">Ctrl+K</kbd>
        </label>
        <div className="filter-anchor" ref={filterRef}>
          <button
            className={filters.length ? "tool-button filter-active" : "tool-button"}
            type="button"
            aria-expanded={filterOpen}
            onClick={onToggleFilter}
          >
            <Filter size={16} aria-hidden="true" />
            Filter
          </button>
          {filterOpen ? (
            <div className="filter-pop" role="dialog" aria-label="Filter by column">
              <select value={draftFieldId} aria-label="Filter column" onChange={(event) => onDraftField(event.target.value)}>
                <option value="">Choose a column</option>
                {fields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={draftValue}
                placeholder="Contains…"
                aria-label="Filter value"
                onChange={(event) => onDraftValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onAddFilter();
                  }
                }}
              />
              <button className="primary-button" type="button" onClick={onAddFilter} disabled={!draftFieldId || !draftValue.trim()}>
                Add filter
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
      {filters.length ? (
        <div className="filter-chips">
          {filters.map((filter) => {
            const field = fields.find((entry) => String(entry.id) === String(filter.fieldId));
            return (
              <button key={filter.id} className="filter-chip" type="button" onClick={() => onRemoveFilter(filter.id)}>
                <span>{field?.name || "Column"}: {filter.value}</span>
                <X size={12} aria-hidden="true" />
                <span className="sr-only">Remove filter</span>
              </button>
            );
          })}
          <button className="filter-chip is-clear" type="button" onClick={onClearFilters}>
            Clear filters
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default GridToolbar;
