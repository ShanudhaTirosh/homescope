import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  authenticationConfigurationError,
  createSessionToken,
  sessionCookieOptions,
  verifyPassword,
} from "../../../lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const configurationError = authenticationConfigurationError();
  if (configurationError) {
    return NextResponse.json({ error: "HomeScope login has not been configured yet." }, { status: 503 });
  }

  const contentType = request.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await request.json()
    : Object.fromEntries((await request.formData()).entries());
  const email = String(body.email || "");
  const password = String(body.password || "");

  if (!verifyPassword(email, password)) {
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, createSessionToken(email), sessionCookieOptions());
  return response;
}
