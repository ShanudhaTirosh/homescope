import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { timingSafeEqual } from "node:crypto";

const host = process.env.RELAY_HOST || "127.0.0.1";
const port = Number(process.env.RELAY_PORT || 4320);
const upstream = (process.env.HOME_COLLECTOR_URL || "http://127.0.0.1:4319").replace(/\/+$/, "");
const token = process.env.HOME_COLLECTOR_TOKEN || "";
const cachePath = process.env.RELAY_CACHE_PATH || "/var/lib/homescope-relay/snapshot.json";
const refreshInterval = Number(process.env.RELAY_REFRESH_MS || 2500);

let cachedSnapshot = "";
let cachedAt = 0;
let refreshing = null;
let lastError = "";

if (existsSync(cachePath)) {
  try {
    cachedSnapshot = readFileSync(cachePath, "utf8");
    cachedAt = JSON.parse(cachedSnapshot).generatedAt || Date.now();
  } catch {
    cachedSnapshot = "";
  }
}

function authorized(request) {
  if (!token) return false;
  const supplied = Buffer.from(request.headers.authorization || "");
  const expected = Buffer.from(`Bearer ${token}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    ...headers,
  });
  response.end(body);
}

function persistSnapshot(snapshot) {
  const body = JSON.stringify(snapshot);
  cachedSnapshot = body;
  cachedAt = Date.now();
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(`${cachePath}.next`, body, { mode: 0o600 });
  renameSync(`${cachePath}.next`, cachePath);
}

function needsName(label = "") {
  const value = String(label).toLowerCase();
  return value.includes("unknown") || value.includes("private") || value.startsWith("device ");
}

function patchCachedDevice(pathname, requestBody) {
  if (!cachedSnapshot || !pathname.startsWith("/api/devices/") || !requestBody) return;
  try {
    const mac = decodeURIComponent(pathname.slice("/api/devices/".length));
    const changes = JSON.parse(requestBody.toString("utf8"));
    const snapshot = JSON.parse(cachedSnapshot);
    const device = snapshot.devices?.find((entry) => entry.mac === mac);
    if (!device) return;

    const wasUnnamed = needsName(device.label);
    for (const key of ["label", "owner", "kind", "group_name", "ap_id", "trusted"]) {
      if (Object.hasOwn(changes, key)) device[key] = changes[key];
    }
    if (Object.hasOwn(changes, "label")) device.displayName = changes.label || device.hostname || device.ip;
    if (Object.hasOwn(changes, "ap_id")) {
      const router = snapshot.routers?.find((entry) => entry.id === changes.ap_id);
      device.apName = router?.name || "";
      device.association_type = changes.ap_id ? "Manual" : "";
      device.association_source = changes.ap_id ? "Manual assignment" : "";
      device.association_band = "";
      device.association_signal = "";
      device.association_seen_at = Date.now();
      device.associationSeenText = "Just now";
    }
    const isUnnamed = needsName(device.label);
    if (snapshot.summary && wasUnnamed !== isUnnamed) {
      snapshot.summary.unrecognized = Math.max(
        0,
        Number(snapshot.summary.unrecognized || 0) + (isUnnamed ? 1 : -1),
      );
    }
    snapshot.generatedAt = Date.now();
    persistSnapshot(snapshot);
  } catch {
    // The collector remains the source of truth; its next refresh repairs the cache.
  }
}

async function refreshSnapshot() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const response = await fetch(`${upstream}/api/snapshot`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`collector returned ${response.status}`);
      const body = await response.text();
      const parsed = JSON.parse(body);
      if (!parsed?.generatedAt || !Array.isArray(parsed.devices)) throw new Error("invalid snapshot");
      lastError = "";
      persistSnapshot(parsed);
      return true;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "refresh failed";
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function proxy(request, response, url) {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = { authorization: `Bearer ${token}` };
    if (request.headers["content-type"]) headers["content-type"] = request.headers["content-type"];
    const upstreamResponse = await fetch(`${upstream}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
    if (upstreamResponse.ok && request.method === "PATCH") {
      patchCachedDevice(url.pathname, body);
    }
    response.writeHead(upstreamResponse.status, {
      "content-type": upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    });
    response.end(responseBody);
  } catch {
    send(response, 502, JSON.stringify({ error: "The home collector is currently unreachable." }));
  }
}

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/health") {
    return send(response, 200, JSON.stringify({
      ok: true,
      cached: Boolean(cachedSnapshot),
      cacheAgeMs: cachedAt ? Date.now() - cachedAt : null,
      refreshing: Boolean(refreshing),
      lastError,
    }));
  }
  if (!authorized(request)) return send(response, 401, JSON.stringify({ error: "Unauthorized" }));
  if (request.method === "GET" && url.pathname === "/api/snapshot") {
    if (cachedSnapshot) {
      const age = Math.max(0, Date.now() - cachedAt);
      if (age > refreshInterval) void refreshSnapshot();
      return send(response, 200, cachedSnapshot, {
        "x-homescope-cache": "hit",
        "x-homescope-cache-age": String(age),
      });
    }
    const refreshed = await refreshSnapshot();
    if (refreshed && cachedSnapshot) return send(response, 200, cachedSnapshot, { "x-homescope-cache": "filled" });
    return send(response, 503, JSON.stringify({ error: "Waiting for the first home snapshot." }));
  }
  return proxy(request, response, url);
}).listen(port, host, () => {
  console.log(`HomeScope relay cache listening on http://${host}:${port}`);
  void refreshSnapshot();
  const loop = async () => {
    await refreshSnapshot();
    setTimeout(loop, refreshInterval);
  };
  setTimeout(loop, refreshInterval);
});
