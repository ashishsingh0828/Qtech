import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import DatasetDetail from "./pages/DatasetDetail";
import { ToastProvider } from "./components/Toast";

function ProtectedRoute({ children }) {
  const token = localStorage.getItem("token");

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return children;
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
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/datasets/:id"
            element={
              <ProtectedRoute>
                <DatasetDetail />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
