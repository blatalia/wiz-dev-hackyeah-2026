import { useState, type FormEvent } from "react";
import { CircleAlert, LoaderCircle, ShieldCheck } from "lucide-react";
import { login, type User } from "../api";

export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await login(email, password));
    } catch (err) {
      setError(err instanceof TypeError ? "Cannot reach the API" : (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-grid" aria-hidden="true" />
      <div className="orb a" aria-hidden="true" />
      <div className="orb b" aria-hidden="true" />

      <form className="card login" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark"><ShieldCheck size={20} /></span>
          <div>
            <div className="brand-name">AI Gateway</div>
            <div className="brand-sub">Security console</div>
          </div>
        </div>
        <div>
          <h1>Welcome back</h1>
          <p className="muted">Sign in with your administrator account.</p>
        </div>
        <label className="field">
          Email
          <input className="input" type="email" autoComplete="username" required autoFocus
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          Password
          <input className="input" type="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <p className="form-error" role="alert"><CircleAlert size={16} />{error}</p>
        )}
        <button className="btn primary" disabled={busy}>
          {busy && <LoaderCircle className="spinner" size={16} />}
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
