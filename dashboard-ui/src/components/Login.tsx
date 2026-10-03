import { useState, type FormEvent } from "react";
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
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <h1>AI Gateway Dashboard</h1>
        <p className="muted">Admin sign-in</p>
        <label>
          <span>Email</span>
          <input type="email" autoComplete="username" required autoFocus
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          <span>Password</span>
          <input type="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
