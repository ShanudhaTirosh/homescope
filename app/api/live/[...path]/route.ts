import { NextResponse } from "next/server";
import { getHomeScopeSession, isCloudAuthenticationRequired } from "../../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function collectorBaseUrl() {
  return (process.env.HOMESCOPE_COLLECTOR_URL || "http://127.0.0.1:4318").replace(/\/+$/, "");
}

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const session = await getHomeScopeSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const token = process.env.HOMESCOPE_COLLECTOR_TOKEN || "";
  if (isCloudAuthenticationRequired() && !token) {
    return NextResponse.json({ error: "The cloud collector has not been linked yet." }, { status: 503 });
  }

  const { path } = await context.params;
  const collectorPath = path[0] === "api" ? path.slice(1) : path;
  const isEventStream = collectorPath.join("/") === "snapshot/stream";
  const incomingUrl = new URL(request.url);
  const target = new URL(`/api/${collectorPath.map(encodeURIComponent).join("/")}${incomingUrl.search}`, `${collectorBaseUrl()}/`);
  const headers = new Headers();
  headers.set("accept", request.headers.get("accept") || "application/json");
  if (request.headers.get("content-type")) headers.set("content-type", request.headers.get("content-type")!);
  if (token) headers.set("authorization", `Bearer ${token}`);

  let upstream: Response;
  try {
    const options: RequestInit = {
      method: request.method,
      headers,
      body: METHODS_WITH_BODY.has(request.method) ? await request.arrayBuffer() : undefined,
      cache: "no-store",
    };
    if (!isEventStream) options.signal = AbortSignal.timeout(8_000);
    upstream = await fetch(target, options);
  } catch {
    return NextResponse.json({ error: "The home collector is currently unreachable." }, { status: 502 });
  }

  const responseHeaders = new Headers();
  for (const name of ["content-type", "content-disposition", "cache-control"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("cache-control", "no-store");
  if (isEventStream) {
    responseHeaders.set("cache-control", "no-cache, no-transform");
    responseHeaders.set("x-accel-buffering", "no");
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export function GET(request: Request, context: RouteContext) {
  return proxy(request, context);
}
export function POST(request: Request, context: RouteContext) {
  return proxy(request, context);
}
export function PATCH(request: Request, context: RouteContext) {
  return proxy(request, context);
}
export function DELETE(request: Request, context: RouteContext) {
  return proxy(request, context);
}
