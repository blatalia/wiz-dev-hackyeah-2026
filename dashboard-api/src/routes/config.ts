import { Router } from "express";
import { DynamoConfigStore, type ConfigChange, type ConfigStore, type GatewayConfig } from "../configStore";

const store: ConfigStore = new DynamoConfigStore();
const CONFIG_ID = process.env.CONFIG_ID || "default";
const MAX_CHANGES = 100;

export const configRouter = Router();

function validate(changes: unknown, current: GatewayConfig): string | null {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > MAX_CHANGES) {
    return `'changes' must be a list of 1 to ${MAX_CHANGES} items`;
  }
  const seen = new Set<string>();
  for (const c of changes) {
    if (typeof c?.group !== "string" || typeof c?.key !== "string" || c.key === "") {
      return "Each change needs a 'group' and a 'key'";
    }
    const name = c.group ? `${c.group}.${c.key}` : c.key;
    if (seen.has(name)) return `'${name}' is listed twice`;
    seen.add(name);

    const existing = current.groups.find((g) => g.key === c.group)?.settings.find((s) => s.key === c.key);
    if (!existing) return `Unknown setting '${name}'`;
    if (typeof c.value !== typeof existing.value) {
      return `'${name}' must be ${typeof existing.value === "boolean" ? "true or false" : "a number"}`;
    }
    if (typeof c.value === "number") {
      if (!Number.isFinite(c.value) || c.value < 0) return `'${name}' must be zero or a positive number`;
      if (Number.isInteger(existing.value) && !Number.isInteger(c.value)) return `'${name}' must be a whole number`;
    }
  }
  return null;
}

configRouter.get("/", async (_req, res) => {
  const config = await store.getConfig(CONFIG_ID);
  if (!config) {
    res.status(404).json({ error: `Config '${CONFIG_ID}' not found` });
    return;
  }
  res.json(config);
});

configRouter.patch("/", async (req, res) => {
  const current = await store.getConfig(CONFIG_ID);
  if (!current) {
    res.status(404).json({ error: `Config '${CONFIG_ID}' not found` });
    return;
  }

  const changes = req.body?.changes;
  const problem = validate(changes, current);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }

  const updated = await store.applyChanges(CONFIG_ID, changes as ConfigChange[]);
  if (!updated) {
    res.status(409).json({ error: "Config changed while saving, reload and try again" });
    return;
  }

  console.log(`[config] ${req.user?.email} changed '${CONFIG_ID}': ${JSON.stringify(changes)}`);
  res.json(updated);
});
