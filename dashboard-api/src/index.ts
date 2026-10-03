import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { pool } from "./db";
import { authRouter } from "./routes/auth";
import { eventsRouter } from "./routes/events";
import { configRouter } from "./routes/config";
import { requireAuth, requireRole } from "./middleware/requireAuth";

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok", db: "ok" });
});

app.use("/auth", authRouter);
app.use("/events", requireAuth, requireRole("admin"), eventsRouter);
app.use("/config", requireAuth, requireRole("admin"), configRouter);

app.get("/admin/ping", requireAuth, requireRole("admin"), (req, res) => {
  res.json({ message: `Hello, ${req.user?.email}` });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Dashboard API running on http://localhost:${port}`));
