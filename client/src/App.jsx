import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import DatasetDetail from "./pages/DatasetDetail";
import UsersPage from "./pages/UsersPage";
import AuditPage from "./pages/AuditPage";
import SettingsPage from "./pages/SettingsPage";
import AppShell from "./components/layout/AppShell";
import { ToastProvider } from "./components/Toast";
import { AuthProvider, useAuth } from "./auth/AuthProvider";

function ProtectedRoute({ children }) {
  const { ready, session } = useAuth();
  if (!ready) return <main className="login-screen">Loading…</main>;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

function UsersRoute() {
  const { session } = useAuth();
  if (!session?.permissions?.canManageUsers) return <Navigate to="/dashboard" replace />;
  return <UsersPage />;
}

function NotFound() {
  const navigate = useNavigate();
  return (
    <main className="not-found">
      <p className="not-found-kicker">404</p>
      <h1>Page Not Found</h1>
      <p>That address is not part of QTech Data Management.</p>
      <button type="button" onClick={() => navigate("/dashboard")}>
        Back to dashboard
      </button>
    </main>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/datasets/:id" element={<DatasetDetail />} />
              <Route path="/users" element={<UsersRoute />} />
              <Route path="/audit" element={<AuditPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
