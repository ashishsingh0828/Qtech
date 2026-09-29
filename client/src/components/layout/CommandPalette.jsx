import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { useAuth } from "../../auth/AuthProvider";
import { API_BASE, authConfig, errorMessage } from "../../lib/session";
import { currentSheet, subscribeSheet } from "../../lib/sheetBridge";

function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState(currentSheet);
  const [active, setActive] = useState(0);
  const [seenOpen, setSeenOpen] = useState(false);
  if (open && !seenOpen) {
    setSeenOpen(true);
    setQuery("");
    setActive(0);
    setLoading(true);
    setError("");
    setSheet(currentSheet());
  }
  if (!open && seenOpen) setSeenOpen(false);

  useEffect(() => subscribeSheet(setSheet), []);

  useEffect(() => {
    if (!open) return undefined;
    const handle = window.setTimeout(() => inputRef.current?.focus(), 20);
    let ignore = false;
    axios
      .get(`${API_BASE}/api/datasets`, authConfig())
      .then(({ data }) => {
        if (!ignore) setDatasets((data.datasets || []).filter((dataset) => !dataset.is_deleted));
      })
      .catch((err) => {
        if (!ignore) setError(errorMessage(err, "Unable to load datasets."));
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
      window.clearTimeout(handle);
    };
  }, [open]);

  const items = useMemo(() => {
    const term = query.trim().toLowerCase();
    const nav = [
      { id: "home", label: "Home", hint: "Dashboard", run: () => navigate("/dashboard") },
      { id: "audit", label: "Audit Trail", hint: "Activity", run: () => navigate("/audit") },
      { id: "settings", label: "Settings", hint: "Workspace", run: () => navigate("/settings") },
    ];
    if (session?.permissions?.canManageUsers) {
      nav.splice(1, 0, { id: "users", label: "Users", hint: "Access", run: () => navigate("/users") });
    }
    const books = datasets.map((dataset) => ({
      id: `dataset-${dataset.id}`,
      label: dataset.name || "Dataset",
      hint: "Open dataset",
      run: () => navigate(`/datasets/${dataset.id}`),
    }));
    const groups = location.pathname.startsWith("/datasets/")
      ? sheet.groups.map((group) => ({
        id: `group-${group.groupKey}`,
        label: group.label,
        hint: "Current sheet",
        run: () => {
          const node = document.querySelector(`[data-group-key="${CSS.escape(group.groupKey)}"]`);
          node?.scrollIntoView({ block: "nearest", inline: "start", behavior: "smooth" });
        },
      }))
      : [];
    return [...nav, ...groups, ...books].filter((item) => {
      if (!term) return true;
      return `${item.label} ${item.hint}`.toLowerCase().includes(term);
    });
  }, [query, datasets, session, sheet, location.pathname, navigate]);

  const safeActive = items.length ? Math.min(active, items.length - 1) : 0;

  if (!open) return null;

  function choose(item) {
    item.run();
    onClose();
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (items.length ? (index + 1) % items.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (items.length ? (index - 1 + items.length) % items.length : 0));
    } else if (event.key === "Enter" && items[safeActive]) {
      event.preventDefault();
      choose(items[safeActive]);
    }
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          placeholder="Jump to a dataset, group, or page"
          aria-label="Command palette"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        {loading ? <div className="palette-skel" /> : null}
        {error ? (
          <p className="palette-error" role="alert">
            {error}
          </p>
        ) : null}
        {!loading && !error && items.length === 0 ? <p className="palette-empty">Nothing matches that search.</p> : null}
        <ul className="palette-list" role="listbox">
          {items.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === safeActive}
                className={index === safeActive ? "palette-item is-active" : "palette-item"}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(item)}
              >
                <span>{item.label}</span>
                <small>{item.hint}</small>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default CommandPalette;
