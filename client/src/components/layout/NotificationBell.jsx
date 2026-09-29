import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Bell } from "lucide-react";
import { API_BASE, authConfig, relativeTime } from "../../lib/session";

function NotificationBell() {
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const { data } = await axios.get(`${API_BASE}/api/notifications`, authConfig());
        if (!active) return;
        setItems(data.notifications || []);
        setUnread(Number(data.unread) || 0);
      } catch {
        if (!active) return;
      }
    }

    load();
    const timer = window.setInterval(load, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    function onPointer(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  async function openNote(note) {
    setOpen(false);
    if (!note.is_read) {
      try {
        await axios.patch(`${API_BASE}/api/notifications/${note.id}/read`, {}, authConfig());
        setItems((current) => current.map((entry) => (entry.id === note.id ? { ...entry, is_read: true } : entry)));
        setUnread((count) => Math.max(0, count - 1));
      } catch {
        /* The record link still opens if the read flag cannot be saved. */
      }
    }
    if (note.dataset_id) {
      const query = note.record_id ? `?record=${note.record_id}` : "";
      navigate(`/datasets/${note.dataset_id}${query}`);
    }
  }

  async function markAll() {
    try {
      await axios.patch(`${API_BASE}/api/notifications/read-all`, {}, authConfig());
      setItems((current) => current.map((entry) => ({ ...entry, is_read: true })));
      setUnread(0);
    } catch {
      /* Keep the list visible if the bulk update fails. */
    }
  }

  const badge = unread > 99 ? "99+" : String(unread);

  return (
    <div className="notify-root" ref={rootRef}>
      <button
        className="notify-button"
        type="button"
        aria-label={unread ? `${unread} unread notifications` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={18} aria-hidden="true" />
        {unread > 0 ? <span className="notify-badge">{badge}</span> : null}
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
          {items.length === 0 ? <p className="notify-empty">No recent events.</p> : null}
          <ul className="notify-list">
            {items.map((note) => (
              <li key={note.id}>
                <button
                  className={note.is_read ? "notify-item" : "notify-item is-unread"}
                  type="button"
                  onClick={() => openNote(note)}
                >
                  <span>{note.message}</span>
                  <time>{relativeTime(note.created_at)}</time>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default NotificationBell;
