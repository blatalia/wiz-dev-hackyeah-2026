import { Router } from "express";
import { DynamoConfigStore, type ConfigStore } from "../configStore";

// Конфіг gateway живе тільки в його таблиці DynamoDB в AWS
const store: ConfigStore = new DynamoConfigStore();
const CONFIG_ID = process.env.CONFIG_ID || "default";

export const configRouter = Router();

// GET /config
configRouter.get("/", async (_req, res) => {
  const config = await store.getConfig(CONFIG_ID);
  if (!config) {
    res.status(404).json({ error: `Config '${CONFIG_ID}' not found` });
    return;
  }
  res.json(config);
});

// PATCH /config  { "flags": { "email": false } }
configRouter.patch("/", async (req, res) => {
  const flags = req.body?.flags;
  const entries = flags && typeof flags === "object" && !Array.isArray(flags) ? Object.entries(flags) : [];
  if (entries.length === 0 || entries.some(([, v]) => typeof v !== "boolean")) {
    res.status(400).json({ error: "'flags' must be an object with at least one true/false value" });
    return;
  }

  const current = await store.getConfig(CONFIG_ID);
  if (!current) {
    res.status(404).json({ error: `Config '${CONFIG_ID}' not found` });
    return;
  }
  const unknown = entries.map(([k]) => k).filter((k) => !Object.hasOwn(current.flags, k));
  if (unknown.length > 0) {
    res.status(400).json({ error: `Unknown flags: ${unknown.join(", ")}` });
    return;
  }

  const updated = await store.setFlags(CONFIG_ID, flags);
  if (!updated) {
    res.status(409).json({ error: "Config changed while saving, reload and try again" });
    return;
  }

  console.log(`[config] ${req.user?.email} changed '${CONFIG_ID}': ${JSON.stringify(flags)}`);
  res.json(updated);
});
