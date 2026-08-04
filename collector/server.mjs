import http from "node:http";
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const execFileAsync = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(process.env.HOMESCOPE_ENV_FILE || join(root, ".env.local"));

const port = Number(process.env.COLLECTOR_PORT || 4318);
const collectorHost = process.env.COLLECTOR_HOST || "127.0.0.1";
const collectorApiToken = process.env.COLLECTOR_API_TOKEN || "";
const subnet = process.env.NETWORK_SUBNET || "192.168.1";
const intervalMs = Math.max(5, Number(process.env.SCAN_INTERVAL_SECONDS || 30)) * 1000;
const associationIntervalMs = Math.max(5, Number(process.env.ASSOCIATION_INTERVAL_SECONDS || 5)) * 1000;
const sltAssociationIntervalMs = Math.max(30, Number(process.env.SLT_ASSOCIATION_INTERVAL_SECONDS || 30)) * 1000;
const scanEnabled = process.env.SCAN_ENABLED !== "false";
const dataDir = process.env.HOMESCOPE_DATA_DIR || join(root, "data");
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, "homescope.sqlite"));

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS devices (
    mac TEXT PRIMARY KEY,
    ip TEXT,
    hostname TEXT,
    label TEXT,
    owner TEXT DEFAULT '',
    kind TEXT DEFAULT 'Unknown',
    group_name TEXT DEFAULT 'Home',
    vendor TEXT DEFAULT '',
    ap_id TEXT DEFAULT '',
    association_type TEXT DEFAULT '',
    association_band TEXT DEFAULT '',
    association_signal TEXT DEFAULT '',
    association_source TEXT DEFAULT '',
    association_seen_at INTEGER DEFAULT 0,
    identity_source TEXT DEFAULT '',
    identity_confidence TEXT DEFAULT '',
    manual_identity INTEGER DEFAULT 0,
    trusted INTEGER DEFAULT 1,
    status TEXT DEFAULT 'offline',
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    last_changed INTEGER NOT NULL,
    source TEXT DEFAULT 'LAN scan'
  );
  CREATE TABLE IF NOT EXISTS routers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    ip TEXT NOT NULL,
    admin_url TEXT NOT NULL,
    model TEXT DEFAULT '',
    status TEXT DEFAULT 'unknown',
    latency_ms REAL,
    last_checked INTEGER,
    clients INTEGER DEFAULT 0,
    note TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mac TEXT NOT NULL,
    ip TEXT,
    seen_at INTEGER NOT NULL,
    status TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    acknowledged INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sampled_at INTEGER NOT NULL,
    online_count INTEGER NOT NULL,
    router_count INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS dns_events (
    event_key TEXT PRIMARY KEY,
    seen_at INTEGER NOT NULL,
    client TEXT DEFAULT '',
    domain TEXT NOT NULL,
    status TEXT DEFAULT 'allowed',
    source TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS traffic_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sampled_at INTEGER NOT NULL,
    host TEXT NOT NULL,
    mac TEXT DEFAULT '',
    name TEXT DEFAULT '',
    bytes_sent INTEGER DEFAULT 0,
    bytes_received INTEGER DEFAULT 0,
    throughput_bps REAL DEFAULT 0,
    source TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS private_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS device_controls (
    mac TEXT PRIMARY KEY,
    desired_state TEXT NOT NULL DEFAULT 'allowed',
    actual_state TEXT NOT NULL DEFAULT 'allowed',
    router_id TEXT DEFAULT '',
    detail TEXT DEFAULT '',
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_observations_seen ON observations(seen_at);
  CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
  CREATE INDEX IF NOT EXISTS idx_samples_at ON samples(sampled_at);
  CREATE INDEX IF NOT EXISTS idx_dns_seen ON dns_events(seen_at);
  CREATE INDEX IF NOT EXISTS idx_dns_domain ON dns_events(domain);
  CREATE INDEX IF NOT EXISTS idx_traffic_sampled ON traffic_samples(sampled_at);
`);

const trafficColumns = db.prepare("PRAGMA table_info(traffic_samples)").all();
if (!trafficColumns.some((column) => column.name === "mac")) {
  db.exec("ALTER TABLE traffic_samples ADD COLUMN mac TEXT DEFAULT ''");
}
db.exec("CREATE INDEX IF NOT EXISTS idx_traffic_host_sampled ON traffic_samples(host,sampled_at)");

const deviceColumns = db.prepare("PRAGMA table_info(devices)").all();
for (const [name, definition] of [
  ["association_type", "TEXT DEFAULT ''"],
  ["association_band", "TEXT DEFAULT ''"],
  ["association_signal", "TEXT DEFAULT ''"],
  ["association_source", "TEXT DEFAULT ''"],
  ["association_seen_at", "INTEGER DEFAULT 0"],
  ["identity_source", "TEXT DEFAULT ''"],
  ["identity_confidence", "TEXT DEFAULT ''"],
  ["manual_identity", "INTEGER DEFAULT 0"],
]) {
  if (!deviceColumns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE devices ADD COLUMN ${name} ${definition}`);
  }
}

const routers = [
  ["slt", "SLT Fiber", "Main router", "192.168.1.1", "http://192.168.1.1", "FD602GW-DX-R410", "Keeps its original 192.168.1.1 address"],
  ["zlt", "ZLT", "Access point 1", "192.168.1.2", "https://192.168.1.2", "ZLT", "LAN access point"],
  ["dlink", "D-Link", "Access point 2", "192.168.1.3", "http://192.168.1.3", "DIR-853 AC1300", "DHCP off · LAN-to-LAN"],
  ["tplink", "TP-Link", "Access point 3", "192.168.1.4", "http://192.168.1.4", "150Mbps Wireless N ADSL2+ Modem Router", "DHCP off · replaced experimental F670L"],
];
const topologyLinks = [
  { id: "slt", next: "zlt", connection: "Ethernet" },
  { id: "zlt", next: "dlink", connection: "Ethernet" },
  { id: "dlink", next: "tplink", connection: "Ethernet" },
];

const routerUpsert = db.prepare(`
  INSERT INTO routers (id,name,role,ip,admin_url,model,status,last_checked,note)
  VALUES (?,?,?,?,?,?,'unknown',0,?)
  ON CONFLICT(id) DO UPDATE SET name=excluded.name,role=excluded.role,ip=excluded.ip,
    admin_url=excluded.admin_url,model=excluded.model,note=excluded.note
`);
for (const router of routers) routerUpsert.run(...router);

const associationTelemetry = new Map(
  routers.map(([id]) => [id, {
    status: "pending",
    available: false,
    clients: 0,
    checkedAt: 0,
    detail: "Waiting for the first client-table check",
  }]),
);

function syncLatestTrafficAddresses() {
  const latestRows = db.prepare(`
    SELECT traffic_samples.mac,traffic_samples.host,traffic_samples.name
    FROM traffic_samples
    JOIN (
      SELECT mac,MAX(sampled_at) AS sampled_at
      FROM traffic_samples
      WHERE mac<>''
      GROUP BY mac
    ) latest ON latest.mac=traffic_samples.mac AND latest.sampled_at=traffic_samples.sampled_at
  `).all();
  const getDevice = db.prepare("SELECT ip,hostname FROM devices WHERE mac=?");
  const updateAddress = db.prepare("UPDATE devices SET ip=?,hostname=? WHERE mac=?");
  const ipv4Text = /^\d{1,3}(?:\.\d{1,3}){3}$/;
  for (const row of latestRows) {
    const device = getDevice.get(row.mac);
    if (!device) continue;
    const genericHostname = !device.hostname || device.hostname === device.ip || ipv4Text.test(device.hostname);
    const reportedName = row.name && !ipv4Text.test(row.name) ? row.name : row.host;
    updateAddress.run(row.host, genericHostname ? reportedName : device.hostname, row.mac);
  }
}
syncLatestTrafficAddresses();

const cachedSample = db.prepare("SELECT sampled_at FROM samples ORDER BY sampled_at DESC LIMIT 1").get();
let scanState = {
  running: false,
  lastStarted: cachedSample?.sampled_at || 0,
  lastCompleted: cachedSample?.sampled_at || 0,
  error: "",
  source: cachedSample ? "Saved snapshot · refreshing" : "Ready",
};

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function ping(ip) {
  const started = performance.now();
  try {
    const args = process.platform === "darwin"
      ? ["-c", "1", "-W", "280", ip]
      : ["-c", "1", "-W", "1", ip];
    await execFileAsync("ping", args, { timeout: 1400 });
    return { ip, ok: true, latency: Math.max(1, Math.round(performance.now() - started)) };
  } catch {
    return { ip, ok: false, latency: null };
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function fpingSubnet() {
  let stdout = "";
  const args = ["-a", "-q", "-g", `${subnet}.1`, `${subnet}.254`, "-t", "200", "-r", "0"];
  try {
    ({ stdout } = await execFileAsync("/usr/bin/fping", args, { timeout: 6000 }));
  } catch (error) {
    // fping returns a non-zero status when any target is unreachable while
    // still returning the reachable addresses on stdout.
    stdout = error?.stdout || "";
  }
  return stdout.split(/\r?\n/)
    .map((ip) => ip.trim())
    .filter(Boolean)
    .map((ip) => ({ ip, ok: true, latency: 1 }));
}

async function arpTable() {
  try {
    const { stdout } = await execFileAsync("arp", ["-an"], { timeout: 4000 });
    const entries = [];
    for (const line of stdout.split("\n")) {
      const match = line.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-f]{1,2}(?::[0-9a-f]{1,2}){5})/i);
      if (!match) continue;
      const mac = match[2].toLowerCase().split(":").map((part) => part.padStart(2, "0")).join(":");
      if (["ff:ff:ff:ff:ff:ff", "00:00:00:00:00:00", "02:00:00:00:00:00"].includes(mac)) continue;
      entries.push({ ip: match[1], mac });
    }
    return entries;
  } catch {
    return [];
  }
}

async function localLanEntries() {
  const entries = [];
  const localIps = new Set();
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.internal || (address.family !== "IPv4" && address.family !== 4)) continue;
      if (!address.address.startsWith(`${subnet}.`)) continue;
      localIps.add(address.address);
      const mac = String(address.mac || "").toLowerCase();
      if (!/^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/.test(mac) || ["00:00:00:00:00:00", "02:00:00:00:00:00"].includes(mac)) continue;
      entries.push({ ip: address.address, mac });
    }
  }
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("ifconfig", [], { timeout: 2000 });
      for (const block of stdout.split(/\\n(?=\\S)/)) {
        const ip = block.match(/\sinet\s+(\d+\.\d+\.\d+\.\d+)/)?.[1] || "";
        const mac = block.match(/\sether\s+([0-9a-f:]{17})/i)?.[1]?.toLowerCase() || "";
        if (ip.startsWith(`${subnet}.`) && /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/.test(mac)) {
          entries.push({ ip, mac });
        }
      }
    } catch {
      // The router and AP client tables can still identify every other device.
    }
  }
  const knownMac = db.prepare(`
    SELECT mac FROM devices
    WHERE lower(identity_source) LIKE 'this mac%'
      AND mac NOT LIKE 'history:%'
    ORDER BY last_seen DESC
    LIMIT 1
  `).get()?.mac;
  if (knownMac) {
    for (const ip of localIps) {
      if (!entries.some((entry) => entry.ip === ip)) entries.push({ ip, mac: knownMac });
    }
  }
  return entries;
}

function securityChecksum(input) {
  let checksum = 0;
  let index = 0;
  while (index < input.length) {
    if (index + 4 > input.length) {
      if (index < input.length) checksum += input.charCodeAt(index) << 24;
      if (index + 1 < input.length) checksum += input.charCodeAt(index + 1) << 16;
      if (index + 2 < input.length) checksum += input.charCodeAt(index + 2) << 8;
      break;
    }
    checksum += (input.charCodeAt(index) << 24)
      + (input.charCodeAt(index + 1) << 16)
      + (input.charCodeAt(index + 2) << 8)
      + input.charCodeAt(index + 3);
    index += 4;
  }
  checksum = (checksum & 0xffff) + (checksum >> 16);
  checksum &= 0xffff;
  return (~checksum) & 0xffff;
}

async function sltArpTable() {
  const baseUrl = process.env.SLT_URL;
  const username = process.env.SLT_USER;
  const password = process.env.SLT_PASS;
  if (!baseUrl || !username || !password) return [];

  const getTable = async () => {
    const response = await fetch(`${baseUrl}/arptable.asp`, {
      signal: AbortSignal.timeout(3500),
      headers: { "Cache-Control": "no-cache", "Connection": "close", "User-Agent": "Mozilla/5.0 HomeScope" },
    });
    return response.text();
  };

  try {
    await authenticateSlt();
    let html = await getTable();
    if (!html.includes("<title>ARP Table</title>")) {
      sltSession.authenticatedAt = 0;
      await authenticateSlt(true);
      await new Promise((resolve) => setTimeout(resolve, 250));
      html = await getTable();
    }
    if (!html.includes("<title>ARP Table</title>")) return [];
    const entries = [];
    const pattern = /<tr><td>\s*(\d+\.\d+\.\d+\.\d+)\s*<\/td><td>\s*([0-9a-f-]{17})\s*<\/td>/gi;
    for (const match of html.matchAll(pattern)) {
      if (!match[1].startsWith(`${subnet}.`)) continue;
      const mac = match[2].replaceAll("-", ":").toLowerCase();
      if (["ff:ff:ff:ff:ff:ff", "00:00:00:00:00:00", "02:00:00:00:00:00"].includes(mac)) continue;
      entries.push({ ip: match[1], mac });
    }
    return entries;
  } catch {
    return [];
  }
}

const sltSession = {
  authenticatedAt: 0,
  loginPending: null,
};

function routerFetchError(error, routerName) {
  const code = error?.cause?.code || error?.code || "";
  if (code === "ECONNREFUSED") return `${routerName} web service refused the connection`;
  if (code === "ETIMEDOUT" || error?.name === "TimeoutError") return `${routerName} web service timed out`;
  return error?.message || `${routerName} client table unavailable`;
}

async function authenticateSlt(force = false) {
  const baseUrl = process.env.SLT_URL;
  const username = process.env.SLT_USER;
  const password = process.env.SLT_PASS;
  if (!baseUrl || !username || !password) throw new Error("SLT client-table login is not configured");
  if (!force && Date.now() - sltSession.authenticatedAt < 10 * 60 * 1000) return;
  if (sltSession.loginPending) return sltSession.loginPending;

  sltSession.loginPending = (async () => {
    const encodedUser = encodeURIComponent(username);
    const encodedPass = encodeURIComponent(password);
    const checksumInput = `challenge=&username=${encodedUser}&password=${encodedPass}&save=Stop&submit-url=%2Fadmin%2Flogin.asp&`;
    const body = `${checksumInput}postSecurityFlag=${securityChecksum(checksumInput)}`;
    const response = await fetch(new URL("/boaform/admin/formLogin", baseUrl), {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(3500),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Connection": "close",
        "User-Agent": "Mozilla/5.0 HomeScope",
      },
      body,
    });
    if (![200, 301, 302, 303].includes(response.status)) {
      throw new Error(`SLT login returned HTTP ${response.status}`);
    }
    sltSession.authenticatedAt = Date.now();
  })().finally(() => {
    sltSession.loginPending = null;
  });
  return sltSession.loginPending;
}

async function sltWirelessTable(index) {
  const baseUrl = process.env.SLT_URL;
  const redirectUrl = new URL(`/boaform/formWlanRedirect?redirect-url=/wlstatbl.asp&wlan_idx=${index};`, baseUrl);
  const headers = {
    "Cache-Control": "no-cache",
    "Connection": "close",
    "User-Agent": "Mozilla/5.0 HomeScope",
  };
  const redirect = await fetch(redirectUrl, {
    redirect: "manual",
    signal: AbortSignal.timeout(3500),
    headers,
  });
  const location = redirect.headers.get("location");
  if (!location) return redirect.text();
  const response = await fetch(new URL(location, baseUrl), {
    redirect: "manual",
    signal: AbortSignal.timeout(3500),
    headers: { ...headers, "Referer": redirectUrl.href },
  });
  return response.text();
}

function hmacMd5(key, value) {
  return createHmac("md5", key).update(value).digest("hex").toUpperCase();
}

function xmlTag(xml, name) {
  return xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"))?.[1]?.trim() || "";
}

function hnapEnvelope(name, inner = "") {
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${name} xmlns="http://purenetworks.com/HNAP1/">${inner}</${name}></soap:Body></soap:Envelope>`;
}

async function openDlinkSession() {
  const baseUrl = process.env.DLINK_URL;
  const username = process.env.DLINK_USER;
  const password = process.env.DLINK_PASS;
  if (!baseUrl || !username || !password) throw new Error("D-Link credentials are not configured");
  const endpoint = new URL("/HNAP1/", baseUrl);

  const rawPost = async (name, inner, key, cookie = "") => {
    const action = `"http://purenetworks.com/HNAP1/${name}"`;
    const timestamp = String(Date.now() % 2000000000000);
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(4500),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": action,
        "HNAP_AUTH": `${hmacMd5(key, timestamp + action)} ${timestamp}`,
        "Cookie": cookie,
      },
      body: hnapEnvelope(name, inner),
    });
    return response.text();
  };

  const challengeResponse = await rawPost(
    "Login",
    `<Action>request</Action><Username>${username}</Username><LoginPassword></LoginPassword><Captcha></Captcha>`,
    "withoutloginkey",
  );
  const challenge = xmlTag(challengeResponse, "Challenge");
  const cookieValue = xmlTag(challengeResponse, "Cookie");
  const publicKey = xmlTag(challengeResponse, "PublicKey");
  if (!challenge || !cookieValue || !publicKey) throw new Error("D-Link did not return an authentication challenge");
  const privateKey = hmacMd5(publicKey + password, challenge);
  const cookie = `uid=${cookieValue}`;
  const loginResponse = await rawPost(
    "Login",
    `<Action>login</Action><Username>${username}</Username><LoginPassword>${hmacMd5(privateKey, challenge)}</LoginPassword><Captcha></Captcha>`,
    privateKey,
    cookie,
  );
  if (xmlTag(loginResponse, "LoginResult") !== "OK") throw new Error("D-Link rejected its saved login");
  return {
    post(name, inner = "") {
      return rawPost(name, inner, privateKey, cookie);
    },
  };
}

async function collectDlinkAssociations() {
  if (!process.env.DLINK_URL || !process.env.DLINK_USER || !process.env.DLINK_PASS) {
    return { apId: "dlink", available: false, clients: [], detail: "Client-table login is not configured" };
  }
  try {
    const session = await openDlinkSession();
    const xml = await session.post("GetClientInfo");
    const clients = [...xml.matchAll(/<ClientInfo>([\s\S]*?)<\/ClientInfo>/gi)]
      .map((match) => {
        const type = xmlTag(match[1], "Type");
        return {
          mac: xmlTag(match[1], "MacAddress").toLowerCase(),
          ip: xmlTag(match[1], "IPv4Address"),
          hostname: xmlTag(match[1], "DeviceName"),
          apId: "dlink",
          type,
          band: type === "WiFi_5G" ? "5 GHz" : type === "WiFi_2.4G" ? "2.4 GHz" : "",
          signal: xmlTag(match[1], "SignalStrength"),
          source: "D-Link client table",
        };
      })
      .filter((client) => client.mac && client.type.startsWith("WiFi_"));
    return { apId: "dlink", available: true, clients, detail: "Fresh D-Link client table" };
  } catch (error) {
    return { apId: "dlink", available: false, clients: [], detail: error?.message || "D-Link client table unavailable" };
  }
}

async function collectTplinkAssociations() {
  const baseUrl = process.env.TPLINK_URL;
  const username = process.env.TPLINK_USER;
  const password = process.env.TPLINK_PASS;
  if (!baseUrl || !username || !password) {
    return { apId: "tplink", available: false, clients: [], detail: "Client-table login is not configured" };
  }
  try {
    const loginUrl = new URL("/Forms/login_security_1", baseUrl);
    const loginPage = new URL("/login_security.html", baseUrl);
    const body = new URLSearchParams({
      Login_Name: username,
      Login_Pwd: "Ha2S+eOKqmzA6nrlmTeh7w==",
      uiWebLoginhiddenUsername: createHash("md5").update(username).digest("hex"),
      uiWebLoginhiddenPassword: createHash("md5").update(password).digest("hex"),
    });
    const login = await fetch(loginUrl, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(3500),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": loginPage.href,
      },
      body,
    });
    const cookies = typeof login.headers.getSetCookie === "function"
      ? login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ")
      : login.headers.get("set-cookie")?.split(",").map((value) => value.split(";")[0]).join("; ") || "";
    if (!cookies) return { apId: "tplink", available: false, clients: [], detail: "TP-Link login did not return a session" };
    const response = await fetch(new URL("/status/status_deviceinfo.htm", baseUrl), {
      signal: AbortSignal.timeout(3500),
      headers: { "Cookie": cookies, "Referer": new URL("/rpSys.html", baseUrl).href },
    });
    const html = await response.text();
    const clients = [...html.matchAll(/<td[^>]*>\s*\d+\s*<\/td><td[^>]*>\s*([0-9a-f:]{17})\s*<\/td>/gi)].map((match) => ({
      mac: match[1].toLowerCase(),
      ip: "",
      hostname: "",
      apId: "tplink",
      type: "WiFi_2.4G",
      band: "2.4 GHz",
      signal: "",
      source: "TP-Link wireless client table",
    }));
    return { apId: "tplink", available: true, clients, detail: "Fresh TP-Link client table" };
  } catch (error) {
    return { apId: "tplink", available: false, clients: [], detail: error?.message || "TP-Link client table unavailable" };
  }
}

async function zltPost(payload) {
  const baseUrl = process.env.ZLT_URL;
  const { stdout } = await execFileAsync("curl", [
    "-ksS",
    "-H", "Content-Type: application/json",
    "--data-binary", JSON.stringify(payload),
    new URL("/cgi-bin/http.cgi", baseUrl).href,
  ], { timeout: 4500, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout);
}

async function collectZltAssociations() {
  const username = process.env.ZLT_USER;
  const password = process.env.ZLT_PASS;
  if (!process.env.ZLT_URL || !username || !password) {
    return { apId: "zlt", available: false, clients: [], detail: "Client-table login is not configured" };
  }
  try {
    const challenge = await zltPost({ cmd: 232, method: "GET", sessionId: "", language: "CN" });
    if (!challenge.success || !challenge.token) {
      return { apId: "zlt", available: false, clients: [], detail: "ZLT did not return an authentication challenge" };
    }
    const login = await zltPost({
      cmd: 100,
      method: "POST",
      sessionId: randomBytes(32).toString("hex"),
      username,
      passwd: createHash("sha256").update(challenge.token + password).digest("hex"),
      isAutoUpgrade: "0",
      subcmd: 0,
      token: "",
      language: "CN",
    });
    if (!login.success || login.AUTH !== "AUTH" || !login.sessionId) {
      return { apId: "zlt", available: false, clients: [], detail: "ZLT rejected its saved login" };
    }
    const bands = await Promise.all([
      zltPost({ cmd: 224, method: "GET", sessionId: login.sessionId, language: "CN" }),
      zltPost({ cmd: 225, method: "GET", sessionId: login.sessionId, language: "CN" }),
    ]);
    const normalize = (value) => Array.isArray(value) ? value : value ? [value] : [];
    const clients = [
      ...normalize(bands[0].wlan24g_wifi_info).map((client) => ({ ...client, band: "2.4 GHz", type: "WiFi_2.4G" })),
      ...normalize(bands[1].wlan5g_wifi_info).map((client) => ({ ...client, band: "5 GHz", type: "WiFi_5G" })),
    ].filter((client) => client.mac).map((client) => ({
      mac: String(client.mac).toLowerCase(),
      ip: client.ip || "",
      hostname: client.user || "",
      apId: "zlt",
      type: client.type,
      band: client.band,
      signal: client.rssi || "",
      source: "ZLT wireless client table",
    }));
    return { apId: "zlt", available: true, clients, detail: "Fresh ZLT client table" };
  } catch (error) {
    return { apId: "zlt", available: false, clients: [], detail: error?.message || "ZLT client table unavailable" };
  }
}

async function collectSltAssociations() {
  const baseUrl = process.env.SLT_URL;
  if (!baseUrl || !process.env.SLT_USER || !process.env.SLT_PASS) {
    return { apId: "slt", available: false, clients: [], detail: "SLT client-table login is not configured" };
  }
  const bands = [
    { index: 1, band: "2.4 GHz", type: "WiFi_2.4G" },
    { index: 0, band: "5 GHz", type: "WiFi_5G" },
  ];
  const clients = [];
  let availableBands = 0;
  try {
    await authenticateSlt();
    for (const band of bands) {
      let html = await sltWirelessTable(band.index);
      if (/formLogin|admin\/login\.asp/i.test(html)) {
        sltSession.authenticatedAt = 0;
        await authenticateSlt(true);
        html = await sltWirelessTable(band.index);
      }
      const isClientTable = html.length > 200
        && !/formLogin|admin\/login\.asp/i.test(html)
        && /(?:mac\s*address|wlstatbl|associated\s+(?:device|station)|station\s+info)/i.test(html);
      if (isClientTable) availableBands += 1;
      for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const match = row[1].match(/(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i);
        if (!match) continue;
        const mac = match[0].replaceAll("-", ":").toLowerCase();
        if (["ff:ff:ff:ff:ff:ff", "00:00:00:00:00:00", "02:00:00:00:00:00"].includes(mac)) continue;
        clients.push({
          mac,
          ip: "",
          hostname: "",
          apId: "slt",
          type: band.type,
          band: band.band,
          signal: "",
          source: "SLT wireless client table",
        });
      }
    }
  } catch (error) {
    sltSession.authenticatedAt = 0;
    return { apId: "slt", available: false, clients: [], detail: routerFetchError(error, "SLT") };
  }
  return {
    apId: "slt",
    available: availableBands > 0,
    clients,
    detail: availableBands > 0
      ? `Fresh SLT client table (${availableBands}/2 Wi-Fi bands answered)`
      : "SLT client table did not answer",
  };
}

async function collectAssociations(seenAt) {
  const previousSlt = associationTelemetry.get("slt");
  const pollSltNow = !previousSlt?.checkedAt
    || previousSlt.available
    || Date.now() - previousSlt.checkedAt >= sltAssociationIntervalMs;
  const reports = (await Promise.all([
    pollSltNow ? collectSltAssociations() : null,
    collectZltAssociations(),
    collectDlinkAssociations(),
    collectTplinkAssociations(),
  ])).filter(Boolean);
  for (const report of reports) {
    associationTelemetry.set(report.apId, {
      status: report.available ? "verified" : "unavailable",
      available: report.available,
      clients: report.clients.length,
      checkedAt: seenAt,
      detail: report.detail,
    });
  }
  const byMac = new Map();
  for (const client of reports.flatMap((report) => report.clients)) {
    if (!client.mac) continue;
    const existing = byMac.get(client.mac);
    if (existing && existing.apId !== client.apId) {
      byMac.set(client.mac, {
        ...client,
        apId: "",
        source: `${existing.source} and ${client.source}`,
        type: "Conflicting reports",
        band: "",
      });
    } else {
      byMac.set(client.mac, client);
    }
  }
  for (const report of reports.filter((item) => item.available)) {
    const reportedMacs = new Set(report.clients.map((client) => client.mac));
    const previouslyAssociated = db.prepare(`
      SELECT mac FROM devices
      WHERE ap_id=? AND lower(association_source) LIKE '%client table%'
    `).all(report.apId);
    const clearAssociation = db.prepare(`
      UPDATE devices SET
        ap_id='',association_type='',association_band='',association_signal='',association_source='',association_seen_at=0
      WHERE mac=?
    `);
    for (const device of previouslyAssociated) {
      if (!reportedMacs.has(device.mac) && !byMac.has(device.mac)) clearAssociation.run(device.mac);
    }
  }

  const upsert = db.prepare(`
    INSERT INTO devices (
      mac,ip,hostname,label,kind,ap_id,association_type,association_band,association_signal,
      association_source,association_seen_at,status,first_seen,last_seen,last_changed,source
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'online',?,?,?,'Router client table')
    ON CONFLICT(mac) DO UPDATE SET
      ip=CASE WHEN excluded.ip<>'' THEN excluded.ip ELSE devices.ip END,
      hostname=CASE WHEN devices.hostname='' AND excluded.hostname<>'' THEN excluded.hostname ELSE devices.hostname END,
      ap_id=excluded.ap_id,
      association_type=excluded.association_type,
      association_band=excluded.association_band,
      association_signal=excluded.association_signal,
      association_source=excluded.association_source,
      association_seen_at=excluded.association_seen_at,
      status='online',
      last_seen=excluded.last_seen,
      last_changed=CASE WHEN devices.status<>'online' THEN excluded.last_changed ELSE devices.last_changed END
  `);
  for (const client of byMac.values()) {
    upsert.run(
      client.mac,
      client.ip,
      client.hostname,
      client.hostname || `Device ${client.mac.slice(-5).replace(":", "")}`,
      "Unknown",
      client.apId,
      client.type,
      client.band,
      client.signal,
      client.source,
      seenAt,
      seenAt,
      seenAt,
      seenAt,
    );
  }

  const staleBefore = seenAt - Math.max(associationIntervalMs * 3, 20000);
  db.prepare(`
    UPDATE devices SET
      ap_id='',
      association_type='',
      association_band='',
      association_signal='',
      association_source='',
      association_seen_at=0
    WHERE status='online'
      AND association_seen_at>0
      AND association_seen_at<?
      AND lower(association_source) LIKE '%client table%'
  `).run(staleBefore);
  db.prepare(`
    UPDATE devices SET
      ap_id='',
      association_type='',
      association_band='',
      association_signal='',
      association_source='',
      association_seen_at=0
    WHERE association_source='Online on the main LAN and not present in a current downstream AP report'
  `).run();
  db.prepare(`
    UPDATE devices SET status='offline',last_changed=?
    WHERE status='online'
      AND mac LIKE 'history:%'
      AND EXISTS (
        SELECT 1 FROM devices AS current
        WHERE current.ip=devices.ip
          AND current.status='online'
          AND current.mac NOT LIKE 'history:%'
      )
  `).run(seenAt);

  const counts = new Map();
  for (const client of byMac.values()) {
    if (!client.apId) continue;
    counts.set(client.apId, (counts.get(client.apId) || 0) + 1);
  }
  db.prepare("UPDATE routers SET clients=0").run();
  for (const [apId, count] of counts) {
    db.prepare("UPDATE routers SET clients=? WHERE id=?").run(count, apId);
    const telemetry = associationTelemetry.get(apId);
    if (telemetry) associationTelemetry.set(apId, { ...telemetry, clients: count });
  }
}

async function reverseName(ip) {
  if (process.platform !== "darwin") return "";
  try {
    const { stdout } = await execFileAsync("dscacheutil", ["-q", "host", "-a", "ip_address", ip], { timeout: 900 });
    return stdout.match(/name:\s*(.+)/)?.[1]?.trim() || "";
  } catch {
    return "";
  }
}

function addEvent(type, severity, title, detail = "") {
  db.prepare("INSERT INTO events (type,severity,title,detail,created_at) VALUES (?,?,?,?,?)")
    .run(type, severity, title, detail, Date.now());
}

function basicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function privateSetting(key) {
  const environmentValue = process.env[key];
  if (environmentValue) return environmentValue;
  return db.prepare("SELECT value FROM private_settings WHERE key=?").get(key)?.value || "";
}

function savePrivateSetting(key, value) {
  db.prepare(`
    INSERT INTO private_settings (key,value,updated_at)
    VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at
  `).run(key, value, Date.now());
}

function hashControlPin(pin, salt = randomBytes(16).toString("hex")) {
  return `scrypt$${salt}$${scryptSync(pin, salt, 32).toString("hex")}`;
}

function verifyControlPin(pin) {
  const stored = privateSetting("DEVICE_CONTROL_PIN_SCRYPT");
  const [, salt, expectedHex] = stored.split("$");
  if (!salt || !expectedHex || !/^\d{4}$/.test(pin)) return false;
  try {
    const expected = Buffer.from(expectedHex, "hex");
    const actual = scryptSync(pin, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function ensureControlPin() {
  if (privateSetting("DEVICE_CONTROL_PIN_SCRYPT")) return;
  savePrivateSetting("DEVICE_CONTROL_PIN_SCRYPT", hashControlPin("0000"));
  savePrivateSetting("DEVICE_CONTROL_PIN_IS_DEFAULT", "1");
}

ensureControlPin();

const controlPinAttempts = {
  failures: 0,
  lockedUntil: 0,
};

function authorizeControlPin(pin) {
  const now = Date.now();
  if (controlPinAttempts.lockedUntil > now) {
    return {
      ok: false,
      status: 429,
      error: `Too many incorrect PIN attempts. Try again in ${Math.ceil((controlPinAttempts.lockedUntil - now) / 60000)} minute(s).`,
    };
  }
  if (!verifyControlPin(pin)) {
    controlPinAttempts.failures += 1;
    if (controlPinAttempts.failures >= 5) {
      controlPinAttempts.failures = 0;
      controlPinAttempts.lockedUntil = now + 5 * 60000;
      return { ok: false, status: 429, error: "Too many incorrect PIN attempts. Device controls are locked for 5 minutes." };
    }
    return {
      ok: false,
      status: 403,
      error: `Incorrect PIN. ${5 - controlPinAttempts.failures} attempt(s) remaining.`,
    };
  }
  controlPinAttempts.failures = 0;
  controlPinAttempts.lockedUntil = 0;
  return { ok: true };
}

function normalizedMac(value) {
  return String(value || "").trim().toLowerCase().replaceAll("-", ":");
}

function currentMacAddresses() {
  const values = new Set();
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      const mac = normalizedMac(address.mac);
      if (/^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/.test(mac) && mac !== "00:00:00:00:00:00") values.add(mac);
    }
  }
  return values;
}

function deviceProtectionReason(device) {
  if (!device) return "Device not found";
  if (String(device.mac || "").startsWith("history:")) return "Remembered history entries cannot be blocked";
  if (String(device.kind || "").toLowerCase().includes("infrastructure")) return "Network infrastructure is protected";
  if (String(device.identity_source || "").toLowerCase().startsWith("this mac")) return "The Mac running HomeScope is protected";
  if (currentMacAddresses().has(normalizedMac(device.mac))) return "The Mac running HomeScope is protected";
  if (routers.some((router) => router[3] === device.ip)) return "Routers and access points are protected";
  return "";
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function dlinkMacList(xml) {
  const body = xmlTag(xml, "MACList");
  return [...body.matchAll(/<string>([\s\S]*?)<\/string>/gi)]
    .map((match) => normalizedMac(match[1]))
    .filter((mac) => /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/.test(mac));
}

async function setDlinkDeviceBlocked(mac, blocked) {
  const session = await openDlinkSession();
  const before = await session.post("GetMACFilters2");
  if (xmlTag(before, "GetMACFilters2Result") !== "OK") throw new Error("D-Link did not return its MAC filter settings");
  if (xmlTag(before, "IsAllowList").toLowerCase() === "true") {
    throw new Error("D-Link is using allow-list mode; HomeScope will not overwrite that policy");
  }
  const targetMac = normalizedMac(mac);
  const entries = new Set(dlinkMacList(before));
  if (blocked) entries.add(targetMac);
  else entries.delete(targetMac);
  const macList = [...entries].sort().map((entry) => `<string>${xmlEscape(entry.toUpperCase())}</string>`).join("");
  const enabled = blocked ? "true" : (xmlTag(before, "Enabled") || "true").toLowerCase();
  const saved = await session.post(
    "SetMACFilters2",
    `<Enabled>${enabled}</Enabled><IsAllowList>false</IsAllowList><MACList>${macList}</MACList>`,
  );
  if (xmlTag(saved, "SetMACFilters2Result") !== "OK") throw new Error("D-Link rejected the MAC filter update");
  const after = await session.post("GetMACFilters2");
  const confirmed = dlinkMacList(after).includes(targetMac);
  if (confirmed !== blocked) throw new Error("D-Link did not confirm the requested MAC filter state");
  return {
    routerId: "dlink",
    state: blocked ? "blocked" : "allowed",
    detail: blocked
      ? "Blocked and verified in the D-Link Wi-Fi deny list"
      : "Removed and verified from the D-Link Wi-Fi deny list",
  };
}

async function setDeviceAccess(mac, action) {
  const normalized = normalizedMac(mac);
  if (!/^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/.test(normalized)) {
    const error = new Error("This entry does not have a controllable hardware address");
    error.status = 400;
    throw error;
  }
  const device = db.prepare("SELECT * FROM devices WHERE lower(mac)=?").get(normalized);
  if (!device) {
    const error = new Error("Device not found");
    error.status = 404;
    throw error;
  }
  const protectionReason = deviceProtectionReason(device);
  if (protectionReason) {
    const error = new Error(protectionReason);
    error.status = 409;
    throw error;
  }
  const existingControl = db.prepare("SELECT * FROM device_controls WHERE mac=?").get(normalized);
  const blocked = action === "block";
  if (!blocked && action !== "unblock") {
    const error = new Error("Action must be block or unblock");
    error.status = 400;
    throw error;
  }
  const controlRouter = blocked ? device.ap_id : (existingControl?.router_id || device.ap_id);
  if (controlRouter !== "dlink") {
    const routerName = db.prepare("SELECT name FROM routers WHERE id=?").get(device.ap_id)?.name || "this access point";
    const error = new Error(`${routerName} does not yet expose a verified HomeScope blocking adapter`);
    error.status = 409;
    throw error;
  }

  const result = await setDlinkDeviceBlocked(normalized, blocked);
  const updatedAt = Date.now();
  db.prepare(`
    INSERT INTO device_controls (mac,desired_state,actual_state,router_id,detail,updated_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(mac) DO UPDATE SET
      desired_state=excluded.desired_state,
      actual_state=excluded.actual_state,
      router_id=excluded.router_id,
      detail=excluded.detail,
      updated_at=excluded.updated_at
  `).run(normalized, result.state, result.state, result.routerId, result.detail, updatedAt);
  invalidateSnapshotCache();
  addEvent(
    blocked ? "device_blocked" : "device_unblocked",
    blocked ? "warning" : "info",
    `${device.label || device.hostname || device.ip} ${blocked ? "was blocked" : "was allowed"}`,
    result.detail,
  );
  return { ok: true, state: result.state, detail: result.detail, updatedAt };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(4500),
    headers: {
      "Accept": "application/json",
      "Connection": "close",
      "User-Agent": "HomeScope/1.0",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Sensor returned ${response.status}`);
  return response.json();
}

async function collectDns(seenAt) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO dns_events (event_key,seen_at,client,domain,status,source)
    VALUES (?,?,?,?,?,?)
  `);

  const nextDnsProfile = privateSetting("NEXTDNS_PROFILE_ID");
  const nextDnsApiKey = privateSetting("NEXTDNS_API_KEY");
  if (nextDnsProfile && nextDnsApiKey) {
    try {
      const url = new URL(`https://api.nextdns.io/profiles/${encodeURIComponent(nextDnsProfile)}/logs`);
      url.searchParams.set("limit", "500");
      url.searchParams.set("sort", "desc");
      const payload = await fetchJson(url, { headers: { "X-Api-Key": nextDnsApiKey } });
      for (const item of (payload.data || [])) {
        const timestamp = Date.parse(item.timestamp) || seenAt;
        const domain = item.domain || "";
        const client = item.device?.name || item.client || item.device?.model || item.clientIp || "Unidentified";
        if (!domain) continue;
        const identity = item.device?.id || item.client || item.clientIp || "unknown";
        const eventKey = `nextdns:${timestamp}:${identity}:${domain}:${item.status || "default"}`;
        insert.run(eventKey, timestamp, client, domain, item.status === "blocked" ? "blocked" : "allowed", "NextDNS");
      }
      return;
    } catch {
      return;
    }
  }

  if (process.env.ADGUARD_URL) {
    try {
      const url = new URL("/control/querylog?limit=200&response_status=all", process.env.ADGUARD_URL);
      const headers = process.env.ADGUARD_USER
        ? { Authorization: basicAuth(process.env.ADGUARD_USER, process.env.ADGUARD_PASS || "") }
        : {};
      const payload = await fetchJson(url, { headers });
      for (const [index, item] of (payload.data || []).entries()) {
        const timestamp = Date.parse(item.time) || seenAt;
        const domain = item.question?.name || item.domain || "";
        const client = item.client || item.client_info?.name || "";
        if (!domain) continue;
        const blocked = /filter|blocked|safebrowsing|parental/i.test(`${item.status || ""} ${item.reason || ""}`);
        insert.run(`adguard:${timestamp}:${client}:${domain}:${index}`, timestamp, client, domain, blocked ? "blocked" : "allowed", "AdGuard Home");
      }
      return;
    } catch {
      return;
    }
  }

  if (process.env.PIHOLE_URL) {
    try {
      const url = new URL("/admin/api.php", process.env.PIHOLE_URL);
      url.searchParams.set("getAllQueries", "200");
      if (process.env.PIHOLE_TOKEN) url.searchParams.set("auth", process.env.PIHOLE_TOKEN);
      const payload = await fetchJson(url);
      const blockedCodes = new Set([1, 4, 5, 6, 7, 8, 9, 10, 11]);
      for (const [index, item] of (payload.data || []).entries()) {
        const timestamp = Number(Array.isArray(item) ? item[0] : item.timestamp) * 1000 || seenAt;
        const domain = Array.isArray(item) ? item[2] : item.domain;
        const client = Array.isArray(item) ? item[3] : (item.client || "");
        const code = Number(Array.isArray(item) ? item[4] : item.status);
        if (!domain) continue;
        insert.run(`pihole:${timestamp}:${client}:${domain}:${index}`, timestamp, client, domain, blockedCodes.has(code) ? "blocked" : "allowed", "Pi-hole");
      }
    } catch {
      // Pi-hole v6 can be connected through its compatibility API or AdGuard-style adapter later.
    }
  }
}

function numberValue(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return Math.max(0, Math.round(number));
  }
  return 0;
}

async function activeTrafficRows() {
  if (!process.env.NTOPNG_URL) return [];
  const url = new URL("/lua/rest/v2/get/host/active.lua", process.env.NTOPNG_URL);
  url.searchParams.set("ifid", "0");
  url.searchParams.set("perPage", "500");
  const headers = process.env.NTOPNG_USER
    ? { Authorization: basicAuth(process.env.NTOPNG_USER, process.env.NTOPNG_PASS || "") }
    : {};
  const payload = await fetchJson(url, { headers });
  const activeHosts = payload.rsp?.data || payload.hosts || [];
  const collection = Array.isArray(activeHosts)
    ? activeHosts.map((row, index) => [row.ip || String(index), row])
    : Object.entries(activeHosts);
  return collection.flatMap(([key, row]) => {
    if (!row || typeof row !== "object") return [];
    const host = String(row.ip || row.host || row.address || key);
    if (!host.startsWith(`${subnet}.`)) return [];
    if (host === `${subnet}.255` || routers.some((router) => router[3] === host)) return [];
    return [{
      host,
      mac: String(row.mac || "").toLowerCase(),
      name: String(row.name || row.hostname || ""),
      bytes_sent: numberValue(row.bytes?.sent, row.bytes_sent, row.sent_bytes, row["bytes.sent"]),
      bytes_received: numberValue(row.bytes?.recvd, row.bytes?.received, row.bytes_received, row.rcvd_bytes, row["bytes.rcvd"]),
      throughput_bps: numberValue(row.thpt?.bps, row.throughput_bps, row.throughput, row.bps),
    }];
  });
}

function inferredIdentity(value) {
  const raw = String(value || "").trim();
  const text = raw.toLowerCase();
  if (!text) return null;
  const clean = raw
    .replace(/\.bbrouter$/i, "")
    .replace(/[._-]+/g, " ")
    .replace(/\b[a-f0-9]{8,}\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const rules = [
    [/iphone/, "Apple iPhone", "Phone", "Apple"],
    [/ipad/, "Apple iPad", "Tablet", "Apple"],
    [/macbook|mac book/, "Apple MacBook", "Laptop", "Apple"],
    [/\bimac\b/, "Apple iMac", "Computer", "Apple"],
    [/moto|motorola/, clean || "Motorola phone", "Phone", "Motorola"],
    [/redmi|xiaomi|\bmi[- ]?[a-z0-9]+/, clean || "Xiaomi device", "Phone", "Xiaomi"],
    [/galaxy|samsung|\bsm[- ]?[a-z0-9]+/, clean || "Samsung Galaxy", "Phone", "Samsung"],
    [/android.?tv|mi.?tv|bravia|webos|\btv\b/, clean || "Smart TV", "TV", ""],
    [/printer|epson|brother|laserjet|deskjet/, clean || "Network printer", "Printer", ""],
    [/camera|\bcam\b|tapo|ring/, clean || "Network camera", "Camera", ""],
    [/playstation|\bps[345]\b|xbox|nintendo|switch/, clean || "Game console", "Game console", ""],
    [/watch|wearable/, clean || "Smart watch", "Wearable", ""],
    [/speaker|homepod|alexa|echo/, clean || "Smart speaker", "Speaker", ""],
  ];
  for (const [pattern, fallback, kind, vendor] of rules) {
    if (pattern.test(text)) {
      const label = clean && !/^(android|unknown|device)$/i.test(clean) ? clean.replace(/\b\w/g, (letter) => letter.toUpperCase()) : fallback;
      return { label, kind, vendor };
    }
  }
  return null;
}

function enrichUnnamedDevices() {
  const weak = db.prepare(`
    SELECT * FROM devices
    WHERE manual_identity=0
      AND (
        lower(label) LIKE 'unknown%'
        OR lower(label) LIKE 'private%'
        OR lower(label) LIKE 'device %'
        OR kind='Unknown'
      )
  `).all();
  const update = db.prepare(`
    UPDATE devices SET label=?,kind=?,vendor=CASE WHEN vendor='' THEN ? ELSE vendor END,
      identity_source=?,identity_confidence='Medium'
    WHERE mac=?
  `);
  for (const device of weak) {
    const latestTrafficName = db.prepare(`
      SELECT name FROM traffic_samples
      WHERE (lower(mac)=lower(?) OR host=?) AND name<>''
      ORDER BY sampled_at DESC LIMIT 1
    `).get(device.mac, device.ip)?.name;
    const inferred = inferredIdentity(device.hostname || latestTrafficName);
    if (!inferred) continue;
    update.run(
      inferred.label,
      inferred.kind,
      inferred.vendor,
      `Automatically categorized from reported hostname: ${device.hostname || latestTrafficName}`,
      device.mac,
    );
  }
}

async function collectTraffic(seenAt) {
  if (!process.env.NTOPNG_URL) return;
  try {
    const collection = await activeTrafficRows();
    const insert = db.prepare(`
      INSERT INTO traffic_samples
      (sampled_at,host,mac,name,bytes_sent,bytes_received,throughput_bps,source)
      VALUES (?,?,?,?,?,?,?,?)
    `);
    for (const row of collection) {
      insert.run(seenAt, row.host, row.mac, row.name, row.bytes_sent, row.bytes_received, row.throughput_bps, "ntopng");
      const normalizedMac = row.mac;
      let device = normalizedMac
        ? db.prepare("SELECT mac,status FROM devices WHERE mac=?").get(normalizedMac)
        : db.prepare("SELECT mac,status FROM devices WHERE ip=? AND mac NOT LIKE 'history:%' ORDER BY last_seen DESC LIMIT 1").get(row.host);
      const validMac = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/.test(normalizedMac)
        && !["00:00:00:00:00:00", "02:00:00:00:00:00", "ff:ff:ff:ff:ff:ff"].includes(normalizedMac);
      if (!device && validMac) {
        const inferred = inferredIdentity(row.name);
        const reportedName = row.name && !/^\d+\.\d+\.\d+\.\d+$/.test(row.name)
          ? row.name.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim()
          : "";
        const label = inferred?.label || reportedName || `Device ${row.host.split(".").at(-1)}`;
        db.prepare(`
          INSERT OR IGNORE INTO devices
          (mac,ip,hostname,label,kind,vendor,status,first_seen,last_seen,last_changed,source,
           ap_id,association_type,association_source,association_seen_at)
          VALUES (?,?,?,?,?,?,'online',?,?,?,'ntopng active host',
                  'slt','Main LAN','Active traffic on the main LAN',?)
        `).run(
          normalizedMac,
          row.host,
          reportedName,
          label,
          inferred?.kind || "Unknown",
          inferred?.vendor || "",
          seenAt,
          seenAt,
          seenAt,
          seenAt,
        );
        db.prepare(`
          UPDATE devices SET status='offline',last_changed=?
          WHERE ip=? AND mac LIKE 'history:%'
        `).run(seenAt, row.host);
        device = db.prepare("SELECT mac,status FROM devices WHERE mac=?").get(normalizedMac);
      }
      if (device) {
        db.prepare(`
          UPDATE devices SET status='online',last_seen=?,
            ip=CASE WHEN ?<>'' THEN ? ELSE ip END,
            hostname=CASE
              WHEN hostname='' OR hostname=ip OR hostname GLOB '[0-9]*.[0-9]*.[0-9]*.[0-9]*'
                THEN CASE
                  WHEN ?<>'' AND ? NOT GLOB '[0-9]*.[0-9]*.[0-9]*.[0-9]*' THEN ?
                  ELSE ?
                END
              ELSE hostname
            END,
            last_changed=CASE WHEN status<>'online' THEN ? ELSE last_changed END
          WHERE mac=?
        `).run(seenAt, row.host, row.host, row.name, row.name, row.name, row.host, seenAt, device.mac);
      }
    }
    enrichUnnamedDevices();
  } catch {
    // The dashboard keeps the connector configured and tries again next scan.
  }
}

let liveTrafficCache = { sampledAt: 0, hosts: [], error: "", pending: null };

async function liveTraffic() {
  const age = Date.now() - liveTrafficCache.sampledAt;
  if (age < 900 && liveTrafficCache.hosts.length) return liveTrafficCache;
  if (liveTrafficCache.pending) return liveTrafficCache.pending;
  liveTrafficCache.pending = (async () => {
    try {
      const sampledAt = Date.now();
      const rows = await activeTrafficRows();
      const devices = db.prepare("SELECT mac,ip,label,kind,ap_id FROM devices").all();
      const routersById = new Map(db.prepare("SELECT id,name FROM routers").all().map((router) => [router.id, router.name]));
      const byMac = new Map(devices.map((device) => [String(device.mac).toLowerCase(), device]));
      const byIp = new Map(devices.map((device) => [device.ip, device]));
      const hosts = rows.map((row) => {
        const device = byMac.get(row.mac) || byIp.get(row.host);
        return {
          ...row,
          name: device?.label || row.name || row.host,
          kind: device?.kind || "Unknown",
          routerName: routersById.get(device?.ap_id) || "Not identified",
        };
      }).sort((a, b) => b.throughput_bps - a.throughput_bps);
      liveTrafficCache = {
        sampledAt,
        hosts,
        totalBps: hosts.reduce((sum, host) => sum + host.throughput_bps, 0),
        error: "",
        pending: null,
      };
    } catch (error) {
      liveTrafficCache = {
        ...liveTrafficCache,
        error: error.message,
        pending: null,
      };
    }
    return liveTrafficCache;
  })();
  return liveTrafficCache.pending;
}

async function collectSensors(seenAt) {
  await Promise.all([collectDns(seenAt), collectTraffic(seenAt)]);
  db.prepare("DELETE FROM dns_events WHERE seen_at < ?").run(seenAt - 30 * 86400000);
  db.prepare("DELETE FROM traffic_samples WHERE sampled_at < ?").run(seenAt - 30 * 86400000);
}

let enrichmentRunning = false;
let enrichmentLastStarted = 0;
async function collectEnrichment(seenAt) {
  if (enrichmentRunning || Date.now() - enrichmentLastStarted < 15000) return;
  enrichmentRunning = true;
  enrichmentLastStarted = Date.now();
  try {
    await collectSensors(seenAt);
  } finally {
    enrichmentRunning = false;
    invalidateSnapshotCache();
    void broadcastSnapshot();
  }
}

let associationRefreshRunning = false;
async function refreshAssociations() {
  if (associationRefreshRunning) return;
  associationRefreshRunning = true;
  try {
    await collectAssociations(Date.now());
  } catch (error) {
    console.error(`HomeScope router refresh failed: ${error?.message || error}`);
  } finally {
    associationRefreshRunning = false;
    invalidateSnapshotCache();
    void broadcastSnapshot();
  }
}

async function scanNetwork() {
  if (scanState.running) return;
  scanState = { ...scanState, running: true, lastStarted: Date.now(), error: "" };
  try {
    const routerArp = process.env.SLT_ARP_ENABLED === "false" ? [] : await sltArpTable();
    let pingResults;
    let arp;
    if (routerArp.length) {
      // The main router already has the authoritative LAN client table. Avoid
      // launching 254 ping processes on every live refresh.
      pingResults = await mapLimit(routers.map((router) => router[3]), routers.length, ping);
      arp = routerArp;
    } else {
      // Fall back to a subnet sweep to populate the Mac's ARP cache when the
      // router table cannot be read.
      pingResults = await fpingSubnet();
      arp = await arpTable();
      if (!arp.length) {
        // Prefer a genuine MAC over a synthetic history:<ip> placeholder.
        // A phone that rotates its private Wi-Fi address can otherwise appear
        // to disappear while an old placeholder for the same IP is revived.
        const knownByIp = new Map();
        const knownDevicesByIp = db.prepare(`
          SELECT ip,mac,last_seen
          FROM devices
          WHERE ip<>''
          ORDER BY last_seen DESC
        `).all();
        for (const device of knownDevicesByIp) {
          const current = knownByIp.get(device.ip);
          if (!current || (current.startsWith("history:") && !device.mac.startsWith("history:"))) {
            knownByIp.set(device.ip, device.mac);
          }
        }
        arp = pingResults.map((result) => ({
          ip: result.ip,
          mac: knownByIp.get(result.ip) || `history:${result.ip}`,
        }));
      }
    }
    for (const entry of await localLanEntries()) {
      const existingIndex = arp.findIndex((candidate) => candidate.ip === entry.ip || candidate.mac === entry.mac);
      if (existingIndex >= 0) arp[existingIndex] = entry;
      else arp.push(entry);
    }
    const reachable = new Map(pingResults.filter((item) => item.ok).map((item) => [item.ip, item]));
    const observationSource = routerArp.length ? "SLT client table" : "LAN scan";
    const seenAt = Date.now();
    const seenMacs = new Set();

    const existing = new Map(db.prepare("SELECT * FROM devices").all().map((device) => [device.mac, device]));
    const upsert = db.prepare(`
      INSERT INTO devices
      (mac,ip,hostname,label,kind,status,first_seen,last_seen,last_changed,source)
      VALUES (?,?,?,?,?,'online',?,?,?,?)
      ON CONFLICT(mac) DO UPDATE SET
        ip=excluded.ip,
        hostname=CASE WHEN devices.hostname='' THEN excluded.hostname ELSE devices.hostname END,
        status='online',
        last_seen=excluded.last_seen,
        last_changed=CASE WHEN devices.status<>'online' THEN excluded.last_changed ELSE devices.last_changed END,
        source=excluded.source
    `);

    for (const entry of arp) {
      if (!entry.ip.startsWith(`${subnet}.`)) continue;
      if (routers.some((router) => router[3] === entry.ip)) continue;
      const previous = existing.get(entry.mac);
      const historical = db.prepare("SELECT * FROM devices WHERE mac LIKE 'history:%' AND ip=? LIMIT 1").get(entry.ip);
      const hostname = previous?.hostname || historical?.hostname || await reverseName(entry.ip);
      const label = previous?.label || historical?.label || hostname || `Device ${entry.ip.split(".").at(-1)}`;
      upsert.run(entry.mac, entry.ip, hostname, label, previous?.kind || historical?.kind || "Unknown", previous?.first_seen || historical?.first_seen || seenAt, seenAt, seenAt, observationSource);
      if (historical && historical.mac !== entry.mac) {
        db.prepare("DELETE FROM devices WHERE mac=?").run(historical.mac);
      }
      seenMacs.add(entry.mac);
      if (!previous && !historical) addEvent("new_device", "warning", "New device discovered", `${label} joined at ${entry.ip}`);
      else if (previous && previous.status !== "online") addEvent("device_online", "info", `${previous.label || label} is back online`, entry.ip);
      db.prepare("INSERT INTO observations (mac,ip,seen_at,status) VALUES (?,?,?,'online')")
        .run(entry.mac, entry.ip, seenAt);
    }

    await checkRouters(reachable);
    for (const device of db.prepare("SELECT * FROM devices").all()) {
      if (seenMacs.has(device.mac)) continue;
      if (!device.mac.startsWith("history:") && seenAt - device.last_seen < Math.max(intervalMs * 6, 180000)) continue;
      if (device.status === "online") {
        db.prepare("UPDATE devices SET status='offline',last_changed=? WHERE mac=?").run(seenAt, device.mac);
        addEvent("device_offline", device.kind === "Infrastructure" ? "critical" : "info", `${device.label || device.hostname || device.ip} went offline`, device.ip);
      }
    }
    const onlineCount = db.prepare("SELECT COUNT(*) AS count FROM devices WHERE status='online'").get().count;
    const routerCount = db.prepare("SELECT COUNT(*) AS count FROM routers WHERE status='online'").get().count;
    db.prepare("INSERT INTO samples (sampled_at,online_count,router_count) VALUES (?,?,?)")
      .run(seenAt, onlineCount, routerCount);
    db.prepare("DELETE FROM observations WHERE seen_at < ?").run(seenAt - 30 * 86400000);
    db.prepare("DELETE FROM samples WHERE sampled_at < ?").run(seenAt - 30 * 86400000);
    scanState = { running: false, lastStarted: scanState.lastStarted, lastCompleted: Date.now(), error: "", source: observationSource };
    invalidateSnapshotCache();
    void broadcastSnapshot();
    void collectEnrichment(seenAt);
  } catch (error) {
    scanState = { running: false, lastStarted: scanState.lastStarted, lastCompleted: Date.now(), error: error.message, source: scanState.source };
  }
}

async function checkRouters(reachable) {
  const previous = new Map(db.prepare("SELECT * FROM routers").all().map((router) => [router.id, router]));
  const update = db.prepare("UPDATE routers SET status=?,latency_ms=?,last_checked=? WHERE id=?");
  for (const router of routers) {
    const [id, name, , ip] = router;
    let result = reachable.get(ip) || await ping(ip);
    if (!result?.ok) {
      await new Promise((resolveRetry) => setTimeout(resolveRetry, 180));
      result = await ping(ip);
    }
    const status = result?.ok ? "online" : "offline";
    update.run(status, result?.latency || null, Date.now(), id);
    if (previous.get(id)?.status === "online" && status === "offline") {
      addEvent("router_offline", "critical", `${name} is unreachable`, `${ip} did not answer the health check`);
    }
  }
}

function humanAge(timestamp) {
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 60000) return "Just now";
  if (delta < 3600000) return `${Math.floor(delta / 60000)}m ago`;
  if (delta < 86400000) return `${Math.floor(delta / 3600000)}h ago`;
  return `${Math.floor(delta / 86400000)}d ago`;
}

function trafficUsageWindow(key, label, since, until, devices, latestTrafficHosts) {
  const rows = db.prepare(`
    SELECT
      COALESCE(NULLIF(UPPER(mac), ''), host) AS identity,
      MAX(host) AS host,
      MAX(mac) AS mac,
      MAX(name) AS name,
      MIN(sampled_at) AS tracked_from,
      MAX(sampled_at) AS tracked_to,
      COUNT(*) AS sample_count,
      MAX(0, MAX(bytes_sent) - MIN(bytes_sent)) AS bytes_sent,
      MAX(0, MAX(bytes_received) - MIN(bytes_received)) AS bytes_received
    FROM traffic_samples
    WHERE sampled_at >= ? AND sampled_at <= ?
    GROUP BY COALESCE(NULLIF(UPPER(mac), ''), host)
  `).all(since, until);

  const deviceByMac = new Map(devices.map((device) => [String(device.mac || "").toUpperCase(), device]));
  const deviceByIp = new Map(devices.map((device) => [device.ip, device]));
  const latestByIdentity = new Map(latestTrafficHosts.map((host) => [
    String(host.mac || host.host || "").toUpperCase(),
    host,
  ]));

  const usageDevices = rows.map((row) => {
    const identity = String(row.identity || "");
    const device = deviceByMac.get(identity.toUpperCase()) || deviceByIp.get(row.host);
    const latest = latestByIdentity.get(identity.toUpperCase());
    const sent = Number(row.bytes_sent || 0);
    const received = Number(row.bytes_received || 0);
    const sensorName = row.name && row.name !== row.host ? row.name : "";
    return {
      identity,
      host: row.host,
      mac: row.mac || device?.mac || "",
      name: device?.displayName || sensorName || row.host,
      kind: device?.kind || "Unknown",
      owner: device?.owner || "",
      status: device?.status || "unknown",
      sent,
      received,
      total: sent + received,
      currentBps: Number(latest?.throughput_bps || 0),
      trackedFrom: Number(row.tracked_from || 0),
      trackedTo: Number(row.tracked_to || 0),
      sampleCount: Number(row.sample_count || 0),
    };
  }).sort((a, b) => b.total - a.total);

  return {
    key,
    label,
    since,
    until,
    trackedFrom: usageDevices.length ? Math.min(...usageDevices.map((device) => device.trackedFrom)) : 0,
    sent: usageDevices.reduce((sum, device) => sum + device.sent, 0),
    received: usageDevices.reduce((sum, device) => sum + device.received, 0),
    total: usageDevices.reduce((sum, device) => sum + device.total, 0),
    devices: usageDevices,
  };
}

let trafficPeriodsCache = { createdAt: 0, value: null };

function trafficPeriods(devices, trafficHosts) {
  if (trafficPeriodsCache.value && Date.now() - trafficPeriodsCache.createdAt < 15000) {
    return trafficPeriodsCache.value;
  }
  const value = {
    day: trafficUsageWindow(
      "day",
      "Today",
      new Date(new Date().setHours(0, 0, 0, 0)).getTime(),
      Date.now(),
      devices,
      trafficHosts,
    ),
    week: trafficUsageWindow(
      "week",
      "Last 7 days",
      Date.now() - 7 * 86400000,
      Date.now(),
      devices,
      trafficHosts,
    ),
    month: trafficUsageWindow(
      "month",
      "Last 30 days",
      Date.now() - 30 * 86400000,
      Date.now(),
      devices,
      trafficHosts,
    ),
  };
  trafficPeriodsCache = { createdAt: Date.now(), value };
  return value;
}

async function integrationStatus() {
  const integrations = {
    dns: { status: "not_configured", provider: "", label: "Domain history", detail: "Connect Pi-hole or AdGuard Home" },
    traffic: { status: "not_configured", provider: "ntopng", label: "Traffic & apps", detail: "Connect ntopng to a mirrored traffic source" },
  };
  const nextDnsProfile = privateSetting("NEXTDNS_PROFILE_ID");
  const nextDnsApiKey = privateSetting("NEXTDNS_API_KEY");
  if (nextDnsProfile && nextDnsApiKey) {
    integrations.dns = { status: "configured", provider: "NextDNS", label: "Cloud domain history", detail: `Profile ${nextDnsProfile}` };
  } else if (process.env.PIHOLE_URL) {
    integrations.dns = { status: "configured", provider: "Pi-hole", label: "Domain history", detail: process.env.PIHOLE_URL };
  } else if (process.env.ADGUARD_URL) {
    integrations.dns = { status: "configured", provider: "AdGuard Home", label: "Domain history", detail: process.env.ADGUARD_URL };
  }
  if (process.env.NTOPNG_URL) {
    integrations.traffic = { status: "configured", provider: "ntopng", label: "Traffic & apps", detail: process.env.NTOPNG_URL };
  }
  return integrations;
}

function associationTrust(device, at = Date.now()) {
  const source = String(device.association_source || "").toLowerCase();
  const age = device.association_seen_at ? at - device.association_seen_at : Number.POSITIVE_INFINITY;
  const freshFor = Math.max(intervalMs * 2.5, 90000);
  if (!device.ap_id) {
    return {
      key: "unidentified",
      label: "Router not identified",
      verified: false,
      current: false,
      detail: "Seen on the LAN, but no router or access point directly reported it",
    };
  }
  if (source === "manual assignment") {
    return {
      key: "manual",
      label: "Manually assigned",
      verified: false,
      current: true,
      detail: "Saved by you; waiting for a direct router report",
    };
  }
  if (source.includes("client table") && age <= freshFor) {
    return {
      key: "verified",
      label: "Verified now",
      verified: true,
      current: true,
      detail: "Confirmed by a fresh router or access-point client table",
    };
  }
  if (source.includes("client table")) {
    return {
      key: "stale",
      label: "Previous report",
      verified: false,
      current: false,
      detail: "The last direct client-table report is no longer fresh",
    };
  }
  return {
    key: "inferred",
    label: "Estimated",
    verified: false,
    current: age <= freshFor,
    detail: "Inferred from LAN evidence rather than a direct client table",
  };
}

async function buildSnapshot() {
  const routerRows = db.prepare("SELECT * FROM routers ORDER BY ip").all().map((router) => {
    const telemetry = associationTelemetry.get(router.id) || {};
    return {
      ...router,
      clients: telemetry.available ? Number(telemetry.clients || 0) : 0,
      clientDataStatus: telemetry.status || "pending",
      clientDataAvailable: Boolean(telemetry.available),
      clientDataCheckedAt: Number(telemetry.checkedAt || 0),
      clientDataText: telemetry.detail || "Waiting for a client-table check",
    };
  });
  const routerById = new Map(routerRows.map((router) => [router.id, router]));
  const controlsByMac = new Map(
    db.prepare("SELECT * FROM device_controls").all().map((control) => [control.mac, control]),
  );
  const deviceRows = db.prepare("SELECT * FROM devices ORDER BY status DESC,last_seen DESC,label ASC").all()
    .map((device) => {
      const control = controlsByMac.get(device.mac);
      const protectionReason = deviceProtectionReason(device);
      const controlledByDlink = device.ap_id === "dlink" || control?.router_id === "dlink";
      const trust = associationTrust(device);
      return {
        ...device,
        trusted: Boolean(device.trusted),
        displayName: device.label || device.hostname || device.ip,
        apName: routerById.get(device.ap_id)?.name || "",
        association_trust: trust.key,
        associationTrustLabel: trust.label,
        associationTrustDetail: trust.detail,
        associationVerified: trust.verified,
        associationCurrent: trust.current,
        presenceConfidence: trust.verified
          ? "Verified by access point"
          : device.status === "online"
            ? "Seen on the LAN"
            : "Historical",
        associationSeenText: device.association_seen_at ? humanAge(device.association_seen_at) : "",
        lastSeenText: humanAge(device.last_seen),
        firstSeenText: new Date(device.first_seen).toLocaleDateString(),
        control_state: control?.actual_state || "allowed",
        control_detail: control?.detail || "",
        control_router_id: control?.router_id || "",
        control_updated_at: control?.updated_at || 0,
        control_available: !protectionReason && controlledByDlink,
        control_reason: protectionReason || (controlledByDlink
          ? ""
          : `${routerById.get(device.ap_id)?.name || "This access point"} is not yet connected to a verified blocking adapter`),
      };
    });
  const identityKey = (device) => {
    const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const hostname = normalize(device.hostname);
    const label = normalize(device.label);
    const generic = !label || label === "unknowndevice" || label === "privatedevice" || /^device\d+$/.test(label);
    const hostnameIsAddress = normalize(device.ip) === hostname || /^\d+$/.test(hostname);
    if (hostname && !hostnameIsAddress) return `host:${hostname}`;
    return generic ? "" : `label:${label.replace(/old(ip|privateaddress)$/g, "")}`;
  };
  const realIps = new Set(deviceRows.filter((device) => !device.mac.startsWith("history:")).map((device) => device.ip).filter(Boolean));
  const realIdentities = new Set(deviceRows.filter((device) => !device.mac.startsWith("history:")).map(identityKey).filter(Boolean));
  const seenIps = new Set();
  const seenIdentities = new Set();
  const seenNames = new Set();
  const devices = deviceRows.filter((device) => {
    const historyOnly = device.mac.startsWith("history:");
    const identity = identityKey(device);
    const name = String(device.displayName || "").toLowerCase().replace(/\s*\((?:old ip|old private address)\)\s*$/i, "").replace(/[^a-z0-9]/g, "");
    const genericName = !name || name === "unknowndevice" || name === "privatedevice";
    if (/\((?:old ip|old private address)\)/i.test(device.displayName || "")) return false;
    if (historyOnly && ((device.ip && realIps.has(device.ip)) || (identity && realIdentities.has(identity)))) return false;
    if (device.ip && seenIps.has(device.ip)) return false;
    if (identity && seenIdentities.has(identity) && device.status !== "online") return false;
    if (!genericName && seenNames.has(name)) return false;
    if (device.ip) seenIps.add(device.ip);
    if (identity) seenIdentities.add(identity);
    if (!genericName) seenNames.add(name);
    return true;
  });
  const events = db.prepare("SELECT * FROM events ORDER BY created_at DESC LIMIT 80").all()
    .map((event) => ({ ...event, age: humanAge(event.created_at) }));
  const samples = db.prepare("SELECT * FROM samples ORDER BY sampled_at DESC LIMIT 24").all().reverse();
  const normalized = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const domains = {
    recent: db.prepare("SELECT * FROM dns_events ORDER BY seen_at DESC LIMIT 250").all().map((event) => {
      const clientKey = normalized(event.client);
      const device = devices.find((candidate) => {
        const values = [candidate.displayName, candidate.label, candidate.hostname, candidate.ip, candidate.mac];
        return values.some((value) => {
          const candidateKey = normalized(value);
          return candidateKey && clientKey && (candidateKey === clientKey || candidateKey.includes(clientKey) || clientKey.includes(candidateKey));
        });
      });
      return {
        ...event,
        deviceName: device?.displayName || event.client || "Unidentified client",
        deviceIp: device?.ip || "",
        deviceKind: device?.kind || "Unknown",
        routerName: device?.apName || "Not identified",
      };
    }),
    top: db.prepare(`
      SELECT domain,COUNT(*) AS requests,SUM(CASE WHEN status='blocked' THEN 1 ELSE 0 END) AS blocked
      FROM dns_events
      GROUP BY domain
      ORDER BY requests DESC
      LIMIT 20
    `).all(),
    total: db.prepare("SELECT COUNT(*) AS count FROM dns_events").get().count,
    blocked: db.prepare("SELECT COUNT(*) AS count FROM dns_events WHERE status='blocked'").get().count,
  };
  const latestTrafficAt = db.prepare("SELECT MAX(sampled_at) AS sampled_at FROM traffic_samples").get().sampled_at || 0;
  const trafficHosts = latestTrafficAt
    ? db.prepare("SELECT * FROM traffic_samples WHERE sampled_at=? ORDER BY (bytes_sent+bytes_received) DESC").all(latestTrafficAt)
    : [];
  const traffic = {
    sampledAt: latestTrafficAt,
    hosts: trafficHosts,
    sent: trafficHosts.reduce((sum, host) => sum + Number(host.bytes_sent || 0), 0),
    received: trafficHosts.reduce((sum, host) => sum + Number(host.bytes_received || 0), 0),
    periods: trafficPeriods(devices, trafficHosts),
  };
  const online = devices.filter((device) => device.status === "online").length;
  const offline = devices.length - online;
  const onlineDevices = devices.filter((device) => device.status === "online");
  const directVerifiedByRouter = new Map(
    routerRows.map((router) => [router.id, router.clientDataAvailable ? Number(router.clients || 0) : 0]),
  );
  const childrenByRouter = new Map();
  for (const link of topologyLinks) {
    const children = childrenByRouter.get(link.id) || [];
    children.push(link.next);
    childrenByRouter.set(link.id, children);
  }
  const descendantsOf = (routerId) => {
    const descendants = [];
    const pending = [...(childrenByRouter.get(routerId) || [])];
    while (pending.length) {
      const current = pending.shift();
      if (!current || descendants.includes(current)) continue;
      descendants.push(current);
      pending.push(...(childrenByRouter.get(current) || []));
    }
    return descendants;
  };
  const routersWithFlow = routerRows.map((router) => {
    const downstreamRouterIds = descendantsOf(router.id);
    const downstreamClients = downstreamRouterIds.reduce(
      (sum, routerId) => sum + Number(directVerifiedByRouter.get(routerId) || 0),
      0,
    );
    return {
      ...router,
      directClients: Number(directVerifiedByRouter.get(router.id) || 0),
      downstreamClients,
      branchClients: Number(directVerifiedByRouter.get(router.id) || 0) + downstreamClients,
      networkVisibleClients: online,
    };
  });
  return {
    generatedAt: Date.now(),
    collector: scanState,
    summary: {
      online,
      offline,
      total: devices.length,
      verifiedAssociations: onlineDevices.filter((device) => device.associationVerified).length,
      manualAssociations: onlineDevices.filter((device) => device.association_trust === "manual").length,
      inferredAssociations: onlineDevices.filter((device) => device.association_trust === "inferred").length,
      unidentifiedOnline: onlineDevices.filter((device) => device.association_trust === "unidentified").length,
      routersOnline: routerRows.filter((router) => router.status === "online").length,
      routersTotal: routerRows.length,
      unrecognized: devices.filter((device) => {
        const label = device.label.toLowerCase();
        return label.includes("unknown") || label.includes("private") || label.startsWith("device ");
      }).length,
      alerts: events.filter((event) => !event.acknowledged && event.severity !== "info").length,
    },
    devices,
    routers: routersWithFlow,
    events,
    samples,
    domains,
    traffic,
    security: {
      controlPinConfigured: Boolean(privateSetting("DEVICE_CONTROL_PIN_SCRYPT")),
      controlPinIsDefault: privateSetting("DEVICE_CONTROL_PIN_IS_DEFAULT") === "1",
      blocking: {
        provider: "D-Link MAC filter",
        supportedRouters: ["dlink"],
        verified: true,
        detail: "Blocks and verifies Wi-Fi access on D-Link. The Mac host and network infrastructure are always protected.",
      },
    },
    integrations: await integrationStatus(),
    topology: topologyLinks,
  };
}

let snapshotCache = {
  value: null,
  createdAt: 0,
  pending: null,
};
const snapshotClients = new Set();

function invalidateSnapshotCache() {
  snapshotCache.value = null;
  snapshotCache.createdAt = 0;
}

async function snapshot() {
  if (snapshotCache.value && Date.now() - snapshotCache.createdAt < 10000) return snapshotCache.value;
  if (snapshotCache.pending) return snapshotCache.pending;
  snapshotCache.pending = buildSnapshot()
    .then((value) => {
      snapshotCache.value = value;
      snapshotCache.createdAt = Date.now();
      snapshotCache.pending = null;
      return value;
    })
    .catch((error) => {
      snapshotCache.pending = null;
      throw error;
    });
  return snapshotCache.pending;
}

function sendSnapshotEvent(response, value) {
  if (response.destroyed || response.writableEnded) return;
  response.write(`event: snapshot\ndata: ${JSON.stringify(value)}\n\n`);
}

async function broadcastSnapshot() {
  if (!snapshotClients.size) return;
  try {
    const value = await snapshot();
    for (const response of snapshotClients) sendSnapshotEvent(response, value);
  } catch {
    // The next completed scan will publish a fresh snapshot.
  }
}

function snapshotStream(request, response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });
  response.flushHeaders?.();
  response.write("retry: 1500\n\n");
  snapshotClients.add(response);
  void snapshot().then((value) => sendSnapshotEvent(response, value)).catch(() => {});

  const heartbeat = setInterval(() => {
    if (!response.destroyed && !response.writableEnded) response.write(": homescope-live\n\n");
  }, 15000);
  heartbeat.unref();

  const close = () => {
    clearInterval(heartbeat);
    snapshotClients.delete(response);
  };
  request.once("close", close);
  response.once("close", close);
}

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1024 * 1024) throw new Error("Request body is too large");
  }
  return raw ? JSON.parse(raw) : {};
}

function authorized(request) {
  if (!collectorApiToken) return collectorHost === "127.0.0.1" || collectorHost === "::1" || collectorHost === "localhost";
  const supplied = request.headers.authorization || "";
  const expected = `Bearer ${collectorApiToken}`;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function csvExport(response) {
  const rows = db.prepare(`
    SELECT label,hostname,ip,mac,kind,vendor,owner,group_name,status,ap_id,
      association_type,association_band,association_signal,association_source,
      association_seen_at,identity_confidence,identity_source,first_seen,last_seen,source
    FROM devices ORDER BY label
  `).all();
  const header = Object.keys(rows[0] || {
    label: "", hostname: "", ip: "", mac: "", kind: "", vendor: "", owner: "",
    group_name: "", status: "", ap_id: "", association_type: "", association_band: "",
    association_signal: "", association_source: "", association_seen_at: "",
    identity_confidence: "", identity_source: "", first_seen: "", last_seen: "", source: "",
  });
  const csv = [header.join(","), ...rows.map((row) => header.map((key) => `"${String(row[key] ?? "").replaceAll('"', '""')}"`).join(","))].join("\n");
  response.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="homescope-devices-${new Date().toISOString().slice(0, 10)}.csv"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(csv);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (request.method === "GET" && url.pathname === "/health") {
    return json(response, 200, { ok: true, service: "homescope-collector" });
  }
  if (!authorized(request)) return json(response, 401, { error: "Unauthorized" });
  try {
    if (request.method === "GET" && url.pathname === "/api/snapshot/stream") return snapshotStream(request, response);
    if (request.method === "GET" && url.pathname === "/api/snapshot") return json(response, 200, await snapshot());
    if (request.method === "GET" && url.pathname === "/api/traffic/live") return json(response, 200, await liveTraffic());
    if (request.method === "GET" && url.pathname === "/api/export/devices.csv") return csvExport(response);
    if (request.method === "POST" && url.pathname === "/api/scan") {
      if (!scanEnabled) {
        return json(response, 409, {
          error: "LAN scanning is paused until the home VPN is connected.",
        });
      }
      scanNetwork();
      return json(response, 202, { ok: true, message: "Network scan started" });
    }
    if (request.method === "POST" && url.pathname === "/api/integrations/nextdns") {
      const body = await readJson(request);
      const profileId = String(body.profileId || "").trim();
      const apiKey = String(body.apiKey || "").trim();
      if (!/^[a-z0-9_-]{4,32}$/i.test(profileId)) {
        return json(response, 400, { error: "Enter a valid NextDNS profile ID" });
      }
      if (apiKey.length < 20) {
        return json(response, 400, { error: "Enter the API key from your NextDNS account page" });
      }
      try {
        await fetchJson(`https://api.nextdns.io/profiles/${encodeURIComponent(profileId)}`, {
          headers: { "X-Api-Key": apiKey },
        });
      } catch {
        return json(response, 502, { error: "NextDNS rejected those details. Check the profile ID and API key." });
      }
      savePrivateSetting("NEXTDNS_PROFILE_ID", profileId);
      savePrivateSetting("NEXTDNS_API_KEY", apiKey);
      await collectDns(Date.now());
      invalidateSnapshotCache();
      const connected = db.prepare("SELECT COUNT(*) AS count FROM dns_events WHERE source='NextDNS'").get().count;
      return json(response, 200, { ok: true, imported: connected });
    }
    if (request.method === "POST" && url.pathname === "/api/integrations/nextdns/disconnect") {
      db.prepare("DELETE FROM private_settings WHERE key IN ('NEXTDNS_PROFILE_ID','NEXTDNS_API_KEY')").run();
      invalidateSnapshotCache();
      return json(response, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/security/control-pin") {
      const body = await readJson(request);
      const currentPin = String(body.currentPin || "");
      const newPin = String(body.newPin || "");
      const authorization = authorizeControlPin(currentPin);
      if (!authorization.ok) return json(response, authorization.status, { error: authorization.error });
      if (!/^\d{4}$/.test(newPin)) return json(response, 400, { error: "The new control PIN must contain exactly 4 digits" });
      if (newPin === currentPin) return json(response, 400, { error: "Choose a different PIN" });
      savePrivateSetting("DEVICE_CONTROL_PIN_SCRYPT", hashControlPin(newPin));
      savePrivateSetting("DEVICE_CONTROL_PIN_IS_DEFAULT", "0");
      invalidateSnapshotCache();
      addEvent("control_pin_changed", "info", "Device control PIN changed", "The local HomeScope control PIN was updated.");
      return json(response, 200, { ok: true });
    }
    if (request.method === "POST" && /^\/api\/devices\/[^/]+\/access$/.test(url.pathname)) {
      const encodedMac = url.pathname.slice("/api/devices/".length, -"/access".length);
      const mac = decodeURIComponent(encodedMac);
      const body = await readJson(request);
      const authorization = authorizeControlPin(String(body.pin || ""));
      if (!authorization.ok) return json(response, authorization.status, { error: authorization.error });
      const result = await setDeviceAccess(mac, String(body.action || ""));
      return json(response, 200, result);
    }
    if (request.method === "PATCH" && url.pathname.startsWith("/api/devices/")) {
      const mac = decodeURIComponent(url.pathname.slice("/api/devices/".length));
      const body = await readJson(request);
      const allowed = ["label", "owner", "kind", "group_name", "ap_id", "trusted"];
      const entries = Object.entries(body).filter(([key]) => allowed.includes(key));
      if (!entries.length) return json(response, 400, { error: "No editable fields supplied" });
      const assignments = entries.map(([key]) => `${key}=?`).join(",");
      db.prepare(`UPDATE devices SET ${assignments} WHERE mac=?`).run(...entries.map(([, value]) => value), mac);
      if (entries.some(([key]) => ["label", "owner", "kind"].includes(key))) {
        db.prepare(`
          UPDATE devices SET
            manual_identity=1,
            identity_source='Manually labeled in HomeScope',
            identity_confidence='Confirmed'
          WHERE mac=?
        `).run(mac);
      }
      if (Object.hasOwn(body, "ap_id")) {
        db.prepare(`
          UPDATE devices SET
            association_type=?,
            association_band='',
            association_signal='',
            association_source=?,
            association_seen_at=?
          WHERE mac=?
        `).run(body.ap_id ? "Manual" : "", body.ap_id ? "Manual assignment" : "", Date.now(), mac);
      }
      invalidateSnapshotCache();
      return json(response, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/events/") && url.pathname.endsWith("/ack")) {
      const id = Number(url.pathname.split("/")[3]);
      db.prepare("UPDATE events SET acknowledged=1 WHERE id=?").run(id);
      invalidateSnapshotCache();
      return json(response, 200, { ok: true });
    }
    if (request.method === "DELETE" && url.pathname === "/api/events") {
      const removed = db.prepare("DELETE FROM events").run().changes;
      invalidateSnapshotCache();
      return json(response, 200, { ok: true, removed });
    }
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    return json(response, Number(error.status) || 500, { error: error.message });
  }
});

if (!collectorApiToken && !["127.0.0.1", "::1", "localhost"].includes(collectorHost)) {
  throw new Error("COLLECTOR_API_TOKEN is required when COLLECTOR_HOST is not loopback");
}

server.listen(port, collectorHost, () => {
  console.log(`HomeScope collector listening on http://${collectorHost}:${port}`);
  if (scanEnabled) {
    void refreshAssociations();
    setInterval(refreshAssociations, associationIntervalMs).unref();
    void scanNetwork().then(() => snapshot()).catch(() => {});
    setInterval(scanNetwork, intervalMs).unref();
  } else {
    scanState = {
      ...scanState,
      running: false,
      error: "",
      source: "Saved snapshot · waiting for home VPN",
    };
    console.log("LAN scanning is paused until SCAN_ENABLED is enabled.");
  }
});
