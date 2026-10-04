import { useEffect, useState } from "react";
import { ArrowRight, Check, CircleAlert, CloudOff, LoaderCircle, Minus, Plus, RotateCw, Settings2 } from "lucide-react";
import { getConfig, updateConfig, type ConfigChange, type ConfigGroup, type GatewayConfig, type SettingValue } from "../api";
import { humanize } from "../labels";
import { State, stagger } from "./ui";

const GROUP_SEPARATOR = "::";
const groupTitle = (key: string) => {
  if (key === "") return "General";
  // Nested keys like "mcp_config::bianka@test.com" group a per-user
  // override under a parent group; humanize only the parent segment and
  // keep the email (or other leaf identifier) verbatim so it isn't
  // word-split by humanize()'s "." handling.
  const segments = key.split(GROUP_SEPARATOR);
  const leaf = segments.pop() as string;
  const parent = segments.join(GROUP_SEPARATOR);
  if (parent === "") return humanize(leaf);
  return `${humanize(parent)} · ${leaf}`;
};
const show = (v: SettingValue) => (typeof v === "boolean" ? (v ? "On" : "Off") : v.toLocaleString("en-US"));
const idOf = (group: string, key: string) => `${group}\n${key}`;

function draftOf(config: GatewayConfig) {
  const draft: Record<string, SettingValue> = {};
  for (const g of config.groups) {
    for (const s of g.settings) draft[idOf(g.key, s.key)] = s.value;
  }
  return draft;
}

function toColumns(groups: ConfigGroup[]): ConfigGroup[][] {
  const columns: { height: number; groups: ConfigGroup[] }[] = [{ height: 0, groups: [] }, { height: 0, groups: [] }];
  for (const g of [...groups].sort((a, b) => b.settings.length - a.settings.length)) {
    const shorter = columns[0].height <= columns[1].height ? columns[0] : columns[1];
    shorter.groups.push(g);
    shorter.height += g.settings.length + 2;
  }
  return columns
    .map((c) => c.groups.sort((a, b) => a.key.localeCompare(b.key)))
    .filter((c) => c.length > 0)
    .sort((a, b) => a[0].key.localeCompare(b[0].key));
}

function stepFor(value: number) {
  return value < 100 ? 1 : 10 ** (Math.floor(Math.log10(value)) - 1);
}

function NumberField({ label, value, disabled, onChange }: {
  label: string; value: number; disabled: boolean; onChange: (value: number) => void;
}) {
  const step = stepFor(value);
  return (
    <span className="stepper">
      <button type="button" className="btn small icon" aria-label={`Decrease ${label}`}
        disabled={disabled || value <= 0} onClick={() => onChange(Math.max(value - step, 0))}>
        <Minus size={14} />
      </button>
      <input
        className="input" type="number" min={0} step={1} inputMode="numeric" aria-label={label}
        value={value} disabled={disabled}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (e.target.value !== "" && Number.isInteger(next) && next >= 0) onChange(next);
        }}
      />
      <button type="button" className="btn small icon" aria-label={`Increase ${label}`}
        disabled={disabled} onClick={() => onChange(value + step)}>
        <Plus size={14} />
      </button>
    </span>
  );
}

function Group({ group, index, draft, saved, saving, setValue }: {
  group: ConfigGroup;
  index: number;
  draft: Record<string, SettingValue>;
  saved: Record<string, SettingValue>;
  saving: boolean;
  setValue: (patch: Record<string, SettingValue>) => void;
}) {
  const settings = group.settings
    .map((s) => ({ ...s, id: idOf(group.key, s.key), label: humanize(s.key) }))
    .sort((a, b) =>
      Number(typeof a.value === "boolean") - Number(typeof b.value === "boolean") || a.label.localeCompare(b.label));
  const switches = settings.filter((s) => typeof s.value === "boolean");
  const on = switches.filter((s) => draft[s.id] === true).length;
  const setAll = (value: boolean) => setValue(Object.fromEntries(switches.map((s) => [s.id, value])));

  return (
    <section className="card table-card rise" style={stagger(index)}>
      <div className="card-head group-head">
        <div>
          <h2>{groupTitle(group.key)}</h2>
          <p className="card-sub">
            {group.key && <span className="mono">{group.key}</span>}
            {group.key && switches.length > 0 && " · "}
            {switches.length > 0 && `${on} of ${switches.length} on`}
          </p>
        </div>
        {switches.length > 1 && (
          <div className="group-actions">
            <button className="btn small ghost" disabled={saving || on === switches.length} onClick={() => setAll(true)}>All on</button>
            <button className="btn small ghost" disabled={saving || on === 0} onClick={() => setAll(false)}>All off</button>
          </div>
        )}
      </div>

      <ul className="flags">
        {settings.map((s) => {
          const value = draft[s.id];
          const changed = value !== saved[s.id];
          return (
            <li key={s.id}>
              <label className={value === true ? "flag on" : "flag"}>
                <span className="flag-text">
                  <div className="flag-name">
                    {changed && <span className="changed-dot" title="Unsaved change" />}
                    {s.label}
                  </div>
                  <div className="flag-key mono">{s.key}</div>
                </span>
                {typeof value === "boolean" ? (
                  <>
                    <span className="flag-state">{show(value)}</span>
                    <input className="switch" type="checkbox" role="switch" checked={value} disabled={saving}
                      onChange={(e) => setValue({ [s.id]: e.target.checked })} />
                  </>
                ) : (
                  <NumberField label={s.label} value={value} disabled={saving}
                    onChange={(next) => setValue({ [s.id]: next })} />
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function Config() {
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [draft, setDraft] = useState<Record<string, SettingValue>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState(false);

  function load() {
    setError(null);
    getConfig().then(
      (c) => { setConfig(c); setDraft(draftOf(c)); },
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
      <State Icon={CloudOff} tone="error" title="The gateway configuration could not be loaded"
        action={<button className="btn" onClick={load}><RotateCw size={15} />Try again</button>}>
        {error}. The configuration lives in the gateway's DynamoDB table, so the API needs the AWS region and
        credentials in its environment.
      </State>
    ) : <div className="config-grid"><div className="skeleton" style={{ height: 460 }} /><div className="skeleton" style={{ height: 460 }} /></div>;
  }

  const saved = draftOf(config);
  const changes: (ConfigChange & { label: string; from: SettingValue })[] = config.groups.flatMap((g) =>
    g.settings
      .filter((s) => draft[idOf(g.key, s.key)] !== s.value)
      .map((s) => ({
        group: g.key, key: s.key, value: draft[idOf(g.key, s.key)], from: s.value,
        label: `${groupTitle(g.key)} · ${humanize(s.key)}`,
      })));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateConfig(changes.map(({ group, key, value }) => ({ group, key, value })));
      setConfig(updated);
      setDraft(draftOf(updated));
      setToast(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  }

  return (
    <div className="stack">
      <div className="config-bar rise">
        <span className="muted">
          <Settings2 size={15} /> Config <span className="tag mono">{config.configId}</span>
          Saved changes apply to all gateway traffic.
        </span>
        <button className="btn small" onClick={load} disabled={saving}><RotateCw size={14} />Reload</button>
      </div>

      {config.groups.length === 0 ? (
        <State Icon={Settings2} title="This config has no settings yet">
          The gateway's config item contains no on/off or numeric values.
        </State>
      ) : (
        <div className="config-grid">
          {toColumns(config.groups).map((column, ci) => (
            <div key={column[0].key} className="config-col">
              {column.map((g, i) => (
                <Group key={g.key} group={g} index={ci + i + 1} draft={draft} saved={saved} saving={saving}
                  setValue={(patch) => setDraft({ ...draft, ...patch })} />
              ))}
            </div>
          ))}
        </div>
      )}

      {error && <p className="form-error" role="alert"><CircleAlert size={16} />Could not save: {error}</p>}

      {changes.length > 0 && !confirming && (
        <div className="savebar" role="region" aria-label="Unsaved changes">
          <span>{changes.length} unsaved {changes.length === 1 ? "change" : "changes"}</span>
          <button className="btn ghost" onClick={() => setDraft(saved)}>Discard</button>
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
              {changes.map((c) => (
                <li key={idOf(c.group, c.key)}>
                  <span>{c.label}</span>
                  <span className="to">
                    {show(c.from)}
                    <span className="arrow"><ArrowRight size={14} /></span>
                    <strong>{show(c.value)}</strong>
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
