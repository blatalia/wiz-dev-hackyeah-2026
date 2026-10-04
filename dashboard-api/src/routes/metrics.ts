import { Router } from "express";
import { DynamoMetricsStore } from "../metricsStore";

const store = new DynamoMetricsStore();
export const metricsRouter = Router();

metricsRouter.get("/", async (_req, res) => {
  const current = await store.getCurrent();
  if (!current) {
    res.status(404).json({ error: "The gateway has not published metrics yet" });
    return;
  }
  res.json(current);
});
