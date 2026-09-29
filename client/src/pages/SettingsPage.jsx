import { useAuth } from "../auth/AuthProvider";
import "../components/grid/grid.css";
import "../components/layout/shell.css";

function SettingsPage() {
  const { session } = useAuth();
  const user = session?.user;
  return (
    <div className="page-frame">
      <div className="page-heading">
        <div>
          <h1>Settings</h1>
          <p>The account signed in to this workspace.</p>
        </div>
      </div>
      <section className="settings-card">
        <div className="settings-grid">
          <div>
            <span>Name</span>
            <strong>{user?.name || "Signed in"}</strong>
          </div>
          <div>
            <span>Email</span>
            <strong>{user?.email || "—"}</strong>
          </div>
          <div>
            <span>Role</span>
            <strong>{user?.roleTitle || "User"}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}

export default SettingsPage;
