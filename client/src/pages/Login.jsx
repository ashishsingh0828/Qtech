import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { AlertCircle, ArrowRight, Database, Lock, Mail } from "lucide-react";
import "./Login.css";

function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@qtech.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const { data } = await axios.post("http://localhost:5000/api/auth/login", {
        email,
        password,
      });

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      navigate("/dashboard");
    } catch (err) {
      const message =
        err.response?.data?.error ||
        err.response?.data?.message ||
        "Unable to sign in. Check your connection and try again.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="login-brand">
          <div className="brand-mark" aria-hidden="true">
            <Database size={28} strokeWidth={1.75} />
          </div>
          <p className="brand-kicker">QTech</p>
          <h1>QTech Data Management</h1>
          <p className="brand-copy">
            A secure workspace for datasets, files, and the people who keep them accurate.
          </p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="form-heading">
            <h2>Sign in</h2>
            <p>Use your QTech account to continue.</p>
          </div>

          {error ? (
            <div className="error-banner" role="alert">
              <AlertCircle size={18} strokeWidth={2} aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <label className="field">
            <span>Email</span>
            <div className="field-control">
              <Mail size={18} strokeWidth={1.75} aria-hidden="true" />
              <input
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
          </label>

          <label className="field">
            <span>Password</span>
            <div className="field-control">
              <Lock size={18} strokeWidth={1.75} aria-hidden="true" />
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
          </label>

          <button className="submit-button" type="submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
            <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </form>
      </section>
    </main>
  );
}

export default Login;
