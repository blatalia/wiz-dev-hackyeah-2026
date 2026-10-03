import jwt from "jsonwebtoken";
import type { CookieOptions } from "express";

export const ACCESS_TTL_SEC = 15 * 60;
export const REFRESH_TTL_SEC = 7 * 24 * 60 * 60;

export type AccessPayload = { sub: string; email: string; roles: string[] };

export function signAccessToken(p: AccessPayload) {
  return jwt.sign(p, process.env.JWT_ACCESS_SECRET!, { expiresIn: ACCESS_TTL_SEC });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as AccessPayload;
}

export function signRefreshToken(tokenId: string, userId: string) {
  return jwt.sign({ sub: userId, jti: tokenId }, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: REFRESH_TTL_SEC,
  });
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as { sub: string; jti: string };
}

const isProd = process.env.NODE_ENV === "production";

export const accessCookie: CookieOptions = {
  httpOnly: true, secure: isProd, sameSite: "strict", path: "/",
  maxAge: ACCESS_TTL_SEC * 1000,
};

export const refreshCookie: CookieOptions = {
  httpOnly: true, secure: isProd, sameSite: "strict", path: "/auth",
  maxAge: REFRESH_TTL_SEC * 1000,
};
