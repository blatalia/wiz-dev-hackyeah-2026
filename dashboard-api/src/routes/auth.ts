import { Router, type Response } from "express";
import bcrypt from "bcryptjs";
import { PostgresAuthStore } from "../authStore";
import {
  signAccessToken, signRefreshToken, verifyRefreshToken,
  accessCookie, refreshCookie, REFRESH_TTL_SEC,
} from "../tokens";
import { requireAuth } from "../middleware/requireAuth";

const store = new PostgresAuthStore();
export const authRouter = Router();

async function issueTokens(res: Response, user: { id: string; email: string }, roles: string[]) {
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SEC * 1000);
  const tokenId = await store.createRefreshToken(user.id, expiresAt);
  res.cookie("access_token", signAccessToken({ sub: user.id, email: user.email, roles }), accessCookie);
  res.cookie("refresh_token", signRefreshToken(tokenId, user.id), refreshCookie);
}

function readRefresh(token: unknown) {
  if (typeof token !== "string") return null;
  try {
    return verifyRefreshToken(token);
  } catch {
    return null;
  }
}

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const user = await store.findUserByEmail(email.toLowerCase().trim());
  const passwordOk = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !passwordOk) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const roles = await store.getUserRoles(user.id);
  if (!roles.includes("admin")) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  await issueTokens(res, user, roles);
  res.json({ user: { id: user.id, email: user.email, roles } });
});

authRouter.post("/refresh", async (req, res) => {
  const payload = readRefresh(req.cookies?.refresh_token);
  const row = payload ? await store.findRefreshToken(payload.jti) : null;
  if (!row || row.revoked || row.expiresAt < new Date()) {
    res.status(401).json({ error: "Session expired, please log in again" });
    return;
  }

  await store.revokeRefreshToken(row.id);

  const user = await store.findUserById(row.userId);
  const roles = user ? await store.getUserRoles(user.id) : [];
  if (!user || !roles.includes("admin")) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  await issueTokens(res, user, roles);
  res.json({ ok: true });
});

authRouter.post("/logout", async (req, res) => {
  const payload = readRefresh(req.cookies?.refresh_token);
  if (payload) await store.revokeRefreshToken(payload.jti);
  res.clearCookie("access_token", { path: "/" });
  res.clearCookie("refresh_token", { path: "/auth" });
  res.status(204).end();
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
