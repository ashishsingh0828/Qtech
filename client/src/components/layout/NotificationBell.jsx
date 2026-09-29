import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Bell, Inbox } from "lucide-react";
import { API_BASE, authConfig, errorMessage, initials, relativeTime } from "../../lib/session";

function dayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function NotificationBell() {
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const today = dayKey(new Date().toISOString());
  const unread = items.filter((entry) => !entry.isRead).length;

  useEffect(() => {
    let ignore = false;
    axios
      .get(`${API_BASE}/api/notifications`, authConfig())
      .then(({ data }) => {
        if (ignore) return;
        setItems(data.notifications || []);
        setError("");
      })
      .catch((err) => {
        if (!ignore) setError(errorMessage(err, "Unable to load notifications."));
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [revision]);

  useEffect(() => {
    let source;
    let timer;
    let delay = 1000;
    let closed = false;

    function apply(note) {
      setItems((current) => {
        const next = current.filter((entry) => entry.id !== note.id);
        next.unshift(note);
        return next.slice(0, 40);
      });
    }

    function connect() {
      source = new EventSource(`${API_BASE}/api/notifications/stream`, { withCredentials: true });
      source.onopen = () => {
        delay = 1000;
      };
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.refresh) {
            setRevision((value) => value + 1);
            return;
          }
          if (payload.notification) apply(payload.notification);
        } catch {
          /* Ignore a malformed event and keep the stream. */
        }
      };
      source.onerror = () => {
        source.close();
        if (closed) return;
        timer = window.setTimeout(connect, delay);
        delay = Math.min(15000, delay * 2);
      };
    }

    connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      source?.close();
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    function onPointer(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function openNote(note) {
    setOpen(false);
    if (!note.isRead) {
      try {
        await axios.patch(`${API_BASE}/api/notifications/${note.id}/read`, {}, authConfig());
        setItems((current) => current.map((entry) => (entry.id === note.id ? { ...entry, isRead: true } : entry)));
      } catch {
        /* The row still opens if the read flag cannot be saved. */
      }
    }
    if (note.datasetId) {
      const query = note.rowId ? `?row=${note.rowId}` : "";
      navigate(`/datasets/${note.datasetId}${query}`);
    }
  }

  async function markAll() {
    try {
      await axios.post(`${API_BASE}/api/notifications/read-all`, {}, authConfig());
      setItems((current) => current.map((entry) => ({ ...entry, isRead: true })));
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Unable to mark notifications read."));
    }
  }

  const todayItems = items.filter((note) => dayKey(note.createdAt) === today);
  const earlierItems = items.filter((note) => dayKey(note.createdAt) !== today);
  const badge = unread > 99 ? "99+" : String(unread);

  function renderList(list) {
    return list.map((note) => (
      <li key={note.id}>
        <button
          className={note.isRead ? "notify-item" : "notify-item is-unread"}
          type="button"
          onClick={() => openNote(note)}
        >
          <span className="notify-avatar" aria-hidden="true">{initials(note.actorName || note.customerName)}</span>
          <span className="notify-copy">
            <span>{note.summary}</span>
            <time dateTime={note.createdAt}>{relativeTime(note.createdAt)}</time>
          </span>
        </button>
      </li>
    ));
  }

  return (
    <div className="notify-root" ref={rootRef}>
      <button
        className="notify-button"
        type="button"
        aria-label={unread ? `${unread} unread notifications` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={18} strokeWidth={1.5} aria-hidden="true" />
        {unread > 0 ? (
          <span className="notify-count">
            <span className="notify-dot" aria-hidden="true" />
            {badge}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="notify-pop" role="dialog" aria-label="Recent notifications">
          <div className="notify-head">
            <strong>Notifications</strong>
            {unread > 0 ? (
              <button className="notify-clear" type="button" onClick={markAll}>
                Mark all read
              </button>
            ) : null}
          </div>
          {loading ? <div className="notify-skel" /> : null}
          {error ? (
            <p className="notify-error" role="alert">
              {error}
              <button type="button" onClick={() => setRevision((value) => value + 1)}>Try again</button>
            </p>
          ) : null}
          {!loading && !error && items.length === 0 ? (
            <div className="notify-empty">
              <Inbox size={28} strokeWidth={1.5} aria-hidden="true" />
              <p>No activity yet.</p>
            </div>
          ) : null}
          {todayItems.length ? (
            <section>
              <h3>Today</h3>
              <ul className="notify-list">{renderList(todayItems)}</ul>
            </section>
          ) : null}
          {earlierItems.length ? (
            <section>
              <h3>Earlier</h3>
              <ul className="notify-list">{renderList(earlierItems)}</ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default NotificationBell;
