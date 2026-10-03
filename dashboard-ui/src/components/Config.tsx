import { useEffect, useState } from "react";
import { getConfig, updateConfig, type GatewayConfig } from "../api";

// Friendly names for the flags we know about; any other flag is shown by its raw key.
const LABELS: Record<string, string> = {
  bank_account_num: "Bank account numbers",
  email: "Email addresses",
  location: "Locations",
  name_surname: "Names and surnames",
  org_name: "Organisation names",
  sql: "SQL",
};

const onOff = (v: boolean) => (v ? "On" : "Off");

export function Config() {
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState(false);

  function load() {
    setError(null);
    getConfig().then(
      (c) => { setConfig(c); setDraft(c.flags); },
      (e) => setError(e.message),
    );
  }
  useEffect(load, []);

  if (!config) {
    return error
      ? <p className="error" role="alert">Could not load the configuration: {error}</p>
      : <p className="muted">Loading…</p>;
  }

  const keys = Object.keys(config.flags).sort();
  const changed = keys.filter((k) => draft[k] !== config.flags[k]);

  async function save() {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      // send only what changed, so someone else's edits to other flags are not overwritten
      const updated = await updateConfig(Object.fromEntries(changed.map((k) => [k, draft[k]])));
      setConfig(updated);
      setDraft(updated.flags);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  }

  return (
    <div className="stack narrow">
      <section className="card">
        <div className="card-head">
          <h2>Gateway configuration <span className="muted mono">{config.configId}</span></h2>
          <button className="btn small" onClick={load} disabled={saving}>Reload</button>
        </div>
        <p className="muted">
          Each switch turns one gateway check on or off. Changes apply to all traffic once saved.
        </p>

        <ul className="flags">
          {keys.map((k) => (
            <li key={k}>
              <label className="flag">
                <input
                  type="checkbox" role="switch" checked={draft[k]} disabled={saving}
                  onChange={(e) => { setDraft({ ...draft, [k]: e.target.checked }); setSaved(false); setConfirming(false); }}
                />
                <span className="flag-name">
                  {LABELS[k] ?? k}
                  {LABELS[k] && <span className="muted mono"> {k}</span>}
                </span>
                <span className="flag-state">
                  {onOff(draft[k])}
                  {draft[k] !== config.flags[k] && <span className="muted"> (was {onOff(config.flags[k]).toLowerCase()})</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>

        {error && <p className="error" role="alert">Could not save: {error}</p>}
        {saved && changed.length === 0 && <p className="muted" role="status">Saved.</p>}

        {changed.length > 0 && !confirming && (
          <div className="actions">
            <button className="btn primary" onClick={() => setConfirming(true)}>
              Review {changed.length} {changed.length === 1 ? "change" : "changes"}
            </button>
            <button className="btn" onClick={() => setDraft(config.flags)}>Discard</button>
          </div>
        )}

        {confirming && (
          <div className="confirm" role="alertdialog" aria-label="Confirm configuration change">
            <strong>Apply these changes to the gateway?</strong>
            <ul>
              {changed.map((k) => (
                <li key={k}>
                  {LABELS[k] ?? k}: {onOff(config.flags[k])} → <strong>{onOff(draft[k])}</strong>
                </li>
              ))}
            </ul>
            <div className="actions">
              <button className="btn primary" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Apply changes"}
              </button>
              <button className="btn" onClick={() => setConfirming(false)} disabled={saving}>Cancel</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
