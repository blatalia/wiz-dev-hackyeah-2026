import { useEffect, useState } from "react";
import {
  ArrowRight, Building2, Check, CircleAlert, CloudOff, Database, Landmark, LoaderCircle, Mail, MapPin, RotateCw,
  ToggleRight, User, type LucideIcon,
} from "lucide-react";
import { getConfig, updateConfig, type GatewayConfig } from "../api";
import { State, stagger } from "./ui";

// Friendly names for the flags we know about; any other flag is shown by its raw key.
const KNOWN: Record<string, { label: string; Icon: LucideIcon }> = {
  bank_account_num: { label: "Bank account numbers", Icon: Landmark },
  email: { label: "Email addresses", Icon: Mail },
  location: { label: "Locations", Icon: MapPin },
  name_surname: { label: "Names and surnames", Icon: User },
  org_name: { label: "Organisation names", Icon: Building2 },
  sql: { label: "SQL", Icon: Database },
};

const labelOf = (key: string) => KNOWN[key]?.label ?? key;
const onOff = (v: boolean) => (v ? "On" : "Off");

export function Config() {
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState(false);

  function load() {
    setError(null);
    getConfig().then(
      (c) => { setConfig(c); setDraft(c.flags); },
      (e) => setError(e.message),
    );
  }
  useEffect(load, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(false), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!config) {
    return error ? (
      <div className="config">
        <State Icon={CloudOff} tone="error" title="The gateway configuration could not be loaded"
          action={<button className="btn" onClick={load}><RotateCw size={15} />Try again</button>}>
          {error}. The configuration lives in the gateway's DynamoDB table, so the API needs the AWS region and
          credentials in its environment.
        </State>
      </div>
    ) : <div className="skeleton config" style={{ height: 460 }} />;
  }

  const keys = Object.keys(config.flags).sort();
  const changed = keys.filter((k) => draft[k] !== config.flags[k]);
  const enabled = keys.filter((k) => draft[k]).length;

  async function save() {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      // send only what changed, so someone else's edits to other flags are not overwritten
      const updated = await updateConfig(Object.fromEntries(changed.map((k) => [k, draft[k]])));
      setConfig(updated);
      setDraft(updated.flags);
      setToast(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  }

  return (
    <div className="stack config">
      <section className="card table-card rise">
        <div className="card-head" style={{ padding: "20px 20px 0" }}>
          <div>
            <h2>Gateway checks <span className="tag mono">{config.configId}</span></h2>
            <p className="card-sub">
              {enabled} of {keys.length} on. Saved changes apply to all gateway traffic.
            </p>
          </div>
          <button className="btn small" onClick={load} disabled={saving}>
            <RotateCw size={14} />Reload
          </button>
        </div>

        <ul className="flags">
          {keys.map((k, i) => {
            const Icon = KNOWN[k]?.Icon ?? ToggleRight;
            const isChanged = draft[k] !== config.flags[k];
            return (
              <li key={k} className="rise" style={stagger(i + 1)}>
                <label className={draft[k] ? "flag on" : "flag"}>
                  <span className="flag-icon"><Icon size={18} /></span>
                  <span className="flag-text">
                    <div className="flag-name">{labelOf(k)}</div>
                    <div className="flag-key mono">{k}</div>
                  </span>
                  <span className="flag-state">
                    {isChanged && <span className="changed-dot" title="Unsaved change" />}
                    {onOff(draft[k])}
                  </span>
                  <input
                    className="switch" type="checkbox" role="switch" checked={draft[k]} disabled={saving}
                    onChange={(e) => setDraft({ ...draft, [k]: e.target.checked })}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      {error && <p className="form-error" role="alert"><CircleAlert size={16} />Could not save: {error}</p>}

      {changed.length > 0 && !confirming && (
        <div className="savebar" role="region" aria-label="Unsaved changes">
          <span>{changed.length} unsaved {changed.length === 1 ? "change" : "changes"}</span>
          <button className="btn ghost" onClick={() => setDraft(config.flags)}>Discard</button>
          <button className="btn primary" onClick={() => setConfirming(true)}>Review and apply</button>
        </div>
      )}

      {confirming && (
        <div className="modal-wrap">
          <div className="backdrop" onClick={() => !saving && setConfirming(false)} />
          <div className="card modal" role="alertdialog" aria-labelledby="confirm-title">
            <h2 id="confirm-title">Apply these changes to the gateway?</h2>
            <p className="card-sub">They take effect for all traffic as soon as they are saved.</p>
            <ul className="changes">
              {changed.map((k) => (
                <li key={k}>
                  <span>{labelOf(k)}</span>
                  <span className="to">
                    {onOff(config.flags[k])}
                    <span className="arrow"><ArrowRight size={14} /></span>
                    <strong>{onOff(draft[k])}</strong>
                  </span>
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirming(false)} disabled={saving}>Cancel</button>
              <button className="btn primary" onClick={save} disabled={saving}>
                {saving && <LoaderCircle className="spinner" size={15} />}
                {saving ? "Saving…" : "Apply changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <span className="outcome-icon"><Check size={11} strokeWidth={3} /></span>
          Configuration saved
        </div>
      )}
    </div>
  );
}
