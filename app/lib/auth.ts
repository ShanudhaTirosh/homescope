import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "homescope_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export type HomeScopeSession = {
  email: string;
  expiresAt: number;
};

function configuredEmail() {
  return (process.env.HOMESCOPE_LOGIN_EMAIL || "").trim().toLowerCase();
}

function sessionSecret() {
  return process.env.HOMESCOPE_SESSION_SECRET || "";
}

export function isCloudAuthenticationRequired() {
  return process.env.HOMESCOPE_AUTH_REQUIRED === "true" || process.env.VERCEL === "1";
}

export function authenticationConfigurationError() {
  if (!configuredEmail()) return "HOMESCOPE_LOGIN_EMAIL is missing";
  if (!(process.env.HOMESCOPE_PASSWORD_SCRYPT || "").startsWith("scrypt$")) {
    return "HOMESCOPE_PASSWORD_SCRYPT is missing";
  }
  if (sessionSecret().length < 32) return "HOMESCOPE_SESSION_SECRET must be at least 32 characters";
  return "";
}

function sign(payload: string) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function createSessionToken(email: string) {
  const session: HomeScopeSession = {
    email: email.toLowerCase(),
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  };
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.HOMESCOPE_COOKIE_SECURE === "true" || process.env.VERCEL === "1",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function verifyPassword(email: string, password: string) {
  if (authenticationConfigurationError()) return false;
  const expectedEmail = configuredEmail();
  const normalizedPassword = password.trim();
  if (email.trim().toLowerCase() !== expectedEmail || !normalizedPassword) return false;

  const [, salt, expectedHex] = (process.env.HOMESCOPE_PASSWORD_SCRYPT || "").split("$");
  if (!salt || !expectedHex) return false;

  try {
    const expected = Buffer.from(expectedHex, "hex");
    const actual = scryptSync(normalizedPassword, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function verifySessionToken(token: string | undefined): HomeScopeSession | null {
  if (!token || authenticationConfigurationError()) return null;
  const [payload, suppliedSignature] = token.split(".");
  if (!payload || !suppliedSignature) return null;

  try {
    const expectedSignature = Buffer.from(sign(payload), "utf8");
    const actualSignature = Buffer.from(suppliedSignature, "utf8");
    if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) {
      return null;
    }
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as HomeScopeSession;
    if (session.email !== configuredEmail() || session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export async function getHomeScopeSession() {
  if (!isCloudAuthenticationRequired()) {
    return {
      email: configuredEmail() || "local@homescope",
      expiresAt: Number.MAX_SAFE_INTEGER,
    } satisfies HomeScopeSession;
  }
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
}
