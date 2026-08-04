"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  Ban,
  Bell,
  BellOff,
  Building2,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cloud,
  Database,
  Download,
  ExternalLink,
  Eye,
  Gauge,
  Globe2,
  HardDrive,
  History,
  House,
  KeyRound,
  Laptop,
  Lightbulb,
  LogOut,
  Maximize2,
  Menu,
  Minus,
  Moon,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Router,
  Search,
  Settings,
  ShieldCheck,
  ShieldQuestion,
  Signal,
  Smartphone,
  Speaker,
  Sun,
  Tablet,
  Trash2,
  Tv,
  Unplug,
  Users,
  Watch,
  Wifi,
  WifiOff,
  X,
  Gamepad2,
  Printer,
  Monitor,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Keep the browser-facing feed outside /api: some mobile privacy/content
// blockers reject background requests to API-style paths.
const API = "/live-feed";

type View =
  | "overview"
  | "devices"
  | "topology"
  | "traffic"
  | "domains"
  | "activity"
  | "routers"
  | "settings";

type HouseNames = {
  houseC: string;
  houseB: string;
  houseA: string;
  main: string;
};

const defaultHouseNames: HouseNames = {
  houseC: "House C",
  houseB: "House B",
  houseA: "House A",
  main: "Main house building",
};

const displayName = process.env.NEXT_PUBLIC_HOMESCOPE_DISPLAY_NAME?.trim() || "";

type Device = {
  mac: string;
  ip: string;
  hostname: string;
  label: string;
  displayName: string;
  owner: string;
  kind: string;
  group_name: string;
  ap_id: string;
  apName: string;
  association_type: string;
  association_band: string;
  association_signal: string;
  association_source: string;
  association_seen_at: number;
  associationSeenText: string;
  association_trust: "verified" | "manual" | "inferred" | "stale" | "unidentified";
  associationTrustLabel: string;
  associationTrustDetail: string;
  associationVerified: boolean;
  associationCurrent: boolean;
  presenceConfidence: string;
  identity_source: string;
  identity_confidence: string;
  vendor: string;
  trusted: boolean;
  status: "online" | "offline";
  first_seen: number;
  last_seen: number;
  last_changed: number;
  lastSeenText: string;
  firstSeenText: string;
  source: string;
  control_state: "allowed" | "blocked";
  control_detail: string;
  control_router_id: string;
  control_updated_at: number;
  control_available: boolean;
  control_reason: string;
};

type RouterRow = {
  id: string;
  name: string;
  role: string;
  ip: string;
  admin_url: string;
  model: string;
  status: "online" | "offline" | "unknown";
  latency_ms: number | null;
  last_checked: number;
  clients: number;
  directClients: number;
  downstreamClients: number;
  branchClients: number;
  networkVisibleClients: number;
  clientDataStatus: "pending" | "verified" | "unavailable";
  clientDataAvailable: boolean;
  clientDataCheckedAt: number;
  clientDataText: string;
  note: string;
};

type EventRow = {
  id: number;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  created_at: number;
  acknowledged: number;
  age: string;
};

export type Snapshot = {
  generatedAt: number;
  collector: {
    running: boolean;
    lastStarted: number;
    lastCompleted: number;
    error: string;
    source: string;
  };
  summary: {
    online: number;
    offline: number;
    total: number;
    verifiedAssociations: number;
    manualAssociations: number;
    inferredAssociations: number;
    unidentifiedOnline: number;
    routersOnline: number;
    routersTotal: number;
    unrecognized: number;
    alerts: number;
  };
  devices: Device[];
  routers: RouterRow[];
  events: EventRow[];
  samples: Array<{
    id: number;
    sampled_at: number;
    online_count: number;
    router_count: number;
  }>;
  integrations: {
    dns: { status: string; provider: string; label: string; detail: string };
    traffic: { status: string; provider: string; label: string; detail: string };
  };
  domains: {
    recent: Array<{
      event_key: string;
      seen_at: number;
      client: string;
      domain: string;
      status: string;
      source: string;
      deviceName: string;
      deviceIp: string;
      deviceKind: string;
      routerName: string;
    }>;
    top: Array<{ domain: string; requests: number; blocked: number }>;
    total: number;
    blocked: number;
  };
  traffic: {
    sampledAt: number;
    hosts: Array<{ id: number; host: string; mac: string; name: string; bytes_sent: number; bytes_received: number; throughput_bps: number }>;
    sent: number;
    received: number;
    periods: Record<UsagePeriodKey, UsagePeriod>;
  };
  security: {
    controlPinConfigured: boolean;
    controlPinIsDefault: boolean;
    blocking: {
      provider: string;
      supportedRouters: string[];
      verified: boolean;
      detail: string;
    };
  };
};

type LiveTraffic = {
  sampledAt: number;
  totalBps: number;
  error: string;
  hosts: Array<{
    host: string;
    mac: string;
    name: string;
    kind: string;
    routerName: string;
    bytes_sent: number;
    bytes_received: number;
    throughput_bps: number;
  }>;
};

type ConnectionToast = {
  id: string;
  name: string;
  kind: string;
  router: string;
};

type AccentTheme = "mint" | "ocean" | "violet" | "sunset" | "rose";
type FontChoice = "modern" | "rounded" | "classic" | "mono";

type UsagePeriodKey = "day" | "week" | "month";

type UsageDevice = {
  identity: string;
  host: string;
  mac: string;
  name: string;
  kind: string;
  owner: string;
  status: string;
  sent: number;
  received: number;
  total: number;
  currentBps: number;
  trackedFrom: number;
  trackedTo: number;
  sampleCount: number;
};

type UsagePeriod = {
  key: UsagePeriodKey;
  label: string;
  since: number;
  until: number;
  trackedFrom: number;
  sent: number;
  received: number;
  total: number;
  devices: UsageDevice[];
};

const navigation = [
  { id: "overview", label: "Overview" },
  { id: "devices", label: "Devices" },
  { id: "topology", label: "Network Map" },
  { id: "traffic", label: "Traffic" },
  { id: "domains", label: "Domains & apps" },
  { id: "activity", label: "Activity" },
  { id: "routers", label: "Routers & APs" },
  { id: "settings", label: "Settings" },
] as const;

const titles: Record<View, { title: string; subtitle: string }> = {
  overview: { title: "Home overview", subtitle: "Here’s what is happening across your home network." },
  devices: { title: "Every device", subtitle: "Live and remembered clients from across all access points." },
  topology: { title: "Network Map", subtitle: "Live AP-based device locations across the connected buildings." },
  traffic: { title: "Traffic & usage", subtitle: "Per-device bandwidth and application visibility." },
  domains: { title: "Domains & apps", subtitle: "Private, local DNS activity and service categories." },
  activity: { title: "Activity", subtitle: "A calm, searchable timeline of devices and network changes." },
  routers: { title: "Routers & access points", subtitle: "Health checks and one-click access to every homepage." },
  settings: { title: "Settings", subtitle: "Collectors, privacy, retention, and optional integrations." },
};

function greetingTitle() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return displayName ? `${greeting}, ${displayName}` : greeting;
}

function AnimatedNavIcon({ type, isActive, size = 20 }: { type: View; isActive: boolean; size?: number }) {
  const iconRef = useRef<SVGSVGElement>(null);
  const wasActive = useRef(isActive);

  useEffect(() => {
    const icon = iconRef.current;
    if (!icon) return;

    if (!isActive) {
      icon.removeAttribute("data-animate");
      wasActive.current = false;
      return;
    }

    if (!wasActive.current) {
      icon.querySelectorAll<SVGGeometryElement>("[data-draw]").forEach((part) => {
        part.style.setProperty("--path-length", `${Math.ceil(part.getTotalLength()) + 1}`);
      });
      icon.removeAttribute("data-animate");
      void icon.getBoundingClientRect();
      icon.dataset.animate = "true";
    }
    wasActive.current = isActive;
  }, [isActive]);

  const common = {
    ref: iconRef,
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: `animated-nav-icon nav-icon-${type}`,
    "aria-hidden": true,
  };

  if (type === "overview") {
    return (
      <svg {...common}>
        <rect data-draw className="overview-box box-1" x="3" y="3" width="7" height="7" rx="1.2" />
        <rect data-draw className="overview-box box-2" x="14" y="3" width="7" height="7" rx="1.2" />
        <rect data-draw className="overview-box box-3" x="3" y="14" width="7" height="7" rx="1.2" />
        <rect data-draw className="overview-box box-4" x="14" y="14" width="7" height="7" rx="1.2" />
      </svg>
    );
  }

  if (type === "devices") {
    return (
      <svg {...common}>
        <rect data-draw className="phone-body" x="6" y="2" width="12" height="20" rx="2.6" />
        <circle className="phone-home" cx="12" cy="18.5" r=".8" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  if (type === "topology") {
    return (
      <svg {...common}>
        <path data-draw className="network-line line-root" d="M12 6.5v5" />
        <path data-draw className="network-line line-left" d="M12 11.5H5v4" />
        <path data-draw className="network-line line-right" d="M12 11.5h7v4" />
        <circle className="network-node node-root" cx="12" cy="4" r="2.4" />
        <circle className="network-node node-left" cx="5" cy="18" r="2.4" />
        <circle className="network-node node-right" cx="19" cy="18" r="2.4" />
      </svg>
    );
  }

  if (type === "traffic") {
    return (
      <svg {...common}>
        <path data-draw className="gauge-arc" d="M3 18a9 9 0 0 1 18 0" />
        <path className="gauge-needle" d="M12 18l5-7" />
        <circle cx="12" cy="18" r="1.2" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  if (type === "domains") {
    return (
      <svg {...common}>
        <g className="globe-spin">
          <circle data-draw className="globe-outer" cx="12" cy="12" r="9" />
          <path data-draw className="globe-line globe-meridian-1" d="M12 3c3 3 3 15 0 18" />
          <path data-draw className="globe-line globe-meridian-2" d="M12 3c-3 3-3 15 0 18" />
          <path data-draw className="globe-line globe-latitude-1" d="M4.4 7.4c4.5 2 10.7 2 15.2 0" />
          <path data-draw className="globe-line globe-latitude-2" d="M4.4 16.6c4.5-2 10.7-2 15.2 0" />
        </g>
      </svg>
    );
  }

  if (type === "activity") {
    return (
      <svg {...common}>
        <circle data-draw className="clock-ring" cx="12" cy="12" r="8" />
        <g className="clock-hands">
          <path d="M12 7v5l3 2" />
        </g>
        <path data-draw className="history-arrow" d="M4.4 6.2H8m-3.6 0v-3M4.4 6.2A9 9 0 1 1 3 14" />
      </svg>
    );
  }

  if (type === "routers") {
    return (
      <svg {...common}>
        <rect data-draw className="router-body" x="3" y="13" width="18" height="7" rx="2" />
        <path data-draw className="router-body router-feet" d="M7 20v2m10-2v2" />
        <circle cx="7" cy="16.5" r=".8" fill="currentColor" stroke="none" />
        <path className="signal-wave wave-1" d="M10.2 10.2a2.6 2.6 0 0 1 3.6 0" />
        <path className="signal-wave wave-2" d="M7.6 7.6a6.2 6.2 0 0 1 8.8 0" />
        <path className="signal-wave wave-3" d="M5 5a9.9 9.9 0 0 1 14 0" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <g className="settings-gear">
        <path d="M12 2.5l1.1 2.2 2.4.7 2-1.2 2.3 2.3-1.2 2 .7 2.4 2.2 1.1-1.1 3.1-2.4.3-1.5 1.9.2 2.4-3 1.4-1.7-1.8-2.5-.1-1.7 1.8-3-1.4.2-2.4-1.5-1.9-2.4-.3L2.5 12l2.2-1.1.7-2.4-1.2-2 2.3-2.3 2 1.2 2.4-.7L12 2.5z" />
        <circle cx="12" cy="12" r="3.2" />
      </g>
    </svg>
  );
}

function DeviceGlyph({ kind, size = 19 }: { kind: string; size?: number }) {
  const normalized = kind.toLowerCase();
  if (normalized.includes("phone") || normalized === "mobile") return <Smartphone size={size} />;
  if (normalized.includes("tablet")) return <Tablet size={size} />;
  if (normalized.includes("laptop")) return <Laptop size={size} />;
  if (normalized.includes("computer") || normalized.includes("desktop")) return <Monitor size={size} />;
  if (normalized.includes("tv")) return <Tv size={size} />;
  if (normalized.includes("printer")) return <Printer size={size} />;
  if (normalized.includes("camera")) return <Camera size={size} />;
  if (normalized.includes("game") || normalized.includes("console")) return <Gamepad2 size={size} />;
  if (normalized.includes("watch") || normalized.includes("wearable")) return <Watch size={size} />;
  if (normalized.includes("speaker")) return <Speaker size={size} />;
  if (normalized.includes("iot") || normalized.includes("smart")) return <Lightbulb size={size} />;
  if (normalized.includes("infrastructure") || normalized.includes("router")) return <Router size={size} />;
  return <CircleHelp size={size} />;
}

function timeText(value: number) {
  if (!value) return "Not yet";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index > 2 ? 2 : 1)} ${units[index]}`;
}

export function NetworkDashboard({
  cloudMode = false,
  authRequired = false,
  userEmail = "",
  initialSnapshot = null,
}: {
  cloudMode?: boolean;
  authRequired?: boolean;
  userEmail?: string;
  initialSnapshot?: Snapshot | null;
}) {
  const [view, setView] = useState<View>("overview");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(initialSnapshot);
  const [error, setError] = useState("");
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selected, setSelected] = useState<Device | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [accent, setAccent] = useState<AccentTheme>("mint");
  const [fontChoice, setFontChoice] = useState<FontChoice>("modern");
  const [houseNames, setHouseNames] = useState<HouseNames>(defaultHouseNames);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [greeting, setGreeting] = useState(displayName ? `Welcome, ${displayName}` : "Welcome");
  const [connectionToasts, setConnectionToasts] = useState<ConnectionToast[]>([]);
  const previousDevices = useRef<Map<string, Device> | null>(null);
  const toastKeys = useRef(new Set<string>());
  const lastRecoveryLoad = useRef(0);
  const notificationsEnabledRef = useRef(true);

  useEffect(() => {
    if (!initialSnapshot) return;
    previousDevices.current = new Map(initialSnapshot.devices.map((device) => [device.mac, device]));
    const frame = window.requestAnimationFrame(() => {
      setSnapshot((current) => !current || initialSnapshot.generatedAt >= current.generatedAt ? initialSnapshot : current);
      setError("");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialSnapshot]);

  useEffect(() => {
    if (initialSnapshot) return;
    let frame = 0;
    try {
      const cached = window.localStorage.getItem("homescope-last-snapshot");
      if (!cached) return;
      const saved = JSON.parse(cached) as Snapshot;
      if (!saved?.generatedAt || !Array.isArray(saved.devices)) return;
      previousDevices.current = new Map(saved.devices.map((device) => [device.mac, device]));
      frame = window.requestAnimationFrame(() => setSnapshot(saved));
    } catch {
      window.localStorage.removeItem("homescope-last-snapshot");
    }
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [initialSnapshot]);

  useEffect(() => {
    if (snapshot) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setLoadingSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [snapshot]);

  const applySnapshot = useCallback((nextSnapshot: Snapshot) => {
    const previous = previousDevices.current;
    if (previous) {
      for (const device of nextSnapshot.devices) {
        const old = previous.get(device.mac);
        const justConnected = device.status === "online" && Boolean(device.ap_id)
          && (!old || old.status !== "online" || old.ap_id !== device.ap_id);
        const key = `${device.mac}:${device.last_changed}:${device.ap_id}`;
        if (notificationsEnabledRef.current && justConnected && !toastKeys.current.has(key)) {
          toastKeys.current.add(key);
          const toast = { id: key, name: device.displayName, kind: device.kind, router: device.apName };
          setConnectionToasts((current) => [...current.slice(-2), toast]);
          window.setTimeout(() => {
            setConnectionToasts((current) => current.filter((item) => item.id !== key));
          }, 3000);
        }
      }
    }
    previousDevices.current = new Map(nextSnapshot.devices.map((device) => [device.mac, device]));
    setSnapshot(nextSnapshot);
    try {
      window.localStorage.setItem("homescope-last-snapshot", JSON.stringify(nextSnapshot));
    } catch {
      // Live data still works when private browsing blocks local storage.
    }
    setError("");
  }, []);

  const load = useCallback(async (quiet = false) => {
    try {
      const response = await fetch(`${API}/api/snapshot`, { cache: "no-store" });
      if (!response.ok) throw new Error("Collector did not respond");
      applySnapshot(await response.json() as Snapshot);
      return true;
    } catch {
      if (!quiet) setError(cloudMode ? "The home collector is temporarily unavailable" : "The local collector is unavailable");
      return false;
    }
  }, [applySnapshot, cloudMode]);

  useEffect(() => {
    const stored = window.localStorage.getItem("homescope-theme");
    const storedAccent = window.localStorage.getItem("homescope-accent") as AccentTheme | null;
    const storedFont = window.localStorage.getItem("homescope-font") as FontChoice | null;
    const preferred = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const nextTheme = stored === "dark" || stored === "light" ? stored : preferred;
    const frame = window.requestAnimationFrame(() => {
      setTheme(nextTheme);
      if (storedAccent) setAccent(storedAccent);
      if (storedFont) setFontChoice(storedFont);
      document.documentElement.dataset.theme = nextTheme;
      document.documentElement.dataset.accent = storedAccent || "mint";
      document.documentElement.dataset.font = storedFont || "modern";
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let nextNames = defaultHouseNames;
    let enabled = true;
    try {
      const storedNames = window.localStorage.getItem("homescope-house-names");
      if (storedNames) {
        const parsed = JSON.parse(storedNames) as Partial<HouseNames>;
        nextNames = {
          houseC: parsed.houseC?.trim() || defaultHouseNames.houseC,
          houseB: parsed.houseB?.trim() || defaultHouseNames.houseB,
          houseA: parsed.houseA?.trim() || defaultHouseNames.houseA,
          main: parsed.main?.trim() || defaultHouseNames.main,
        };
      }
      enabled = window.localStorage.getItem("homescope-connection-notifications") !== "false";
      notificationsEnabledRef.current = enabled;
    } catch {
      // Invalid local preferences fall back to the safe defaults.
    }
    const frame = window.requestAnimationFrame(() => {
      setHouseNames(nextNames);
      setNotificationsEnabled(enabled);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const stream = new EventSource(`${API}/api/snapshot/stream`);
    stream.addEventListener("snapshot", (event) => {
      try {
        applySnapshot(JSON.parse((event as MessageEvent<string>).data) as Snapshot);
      } catch {
        // Ignore one malformed frame; the persistent stream remains connected.
      }
    });
    stream.onopen = () => setError("");
    stream.onerror = () => {
      setError(cloudMode ? "The home collector is temporarily unavailable" : "The local collector is unavailable");
      const now = Date.now();
      if (now - lastRecoveryLoad.current >= 5000) {
        lastRecoveryLoad.current = now;
        void load(true);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && stream.readyState === EventSource.CLOSED) {
        void load(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stream.close();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [applySnapshot, cloudMode, load]);

  useEffect(() => {
    const updateGreeting = () => setGreeting(greetingTitle());
    updateGreeting();
    const timer = window.setInterval(updateGreeting, 60000);
    return () => window.clearInterval(timer);
  }, []);

  async function scan() {
    setScanning(true);
    try {
      await fetch(`${API}/api/scan`, { method: "POST" });
      window.setTimeout(() => load(true), 2200);
    } finally {
      window.setTimeout(() => setScanning(false), 1800);
    }
  }

  function navigate(next: View) {
    setView(next);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    window.localStorage.setItem("homescope-theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }

  function changeAccent(nextAccent: AccentTheme) {
    setAccent(nextAccent);
    window.localStorage.setItem("homescope-accent", nextAccent);
    document.documentElement.dataset.accent = nextAccent;
  }

  function changeFont(nextFont: FontChoice) {
    setFontChoice(nextFont);
    window.localStorage.setItem("homescope-font", nextFont);
    document.documentElement.dataset.font = nextFont;
  }

  function saveHouseNames(nextNames: HouseNames) {
    const normalized = {
      houseC: nextNames.houseC.trim() || defaultHouseNames.houseC,
      houseB: nextNames.houseB.trim() || defaultHouseNames.houseB,
      houseA: nextNames.houseA.trim() || defaultHouseNames.houseA,
      main: nextNames.main.trim() || defaultHouseNames.main,
    };
    setHouseNames(normalized);
    window.localStorage.setItem("homescope-house-names", JSON.stringify(normalized));
  }

  function changeNotifications(enabled: boolean) {
    notificationsEnabledRef.current = enabled;
    setNotificationsEnabled(enabled);
    window.localStorage.setItem("homescope-connection-notifications", String(enabled));
    if (!enabled) setConnectionToasts([]);
  }

  const current = view === "overview" ? { ...titles.overview, title: greeting } : titles[view];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <Image src="/homescope-icon.png?v=3" alt="" width={44} height={44} priority unoptimized />
          </div>
          <div>
            <strong>HomeScope</strong>
            <span>Private network monitor</span>
          </div>
          <button className="icon-button mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><X size={20} /></button>
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          <p className="nav-kicker">Workspace</p>
          {navigation.map((item) => {
            const active = view === item.id;
            return (
              <button
                key={item.id}
                className={`nav-item${active ? " active" : ""}`}
                onClick={() => navigate(item.id)}
              >
                <AnimatedNavIcon type={item.id} isActive={active} size={19} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <div className="privacy-card">
            <div className="privacy-icon"><ShieldCheck size={19} /></div>
          <div>
            <strong>{cloudMode ? "Encrypted cloud access" : "Local & private"}</strong>
            <p>{cloudMode ? "Your dashboard connects securely to your private collector." : "HomeScope’s database stays on this Mac."}</p>
            </div>
          </div>
          <div className="collector-status">
            <span className={`status-dot ${error ? "dot-warn" : "dot-online"}`} />
            <span>{error ? "Collector connecting" : "Collector active"}</span>
            <small>{snapshot ? timeText(snapshot.generatedAt) : "—"}</small>
          </div>
        </div>
      </aside>

      {sidebarOpen ? <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close menu" /> : null}

      <main className="main">
        <header className="topbar">
          <div className="title-wrap">
            <button className="icon-button menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={21} /></button>
            <div>
              <h1>{current.title}</h1>
              <p>{current.subtitle}</p>
            </div>
          </div>
          <div className="header-actions">
            <div className="live-pill"><span className="status-dot dot-online" /> Live</div>
            <button className="button secondary theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
              <span>{theme === "dark" ? "Light" : "Dark"}</span>
            </button>
            <button className="button secondary" onClick={scan} disabled={scanning}>
              <RefreshCw size={17} className={scanning ? "spin" : ""} />
              <span>{scanning ? "Scanning" : "Scan now"}</span>
            </button>
            {authRequired ? (
              <form action="/api/auth/logout" method="post" title={userEmail}>
                <button className="button secondary signout-button" type="submit" aria-label="Sign out">
                  <LogOut size={17} /><span>Sign out</span>
                </button>
              </form>
            ) : null}
          </div>
        </header>

        {error && !snapshot ? (
          <div className="connection-banner">
            <RefreshCw size={18} className="spin" />
            <div><strong>{error}</strong><span>The page will connect automatically. You can keep it open.</span></div>
          </div>
        ) : null}

        <div className="page-content">
          {!snapshot ? <LoadingView seconds={loadingSeconds} /> : (
            <>
              {view === "overview" && <Overview data={snapshot} navigate={navigate} selectDevice={setSelected} />}
              {view === "devices" && <Devices data={snapshot} selectDevice={setSelected} />}
              {view === "topology" && <Topology data={snapshot} selectDevice={setSelected} houseNames={houseNames} />}
              {view === "traffic" && <Traffic data={snapshot} navigate={navigate} />}
              {view === "domains" && <Domains data={snapshot} navigate={navigate} />}
              {view === "activity" && <ActivityTimeline data={snapshot} reload={load} />}
              {view === "routers" && <Routers data={snapshot} />}
              {view === "settings" && <SettingsView data={snapshot} reload={load} accent={accent} fontChoice={fontChoice} onAccent={changeAccent} onFont={changeFont} cloudMode={cloudMode} houseNames={houseNames} onSaveHouseNames={saveHouseNames} notificationsEnabled={notificationsEnabled} onNotificationsEnabled={changeNotifications} />}
            </>
          )}
        </div>
      </main>

      <nav className="bottom-nav" aria-label="Mobile navigation">
        {navigation.slice(0, 5).map((item) => {
          const active = view === item.id;
          return <button key={item.id} className={active ? "active" : ""} onClick={() => navigate(item.id)}><AnimatedNavIcon type={item.id} isActive={active} size={20} /><span>{item.label.replace("Network Map", "Map").replace("Domains & apps", "Domains")}</span></button>;
        })}
      </nav>

      {selected ? <DeviceDrawer device={selected} routers={snapshot?.routers || []} usagePeriods={snapshot?.traffic.periods} onClose={() => setSelected(null)} onSaved={async () => { await load(true); setSelected(null); }} /> : null}
      <div className="connection-toast-stack" aria-live="polite">
        {connectionToasts.map((toast) => (
          <div className="connection-toast" key={toast.id}>
            <div className="toast-icon-wrap">
              <i className="toast-wifi-ripple toast-wifi-ripple-one" aria-hidden="true" />
              <i className="toast-wifi-ripple toast-wifi-ripple-two" aria-hidden="true" />
              <div className="toast-device-icon"><DeviceGlyph kind={toast.kind} size={22} /></div>
            </div>
            <div><span>NEW CONNECTION</span><strong>{toast.name}</strong><p>Online and connected to <b>{toast.router}</b></p></div>
            <button onClick={() => setConnectionToasts((current) => current.filter((item) => item.id !== toast.id))} aria-label="Dismiss notification"><X size={18} /></button>
            <i />
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingView({ seconds }: { seconds: number }) {
  const phase = seconds < 2
    ? "Verifying your secure session"
    : seconds < 5
      ? "Connecting through the encrypted relay"
      : "Waiting for the latest LAN scan";
  return (
    <div className="loading-state">
      <div className="loading-clock"><RefreshCw size={22} className="spin" /><strong>{seconds}s</strong></div>
      <div>
        <span>LOADING LIVE DATA</span>
        <h2>{phase}</h2>
        <p>The timer measures the actual wait. HomeScope will display the server snapshot as soon as it arrives.</p>
      </div>
      <div className="loading-grid">
        {[1, 2, 3, 4].map((item) => <div className="skeleton-card" key={item}><span /><b /><i /></div>)}
      </div>
    </div>
  );
}

function Overview({ data, navigate, selectDevice }: { data: Snapshot; navigate: (view: View) => void; selectDevice: (device: Device) => void }) {
  const recent = data.devices.slice(0, 6);
  const noteworthy = data.events.filter((event) => !event.acknowledged).slice(0, 4);
  const routerHealth = data.summary.routersOnline === data.summary.routersTotal;

  return (
    <div className="view-stack">
      <section className="metric-grid overview-metrics">
        <Metric
          icon={Wifi}
          tone="mint"
          ripple="online"
          live
          label="Online now"
          value={data.summary.online}
          detail={`${data.summary.verifiedAssociations} router-verified · ${data.summary.online - data.summary.verifiedAssociations} seen on LAN only`}
        />
        <Metric icon={WifiOff} tone="slate" ripple="offline" label="Offline" value={data.summary.offline} detail="kept in device history" />
        <Metric icon={Router} tone="mint" ripple="network" label="Network points" value={`${data.summary.routersOnline}/${data.summary.routersTotal}`} detail={routerHealth ? "All router homepages reachable" : "One or more need attention"} />
      </section>

      <section className="overview-grid">
        <div className="panel network-panel">
          <PanelHeader title="Your network" subtitle="Live path from fiber to AP3" action="Open map" onAction={() => navigate("topology")} />
          <div className="mini-topology">
            {data.routers.map((router, index) => (
              <div className="mini-node-wrap" key={router.id}>
                <div className="mini-node">
                  <div className={`node-icon ${router.status}`}><Router size={20} /></div>
                  <div><strong>{router.name}</strong><span>{router.role}</span><small>{router.ip}</small></div>
                </div>
                {index < data.routers.length - 1 ? (
                  <div className={`topology-link ${router.status === "online" && data.routers[index + 1]?.status === "online" ? "flowing" : ""}`}>
                    <i />
                    <b className="flow-packet downstream" aria-hidden="true" />
                    <b className="flow-packet upstream" aria-hidden="true" />
                    <span>LAN</span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className={routerHealth ? "health-strip healthy" : "health-strip warning"}>
            {routerHealth ? <Check size={17} /> : <AlertTriangle size={17} />}
            <span>{routerHealth ? "Every router and access point is reachable" : "A network point is not responding"}</span>
            <small>Checked {timeText(data.generatedAt)}</small>
          </div>
        </div>

        <div className="panel readiness-panel">
          <PanelHeader title="Visibility" subtitle="What HomeScope can see" />
          <ReadinessRow icon={Network} title="Devices & uptime" state="Active" active detail="LAN collector" />
          <ReadinessRow icon={Globe2} title="Domain history" state={data.integrations.dns.status === "configured" ? "Connected" : "Add sensor"} active={data.integrations.dns.status === "configured"} detail={data.integrations.dns.provider || "NextDNS / Pi-hole / AdGuard"} />
          <ReadinessRow icon={Gauge} title="Usage & apps" state={data.integrations.traffic.status === "configured" ? "Connected" : "Add sensor"} active={data.integrations.traffic.status === "configured"} detail="ntopng" />
          <button className="text-button" onClick={() => navigate("settings")}>Configure sensors <ChevronRight size={16} /></button>
        </div>
      </section>

      <section className="overview-grid lower">
        <div className="panel">
          <PanelHeader title="Recently seen" subtitle="Latest devices across the network" action="View all" onAction={() => navigate("devices")} />
          <div className="device-list">
            {recent.map((device) => <DeviceListRow key={device.mac} device={device} onClick={() => selectDevice(device)} />)}
          </div>
        </div>
        <div className="panel">
          <PanelHeader title="Recent activity" subtitle="Changes across your network" action="View timeline" onAction={() => navigate("activity")} />
          {noteworthy.length ? (
            <div className="event-list">
              {noteworthy.map((event) => <EventItem event={event} key={event.id} />)}
            </div>
          ) : (
            <EmptyCompact icon={ShieldCheck} title="Everything looks calm" text="No recent device or network changes." />
          )}
        </div>
      </section>
    </div>
  );
}

function LiveOdometer({ value }: { value: number }) {
  const nextValue = String(value);
  const currentValue = useRef(nextValue);
  const timer = useRef<number | null>(null);
  const [frame, setFrame] = useState({ from: nextValue, to: nextValue, key: 0, animating: false });

  useEffect(() => {
    if (nextValue === currentValue.current) return;
    const from = currentValue.current;
    currentValue.current = nextValue;
    if (timer.current) window.clearTimeout(timer.current);
    setFrame((current) => ({ from, to: nextValue, key: current.key + 1, animating: true }));
    timer.current = window.setTimeout(() => {
      setFrame((current) => current.to === nextValue
        ? { from: nextValue, to: nextValue, key: current.key, animating: false }
        : current);
    }, 330);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [nextValue]);

  const length = Math.max(frame.from.length, frame.to.length);
  const fromDigits = frame.from.padStart(length, "\u2007").split("");
  const toDigits = frame.to.padStart(length, "\u2007").split("");

  return (
    <span className="live-odometer" aria-label={`${value} devices online`} aria-live="polite">
      <span aria-hidden="true">
        {toDigits.map((digit, index) => {
          const previous = fromDigits[index];
          const changed = frame.animating && previous !== digit;
          return changed ? (
            <span className="odometer-digit-window" key={`${frame.key}-${index}`}>
              <span className="odometer-digit-old">{previous}</span>
              <span className="odometer-digit-new">{digit}</span>
            </span>
          ) : <span className="odometer-digit-static" key={`static-${index}`}>{digit}</span>;
        })}
      </span>
    </span>
  );
}

function Metric({
  icon: Icon,
  tone,
  ripple,
  live = false,
  label,
  value,
  detail,
}: {
  icon: typeof Wifi;
  tone: string;
  ripple?: "online" | "offline" | "network";
  live?: boolean;
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className={`metric-card${ripple ? ` metric-${ripple}` : ""}`}>
      <div className="metric-icon-slot">
        {ripple ? (
          <span className="metric-ripple-layer" aria-hidden="true">
            <i className="metric-ripple ripple-one" />
            {ripple !== "offline" ? <i className="metric-ripple ripple-two" /> : null}
          </span>
        ) : null}
        <div className={`metric-icon ${tone}`}><Icon size={21} /></div>
      </div>
      <div className="metric-label">{label}</div>
      <strong className="metric-value">{live ? <LiveOdometer value={Number(value)} /> : value}</strong>
      <span className="metric-detail">{detail}</span>
    </div>
  );
}

function PanelHeader({ title, subtitle, action, onAction }: { title: string; subtitle: string; action?: string; onAction?: () => void }) {
  return (
    <div className="panel-header">
      <div><h2>{title}</h2><p>{subtitle}</p></div>
      {action ? <button className="text-button" onClick={onAction}>{action} <ChevronRight size={16} /></button> : null}
    </div>
  );
}

function ReadinessRow({ icon: Icon, title, state, active, detail }: { icon: typeof Wifi; title: string; state: string; active: boolean; detail: string }) {
  return (
    <div className="readiness-row">
      <div className="readiness-icon"><Icon size={18} /></div>
      <div><strong>{title}</strong><span>{detail}</span></div>
      <b className={active ? "sensor-state active" : "sensor-state"}>{active ? <Check size={13} /> : <Unplug size={13} />}{state}</b>
    </div>
  );
}

function DeviceListRow({ device, onClick }: { device: Device; onClick: () => void }) {
  return (
    <button className="device-row" onClick={onClick}>
      <div className="device-avatar"><DeviceGlyph kind={device.kind} /></div>
      <div className="device-main"><strong>{device.displayName}</strong><span>{device.kind} · {device.ip}</span></div>
      <div className="device-state"><span className={`status-dot ${device.status === "online" ? "dot-online" : "dot-offline"}`} /><span>{device.status === "online" ? "Online" : device.lastSeenText}</span></div>
      <ChevronRight size={17} className="row-arrow" />
    </button>
  );
}

function Devices({ data, selectDevice }: { data: Snapshot; selectDevice: (device: Device) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "online" | "offline" | "unknown">("online");
  const [routerFilter, setRouterFilter] = useState("all");

  const devices = useMemo(() => data.devices.filter((device) => {
    const text = `${device.displayName} ${device.ip} ${device.mac} ${device.hostname} ${device.owner} ${device.apName} ${device.vendor}`.toLowerCase();
    if (!text.includes(query.toLowerCase())) return false;
    if (routerFilter === "unverified" && device.associationVerified) return false;
    if (routerFilter !== "all" && routerFilter !== "unverified" && device.ap_id !== routerFilter) return false;
    if (filter === "unknown") {
      const name = device.displayName.toLowerCase();
      return name.includes("unknown") || name.includes("private") || name.startsWith("device ");
    }
    return filter === "all" || device.status === filter;
  }), [data.devices, filter, query, routerFilter]);

  return (
    <div className="view-stack">
      <div className="toolbar-card">
        <label className="search-field"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search devices" /></label>
        <div className="filter-pills">
          {[
            ["online", `Online now ${data.summary.online}`],
            ["unknown", `Needs a name ${data.summary.unrecognized}`],
            ["offline", `Offline history ${data.summary.offline}`],
            ["all", `All records ${data.summary.total}`],
          ].map(([id, label]) => <button key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id as typeof filter)}>{label}</button>)}
        </div>
        <a className="button secondary export-button" href={`${API}/api/export/devices.csv`}><Download size={17} />Export CSV</a>
      </div>

      <div className="online-explainer">
        <ShieldCheck size={18} />
        <div><strong>Presence and router assignment are now separate</strong><span>“Online” means HomeScope saw the device on the LAN. A router name is marked verified only when that router’s own fresh client table reports it.</span></div>
      </div>

      <div className="router-presence-grid" aria-label="Online devices by router">
        {data.routers.map((router) => {
          return (
            <button key={router.id} className={routerFilter === router.id ? "active" : ""} onClick={() => setRouterFilter(routerFilter === router.id ? "all" : router.id)}>
              <i><Router size={19} /></i>
              <span>
                <strong>{router.name}</strong>
                <small>{router.clientDataAvailable ? `${router.downstreamClients} downstream through this path` : router.clientDataStatus === "pending" ? "Checking client table" : `${router.downstreamClients} verified downstream`}</small>
                <small className={`router-live-read ${router.clientDataAvailable ? "verified" : "unavailable"}`}>
                  {router.clientDataAvailable ? `Live table · ${timeText(router.clientDataCheckedAt)}` : `Table unavailable · ${timeText(router.clientDataCheckedAt)}`}
                </small>
              </span>
              <b>{router.clientDataAvailable ? router.directClients : "—"}<small>{router.clientDataAvailable ? "direct" : "direct unknown"}</small></b>
            </button>
          );
        })}
        <button className={`unverified ${routerFilter === "unverified" ? "active" : ""}`} onClick={() => setRouterFilter(routerFilter === "unverified" ? "all" : "unverified")}>
          <i><ShieldQuestion size={19} /></i>
          <span><strong>Not directly verified</strong><small>Online on LAN; router did not report it</small></span>
          <b>{data.summary.online - data.summary.verifiedAssociations}<small>devices</small></b>
        </button>
      </div>

      <div className="panel table-panel">
        <div className="table-meta">
          <span>{devices.length} {filter === "online" ? "devices online now" : filter === "offline" ? "historical connections" : "device records"}</span>
          <small>Last scan {timeText(data.generatedAt)}</small>
        </div>
        <div className="device-table simple-device-table">
          <div className="device-table-head"><span>Device</span><span>Status</span><span>Connected through</span><span>IP address</span><span>Last confirmed</span><span /></div>
          {devices.map((device) => {
            return (
              <button className="device-table-row" key={device.mac} onClick={() => selectDevice(device)}>
                <span className="table-device"><i><DeviceGlyph kind={device.kind} size={18} /></i><b>{device.displayName}<small>{device.kind}</small></b></span>
                <span className={`table-status ${device.status}`}><i />{device.status}</span>
                <span className={`route-cell ${device.association_trust}`}><b>{device.associationVerified ? device.apName : device.apName || "Router not identified"}</b><small>{device.associationTrustLabel}{device.associationSeenText ? ` · ${device.associationSeenText}` : ""}</small></span>
                <span className="mono-cell">{device.ip}<small>Open for technical details</small></span>
                <span>{device.status === "online" ? "Just now" : device.lastSeenText}<small>{device.status === "online" ? device.presenceConfidence : "Not currently connected"}</small></span>
                <span><ChevronRight size={17} /></span>
              </button>
            );
          })}
        </div>
        {!devices.length ? <EmptyCompact icon={Search} title="No matching devices" text="Try a different search or filter." /> : null}
      </div>
    </div>
  );
}

const buildingMapAnchors: Record<string, { x: number; y: number }> = {
  slt: { x: 11, y: 80 },
  zlt: { x: 40, y: 80 },
  dlink: { x: 68, y: 61 },
  tplink: { x: 86, y: 29 },
};

const deviceMapAreas: Record<string, { left: number; top: number; width: number; height: number; columns: number }> = {
  slt: { left: 21, top: 61, width: 16, height: 12, columns: 4 },
  zlt: { left: 37, top: 66, width: 7, height: 6, columns: 2 },
  dlink: { left: 62, top: 70, width: 14, height: 10, columns: 2 },
  tplink: { left: 78, top: 34, width: 19, height: 7, columns: 2 },
};

function deviceMapPosition(device: Device, index: number, total: number) {
  const area = deviceMapAreas[device.ap_id];
  if (!area) return null;
  const columns = Math.min(area.columns, Math.max(1, total));
  const rows = Math.max(1, Math.ceil(total / columns));
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: area.left + ((column + 0.5) * area.width) / columns,
    y: area.top + ((row + 0.5) * area.height) / rows,
  };
}

function Topology({ data, selectDevice, houseNames }: { data: Snapshot; selectDevice: (device: Device) => void; houseNames: HouseNames }) {
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState(true);
  const [mapDevice, setMapDevice] = useState<Device | null>(null);
  const mapViewport = useRef<HTMLDivElement>(null);
  const onlineDevices = data.devices.filter((device) => device.status === "online");
  const mapDevices = [
    ...onlineDevices.filter((device) => !houseCDevicePosition(device)),
    ...data.devices.filter((device) => houseCDevicePosition(device)),
  ];
  const locatedDevices = Object.keys(buildingMapAnchors).flatMap((routerId) => {
    const devices = mapDevices
      .filter((device) => device.ap_id === routerId)
      .sort((left, right) => left.mac.localeCompare(right.mac));
    return devices
      .map((device, index) => ({ device, position: deviceMapPosition(device, index, devices.length) }))
      .filter((item): item is { device: Device; position: { x: number; y: number } } => Boolean(item.position));
  });
  const locatedOnlineDevices = locatedDevices.filter(({ device }) => device.status === "online").length;
  const unlocated = onlineDevices.length - locatedOnlineDevices;
  const connectedDevices = (routerId: string) => onlineDevices.filter((device) => device.ap_id === routerId && device.associationVerified).length;
  const changeZoom = (amount: number) => {
    setFitMode(false);
    setZoom((current) => Math.min(1.75, Math.max(0.25, Number((current + amount).toFixed(2)))));
  };
  const fitMap = () => {
    const viewportWidth = mapViewport.current?.clientWidth || 1200;
    setFitMode(true);
    setZoom(Math.min(1, Math.max(0.25, Number((viewportWidth / 1200).toFixed(2)))));
  };

  useEffect(() => {
    const viewport = mapViewport.current;
    if (!viewport || !fitMode) return;
    const applyFit = () => {
      setZoom(Math.min(1, Math.max(0.25, Number((viewport.clientWidth / 1200).toFixed(2)))));
    };
    const frame = window.requestAnimationFrame(applyFit);
    const observer = new ResizeObserver(applyFit);
    observer.observe(viewport);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fitMode]);

  return (
    <div className="view-stack">
      <section className="panel building-map-panel">
        <div className="building-map-toolbar">
          <div>
            <span className="eyebrow">YOUR DRAWING, DIGITIZED</span>
            <h3>Home network location map</h3>
          </div>
          <div className="map-toolbar-actions">
            <div className="map-live-status"><span className="status-dot dot-online" />Live <small>{timeText(data.generatedAt)}</small></div>
            <div className="map-zoom-controls" aria-label="Map zoom controls">
              <button type="button" onClick={() => changeZoom(-0.2)} disabled={zoom <= 0.25} aria-label="Zoom out"><Minus size={16} /></button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => changeZoom(0.2)} disabled={zoom >= 1.75} aria-label="Zoom in"><Plus size={16} /></button>
              <button className="map-fit-button" type="button" onClick={fitMap} aria-label="Fit map"><Maximize2 size={15} /><span>Fit</span></button>
            </div>
          </div>
        </div>

        <div className="building-map-scroll" ref={mapViewport}>
          <div className="building-map-stage" style={{ width: `${1200 * zoom}px`, height: `${650 * zoom}px` }}>
          <div className="building-map" style={{ transform: `scale(${zoom})` }} aria-label="Live device locations across the home network">
            <div className="house-zone zone-house-c"><strong><House size={18} />{houseNames.houseC}</strong></div>
            <div className="house-zone zone-house-b"><strong><House size={18} />{houseNames.houseB}</strong></div>
            <div className="house-zone zone-house-a"><strong><House size={18} />{houseNames.houseA}</strong></div>
            <div className="house-zone zone-main"><strong><Building2 size={18} />{houseNames.main}</strong></div>

            <svg className="building-connections" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <path className="map-lan-path" d="M11 80H40H68V61H86V29" />
              <path className="map-wireless-path" d="M11 80H2V42H9" />
            </svg>
            <div className="wireless-hop-icon"><Wifi size={17} /></div>

            {data.routers.map((router) => {
              const anchor = buildingMapAnchors[router.id];
              if (!anchor) return null;
              return (
                <a
                  className={`map-ap map-ap-${router.id} ${router.status}`}
                  href={router.admin_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ left: `${anchor.x}%`, top: `${anchor.y}%` }}
                  key={router.id}
                  title={`Open ${router.name} at ${router.ip}`}
                >
                  <span className="map-ap-coverage" aria-hidden="true" />
                  <i><Router size={19} /></i>
                  <b>{router.name}<small>{router.id === "slt" ? "Main router" : router.role}</small></b>
                  <em>{connectedDevices(router.id)}</em>
                </a>
              );
            })}

            {locatedDevices.map(({ device, position }) => (
              <button
                className={`map-device-marker ${device.status}`}
                style={{ left: `${position.x}%`, top: `${position.y}%` }}
                key={device.mac}
                onClick={() => setMapDevice(device)}
                aria-label={`View details for ${device.displayName}`}
                title={`${device.displayName} · ${device.status === "online" ? "Online" : "Offline"} · ${device.apName} · ${device.association_signal || "Signal unavailable"}`}
              >
                <span aria-hidden="true" />
              </button>
            ))}

            <div className="building-map-legend">
              <span><i className="legend-line lan" />LAN cable path</span>
              <span><i className="legend-line wireless" />Wireless connection</span>
              <span><i className="legend-device"><Smartphone size={13} /></i>Estimated live device</span>
            </div>
          </div>
          </div>
        </div>

        {mapDevice ? (
          <div className="map-device-popup-layer" role="presentation">
            <button className="map-device-popup-scrim" type="button" onClick={() => setMapDevice(null)} aria-label="Close device details" />
            <div className="map-device-popup" role="dialog" aria-modal="true" aria-labelledby="map-device-popup-title">
              <button className="map-device-popup-close" type="button" onClick={() => setMapDevice(null)} aria-label="Close device details"><X size={18} /></button>
              <div className="map-device-popup-head">
                <div><DeviceGlyph kind={mapDevice.kind} size={25} /></div>
                <span><small>{houseCDevicePosition(mapDevice) ? "HOUSE C DEVICE" : "CONNECTED DEVICE"}</small><strong id="map-device-popup-title">{mapDevice.displayName}</strong><b><i className={`status-dot dot-${mapDevice.status}`} />{mapDevice.status === "online" ? "Online now" : `Offline · ${mapDevice.lastSeenText}`}</b></span>
              </div>
              <div className="map-device-popup-grid">
                <div><span>Device type</span><strong>{mapDevice.kind || "Unknown"}</strong></div>
                <div><span>Connected through</span><strong>{mapDevice.apName || "Not identified"}</strong></div>
                <div><span>IP address</span><code>{mapDevice.ip}</code></div>
                <div><span>Signal</span><strong>{mapDevice.association_signal || "Unavailable"}</strong></div>
                <div className="wide"><span>MAC address</span><code>{mapDevice.mac}</code></div>
              </div>
              <button className="button primary map-device-popup-action" type="button" onClick={() => { selectDevice(mapDevice); setMapDevice(null); }}>Open full device profile <ChevronRight size={16} /></button>
            </div>
          </div>
        ) : null}

        <div className="map-accuracy-note">
          <Signal size={18} />
          <div><strong>AP-zone accuracy</strong><span>Markers show the device’s confirmed access point and signal-based distance estimate—not exact GPS coordinates.</span></div>
          {unlocated ? <b>{unlocated} online {unlocated === 1 ? "device" : "devices"} awaiting an AP report</b> : <b>Every online device has an AP zone</b>}
        </div>
      </section>
    </div>
  );
}

function Traffic({ data, navigate }: { data: Snapshot; navigate: (view: View) => void }) {
  const configured = data.integrations.traffic.status === "configured";
  const [period, setPeriod] = useState<UsagePeriodKey>("day");
  const [live, setLive] = useState<LiveTraffic | null>(null);
  const usage = data.traffic.periods?.[period];
  const devices = usage?.devices || [];
  const maxDeviceUsage = Math.max(1, ...devices.map((device) => device.total));
  const liveRate = live?.totalBps ?? devices.reduce((sum, device) => sum + device.currentBps, 0);
  const activeUsageDevices = devices.filter((device) => device.total > 0);

  useEffect(() => {
    if (!configured) return;
    let stopped = false;
    async function refreshLive() {
      try {
        const response = await fetch(`${API}/api/traffic/live`, { cache: "no-store" });
        if (!response.ok) return;
        const next = await response.json() as LiveTraffic;
        if (!stopped) setLive(next);
      } catch {
        // The history view remains available if the live sensor pauses.
      }
    }
    refreshLive();
    const timer = window.setInterval(refreshLive, 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [configured]);

  return (
    <div className="view-stack">
      <div className="panel usage-toolbar">
        <div>
          <span className="eyebrow">MEASURED BY NTOPNG</span>
          <h2>Device usage history</h2>
          <p>Compare the traffic HomeScope observed today, across seven days, or across thirty days.</p>
        </div>
        <div className="range-switch" role="tablist" aria-label="Usage period">
          {([
            ["day", "Today"],
            ["week", "7 days"],
            ["month", "30 days"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={period === key}
              className={period === key ? "active" : ""}
              onClick={() => setPeriod(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="metric-grid traffic-metrics">
        <Metric icon={Gauge} tone="mint" label={`${usage?.label || "Selected period"} usage`} value={formatBytes(usage?.total || 0)} detail="download and upload combined" />
        <Metric icon={ArrowDownToLine} tone="blue" label="Downloaded" value={formatBytes(usage?.received || 0)} detail="received by measured devices" />
        <Metric icon={ArrowUpToLine} tone="amber" label="Uploaded" value={formatBytes(usage?.sent || 0)} detail="sent by measured devices" />
        <Metric icon={Activity} tone="slate" label="Live traffic rate" value={`${formatBytes(liveRate)}/s`} detail={live?.sampledAt ? `sampled ${timeText(live.sampledAt)}` : `${activeUsageDevices.length} devices with recorded usage`} />
      </div>

      {configured ? (
        <div className="panel live-traffic-panel">
          <div className="live-traffic-head">
            <div><span className="live-indicator"><i /> LIVE · 1 SECOND</span><h2>Traffic right now</h2><p>Automatically refreshed from ntopng at the fastest safe interval.</p></div>
            <strong>{formatBytes(liveRate)}<small>/second</small></strong>
          </div>
          {live?.hosts?.length ? (
            <div className="live-host-grid">
              {live.hosts.slice(0, 8).map((host) => (
                <div className="live-host" key={`${host.mac}:${host.host}`}>
                  <div className="live-host-icon"><DeviceGlyph kind={host.kind} size={19} /></div>
                  <span><strong>{host.name}</strong><small>{host.routerName} · {host.host}</small></span>
                  <b>{formatBytes(host.throughput_bps)}/s</b>
                </div>
              ))}
            </div>
          ) : <EmptyCompact icon={Activity} title={live?.error ? "Live sensor unavailable" : "Waiting for live traffic"} text={live?.error || "The next ntopng sample will appear automatically."} />}
        </div>
      ) : null}

      {configured && usage ? (
        <div className="overview-grid usage-overview">
          <div className="panel usage-ranking">
            <PanelHeader title="Highest usage" subtitle={`${usage.label} · ranked by total transferred`} />
            <div className="usage-bars">
              {devices.slice(0, 6).map((device, index) => (
                <div className="usage-bar-row" key={device.identity}>
                  <span className="usage-rank">{index + 1}</span>
                  <div className="usage-device-copy"><strong>{device.name}</strong><small>{device.host}{device.owner ? ` · ${device.owner}` : ""}</small></div>
                  <div className="usage-track"><i style={{ width: `${Math.max(2, (device.total / maxDeviceUsage) * 100)}%` }} /></div>
                  <b>{formatBytes(device.total)}</b>
                </div>
              ))}
              {!devices.length ? <EmptyCompact icon={Clock3} title="Building usage history" text="Keep HomeScope running and the first comparison will appear after two samples." /> : null}
            </div>
          </div>
          <div className="panel usage-status-card">
            <div className="usage-status-icon"><CalendarDays size={24} /></div>
            <span className="eyebrow">TRACKING COVERAGE</span>
            <h2>{usage.trackedFrom ? `Since ${new Date(usage.trackedFrom).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "Waiting for samples"}</h2>
            <p>HomeScope calculates usage from positive changes between ntopng counters. Counter resets are detected automatically.</p>
            <div className="usage-status-facts">
              <div><span>Measured hosts</span><b>{devices.length}</b></div>
              <div><span>Latest sample</span><b>{data.traffic.sampledAt ? timeText(data.traffic.sampledAt) : "—"}</b></div>
            </div>
            <button className="button secondary full-button" onClick={() => navigate("settings")}><Settings size={16} />Traffic sensor settings</button>
          </div>
        </div>
      ) : (
        <SensorSetup
          icon={Gauge}
          title="Unlock usage history"
          connected={configured}
          text="ntopng adds measured per-device upload, download, current rate, and period totals."
          note="It must see the traffic through this Mac, a mirrored switch port, network TAP, or compatible gateway."
          onClick={() => navigate("settings")}
        />
      )}

      <div className="panel honest-note">
        <Eye size={20} />
        <div><strong>Coverage matters</strong><p>This Mac’s own totals are accurate. Other Wi-Fi devices may show only broadcast traffic until ntopng receives a mirrored or gateway feed. HomeScope labels these values as measured usage instead of estimating missing traffic.</p></div>
      </div>

      {configured && usage ? (
        <div className="panel sensor-data-panel">
          <PanelHeader title="Usage by device" subtitle={`${usage.label} · ${devices.length} measured hosts`} />
          {devices.length ? (
            <div className="sensor-table">
              <div className="sensor-table-head"><span>Device</span><span>Downloaded</span><span>Uploaded</span><span>Total</span><span>Current rate</span></div>
              {devices.map((device) => (
                <div className="sensor-table-row" key={device.identity}>
                  <span><strong>{device.name}</strong><small>{device.host}{device.mac ? ` · ${device.mac}` : ""}</small></span>
                  <span>{formatBytes(device.received)}</span>
                  <span>{formatBytes(device.sent)}</span>
                  <span className="usage-total">{formatBytes(device.total)}</span>
                  <span>{formatBytes(device.currentBps)}/s</span>
                </div>
              ))}
            </div>
          ) : <EmptyCompact icon={Clock3} title="Waiting for a second sample" text="Usage is calculated from changes between ntopng samples." />}
        </div>
      ) : null}
    </div>
  );
}

function Domains({ data, navigate }: { data: Snapshot; navigate: (view: View) => void }) {
  const configured = data.integrations.dns.status === "configured";
  const [query, setQuery] = useState("");
  const domainResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data.domains.recent;
    return data.domains.recent.filter((item) =>
      `${item.domain} ${item.deviceName} ${item.client} ${item.deviceIp} ${item.routerName} ${item.status}`
        .toLowerCase()
        .includes(needle)
    );
  }, [data.domains.recent, query]);
  return (
    <div className="view-stack">
      {!configured ? (
        <div className="panel empty-feature">
          <div className="domains-illustration" role="img" aria-label="Four access points connecting a laptop, phone, and tablet" />
          <span className="eyebrow">OPTIONAL DNS SENSOR</span>
          <h2>Add private domain history</h2>
          <p>Connect NextDNS, Pi-hole or AdGuard Home to see the domains requested by each device, top services, blocked trackers, search, timelines, and exports.</p>
          <div className="feature-chips"><span>Per-device domains</span><span>Blocked trackers</span><span>Categories</span><span>History</span><span>Exports</span></div>
          <button className="button primary" onClick={() => navigate("settings")}><Settings size={17} />Open sensor setup</button>
          <small>No TLS interception. Exact HTTPS page paths, messages, searches, and page content remain private.</small>
        </div>
      ) : (
        <>
          <div className="metric-grid">
            <Metric icon={Globe2} tone="blue" label="Queries stored" value={data.domains.total} detail="30-day local history" />
            <Metric icon={ShieldCheck} tone="mint" label="Blocked" value={data.domains.blocked} detail="tracker and policy matches" />
            <Metric icon={Users} tone="slate" label="Clients" value={new Set(data.domains.recent.map((item) => item.client).filter(Boolean)).size} detail="identified by DNS sensor" />
            <Metric icon={Activity} tone="amber" label="Provider" value={data.integrations.dns.provider} detail="connected local sensor" />
          </div>
          <div className="domain-search-card">
            <label className="domain-search-field"><Search size={21} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a domain, device, IP address, router, or decision…" /></label>
            <span>{domainResults.length} matching requests</span>
          </div>
          <div className="overview-grid">
            <div className="panel sensor-data-panel">
              <PanelHeader title={query ? `Results for “${query}”` : "Recent domain activity"} subtitle="Domain, requesting device, connected router, and exact time" />
              {domainResults.length ? (
                <div className="domain-list">
                  {domainResults.slice(0, 80).map((item) => (
                    <div className="domain-row" key={item.event_key}>
                      <div className={`domain-decision ${item.status}`}><Globe2 size={15} /></div>
                      <span>
                        <strong>{item.domain}</strong>
                        <small><DeviceGlyph kind={item.deviceKind} size={13} /> {item.deviceName}{item.deviceIp ? ` · ${item.deviceIp}` : ""}</small>
                        <small><Router size={13} /> {item.routerName} · {item.source}</small>
                      </span>
                      <b className={item.status}>{item.status}</b>
                      <time>{new Date(item.seen_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                    </div>
                  ))}
                </div>
              ) : <EmptyCompact icon={Search} title="No matching domain activity" text="Try a domain, device name, IP address, or router name." />}
            </div>
            <div className="panel sensor-data-panel">
              <PanelHeader title="Top domains" subtitle="Most requested in retained history" />
              {data.domains.top.length ? (
                <div className="top-domain-list">
                  {data.domains.top.map((item, index) => (
                    <div className="top-domain-row" key={item.domain}>
                      <span>{index + 1}</span><strong>{item.domain}</strong><b>{item.requests}</b>
                    </div>
                  ))}
                </div>
              ) : <EmptyCompact icon={Globe2} title="No domains yet" text="Requests will rank here automatically." />}
            </div>
          </div>
        </>
      )}
      <div className="three-grid">
        <InfoCard icon={Globe2} title="Domain requests" text="See services such as youtube.com or netflix.com per device, with time and allow/block result." />
        <InfoCard icon={ShieldCheck} title="Tracker blocking" text="Review advertising and tracking domains blocked by your local DNS policy." />
        <InfoCard icon={History} title="Searchable history" text="Filter by device, domain, category, time, or decision and export locally." />
      </div>
    </div>
  );
}

function activityCategory(event: EventRow) {
  if (event.type === "device_online" || event.type === "device_offline") return "connections";
  if (event.type === "new_device") return "discovery";
  if (event.type.includes("router") || event.type.includes("collector")) return "network";
  return "system";
}

function activityIcon(event: EventRow) {
  if (event.type === "device_online") return <Wifi size={19} />;
  if (event.type === "device_offline") return <WifiOff size={19} />;
  if (event.type === "new_device") return <Smartphone size={19} />;
  if (event.type.includes("router")) return <Router size={19} />;
  return <Activity size={19} />;
}

function ActivityTimeline({ data, reload }: { data: Snapshot; reload: (quiet?: boolean) => void }) {
  const [filter, setFilter] = useState<"all" | "connections" | "discovery" | "network">("all");
  const [query, setQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const events = data.events.filter((event) => {
    const matchesCategory = filter === "all" || activityCategory(event) === filter;
    const searchable = `${event.title} ${event.detail} ${event.type}`.toLowerCase();
    return matchesCategory && (!normalizedQuery || searchable.includes(normalizedQuery));
  });
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const todayCount = data.events.filter((event) => event.created_at >= todayStart).length;
  const connectionCount = data.events.filter((event) => activityCategory(event) === "connections").length;
  const discoveryCount = data.events.filter((event) => activityCategory(event) === "discovery").length;
  const networkCount = data.events.filter((event) => activityCategory(event) === "network").length;

  async function clearEvents() {
    if (!confirmClear) {
      setConfirmClear(true);
      window.setTimeout(() => setConfirmClear(false), 5000);
      return;
    }
    await fetch(`${API}/api/events`, { method: "DELETE" });
    setConfirmClear(false);
    reload(true);
  }
  return (
    <div className="view-stack">
      <section className="activity-hero">
        <div className="activity-hero-icon"><Activity size={27} /></div>
        <div>
          <span className="eyebrow">NETWORK JOURNAL</span>
          <h2>Everything that changed, in one place</h2>
          <p>Connections, discoveries and infrastructure changes are recorded automatically without turning every event into an alert.</p>
        </div>
        <div className="activity-live"><i />Recording now</div>
      </section>

      <section className="activity-metrics">
        <div><span>Today</span><strong>{todayCount}</strong><small>events recorded</small></div>
        <div><span>Connections</span><strong>{connectionCount}</strong><small>online or offline</small></div>
        <div><span>New devices</span><strong>{discoveryCount}</strong><small>first discoveries</small></div>
        <div><span>Network</span><strong>{networkCount}</strong><small>router and collector</small></div>
      </section>

      <div className="toolbar-card activity-toolbar">
        <label className="activity-search">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search device, IP, router, or event" />
        </label>
        <div className="filter-pills activity-filters">
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button>
          <button className={filter === "connections" ? "active" : ""} onClick={() => setFilter("connections")}>Connections</button>
          <button className={filter === "discovery" ? "active" : ""} onClick={() => setFilter("discovery")}>Discoveries</button>
          <button className={filter === "network" ? "active" : ""} onClick={() => setFilter("network")}>Network</button>
        </div>
        <div className="activity-toolbar-actions">
          <span className="toolbar-note">{events.length} shown</span>
          <button className={`button ${confirmClear ? "danger" : "secondary"}`} onClick={clearEvents} disabled={!data.events.length}>
            <Trash2 size={16} />{confirmClear ? "Confirm clear history" : "Clear history"}
          </button>
        </div>
      </div>

      <div className="panel activity-timeline">
        {events.length ? events.map((event) => (
          <div className={`timeline-event ${activityCategory(event)}`} key={event.id}>
            <div className="timeline-rail"><div className="timeline-icon">{activityIcon(event)}</div><i /></div>
            <div className="timeline-copy">
              <div><span>{activityCategory(event)}</span><time>{event.age}</time></div>
              <strong>{event.title}</strong>
              <p>{event.detail || event.type.replaceAll("_", " ")}</p>
              <small>{new Date(event.created_at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
            </div>
          </div>
        )) : <EmptyCompact icon={History} title="No matching activity" text="Try another category or search term." />}
      </div>
    </div>
  );
}

function Routers({ data }: { data: Snapshot }) {
  return (
    <div className="view-stack">
      <div className="router-grid">
        {data.routers.map((router, index) => (
          <div className="panel router-card" key={router.id}>
            <div className="router-card-top"><div className="router-visual"><Router size={23} /></div><span className={`status-badge ${router.status}`}><i />{router.status}</span></div>
            <span className="eyebrow">{index === 0 ? "INTERNET GATEWAY" : `ACCESS POINT ${index}`}</span>
            <h2>{router.name}</h2>
            <p>{router.model}</p>
            <div className="router-facts">
              <div><span>Homepage</span><code>{router.ip}</code></div>
              <div><span>Response</span><b>{router.latency_ms ? `${Math.round(router.latency_ms)} ms` : "—"}</b></div>
              <div><span>Direct Wi-Fi clients</span><b>{router.clientDataAvailable ? router.directClients : "Unavailable"}</b></div>
              <div><span>Verified downstream</span><b>{router.downstreamClients}</b></div>
              <div><span>Verified branch total</span><b>{router.branchClients}</b></div>
              <div><span>Client data</span><b>{router.clientDataAvailable ? "Live table" : router.clientDataStatus === "pending" ? "Checking" : "Unavailable"}</b></div>
              <div><span>Client refresh</span><b>{router.clientDataCheckedAt ? timeText(router.clientDataCheckedAt) : "Waiting"}</b></div>
              <div><span>Mode</span><b>{index === 0 ? "Router + DHCP" : "LAN access point"}</b></div>
              <div><span>Last check</span><b>{timeText(router.last_checked)}</b></div>
            </div>
            <p className={`router-client-source ${router.clientDataAvailable ? "verified" : "unavailable"}`}>
              {router.clientDataText}{router.downstreamClients ? ` · ${router.downstreamClients} devices are connected to access points farther down this Ethernet path.` : ""}
            </p>
            <p className="router-note">{router.note}</p>
            <a className="button secondary full-button" href={router.admin_url} target="_blank" rel="noreferrer">Open {router.name} homepage <ExternalLink size={16} /></a>
          </div>
        ))}
      </div>
      <div className="panel archived-device">
        <div className="archived-icon"><HardDrive size={20} /></div>
        <div><strong>ZTE F670L — spare / not in active path</strong><p>The experimental AP setup was retired because clients received Wi-Fi without internet. Its management page may be available at 192.168.2.1 only when directly connected.</p></div>
        <span>Archived</span>
      </div>
    </div>
  );
}

function SettingsView({
  data,
  reload,
  accent,
  fontChoice,
  onAccent,
  onFont,
  cloudMode,
  houseNames,
  onSaveHouseNames,
  notificationsEnabled,
  onNotificationsEnabled,
}: {
  data: Snapshot;
  reload: (quiet?: boolean) => void;
  accent: AccentTheme;
  fontChoice: FontChoice;
  onAccent: (accent: AccentTheme) => void;
  onFont: (font: FontChoice) => void;
  cloudMode: boolean;
  houseNames: HouseNames;
  onSaveHouseNames: (names: HouseNames) => void;
  notificationsEnabled: boolean;
  onNotificationsEnabled: (enabled: boolean) => void;
}) {
  const [profileId, setProfileId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [currentControlPin, setCurrentControlPin] = useState("");
  const [newControlPin, setNewControlPin] = useState("");
  const [confirmControlPin, setConfirmControlPin] = useState("");
  const [controlPinMessage, setControlPinMessage] = useState("");
  const [changingControlPin, setChangingControlPin] = useState(false);
  const [houseDraft, setHouseDraft] = useState<HouseNames>(houseNames);
  const [houseMessage, setHouseMessage] = useState("");
  const nextDnsConnected = data.integrations.dns.provider === "NextDNS";

  async function connectNextDns() {
    setConnecting(true);
    setConnectionMessage("");
    try {
      const response = await fetch(`${API}/api/integrations/nextdns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, apiKey }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not connect");
      setApiKey("");
      setConnectionMessage(`Connected. ${result.imported || 0} DNS records imported.`);
      reload(true);
    } catch (error) {
      setConnectionMessage(error instanceof Error ? error.message : "Could not connect");
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectNextDns() {
    await fetch(`${API}/api/integrations/nextdns/disconnect`, { method: "POST" });
    setConnectionMessage("NextDNS disconnected. Existing local history was kept.");
    reload(true);
  }

  async function changeControlPin() {
    setControlPinMessage("");
    if (!/^\d{4}$/.test(currentControlPin) || !/^\d{4}$/.test(newControlPin)) {
      setControlPinMessage("Both PINs must contain exactly 4 digits.");
      return;
    }
    if (newControlPin !== confirmControlPin) {
      setControlPinMessage("The new PIN entries do not match.");
      return;
    }
    setChangingControlPin(true);
    try {
      const response = await fetch(`${API}/api/security/control-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPin: currentControlPin, newPin: newControlPin }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "The control PIN could not be changed.");
      setCurrentControlPin("");
      setNewControlPin("");
      setConfirmControlPin("");
      setControlPinMessage("Control PIN changed successfully.");
      reload(true);
    } catch (error) {
      setControlPinMessage(error instanceof Error ? error.message : "The control PIN could not be changed.");
    } finally {
      setChangingControlPin(false);
    }
  }

  function saveMapNames() {
    onSaveHouseNames(houseDraft);
    setHouseMessage("House names saved and updated on the Network Map.");
    window.setTimeout(() => setHouseMessage(""), 3000);
  }

  return (
    <div className="view-stack">
      <div className="panel appearance-panel">
        <div className="appearance-heading">
          <div><span className="eyebrow">PERSONALISE HOMESCOPE</span><h2>Appearance</h2><p>Choose a color theme and reading style. Your choices stay saved in this browser.</p></div>
          <div className="appearance-preview"><span /><i /><b>Aa</b></div>
        </div>
        <div className="appearance-options">
          <div>
            <label className="appearance-label">Color theme</label>
            <div className="theme-swatches">
              {([
                ["mint", "Mint"],
                ["ocean", "Ocean"],
                ["violet", "Violet"],
                ["sunset", "Sunset"],
                ["rose", "Rose"],
              ] as const).map(([id, label]) => (
                <button key={id} className={`${id} ${accent === id ? "active" : ""}`} onClick={() => onAccent(id)}>
                  <i /><span>{label}</span>{accent === id ? <Check size={15} /> : null}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="appearance-label">Font style</label>
            <div className="font-options">
              {([
                ["modern", "Modern", "Clean and balanced"],
                ["rounded", "Rounded", "Friendly and soft"],
                ["classic", "Classic", "Familiar and clear"],
                ["mono", "Technical", "Precise and compact"],
              ] as const).map(([id, label, detail]) => (
                <button key={id} data-font-preview={id} className={fontChoice === id ? "active" : ""} onClick={() => onFont(id)}>
                  <b>Aa</b><span><strong>{label}</strong><small>{detail}</small></span>{fontChoice === id ? <Check size={16} /> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="panel home-preferences-panel">
        <div className="home-preferences-heading">
          <div className="home-preferences-icon"><House size={23} /></div>
          <div>
            <span className="eyebrow">MAP & NOTIFICATION PREFERENCES</span>
            <h2>Home names and notifications</h2>
            <p>Rename the four building zones shown on the Network Map and control device connection notifications.</p>
          </div>
        </div>

        <div className="house-name-grid">
          {([
            ["houseC", "House C"],
            ["houseB", "House B"],
            ["houseA", "House A"],
            ["main", "Main building"],
          ] as const).map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                value={houseDraft[key]}
                maxLength={40}
                onChange={(event) => setHouseDraft((current) => ({ ...current, [key]: event.target.value }))}
              />
            </label>
          ))}
        </div>

        <div className="home-preferences-actions">
          <button className="button primary" type="button" onClick={saveMapNames}><Check size={16} />Save house names</button>
          {houseMessage ? <span className="form-message success">{houseMessage}</span> : null}
        </div>

        <div className="notification-preference">
          <div className="notification-preference-icon">{notificationsEnabled ? <Bell size={20} /> : <BellOff size={20} />}</div>
          <div>
            <strong>Device connection notifications</strong>
            <span>{notificationsEnabled ? "Show the three-second Wi-Fi ripple when a device connects or moves to another access point." : "Connection notifications are currently turned off."}</span>
          </div>
          <label className="preference-switch">
            <input
              type="checkbox"
              checked={notificationsEnabled}
              onChange={(event) => onNotificationsEnabled(event.target.checked)}
            />
            <span aria-hidden="true"><i /></span>
            <b>{notificationsEnabled ? "On" : "Off"}</b>
          </label>
        </div>
      </div>

      <div className="panel device-control-settings">
        <div className="device-control-settings-head">
          <div className="control-settings-icon"><ShieldCheck size={23} /></div>
          <div>
            <span className="eyebrow">PIN-PROTECTED NETWORK CONTROL</span>
            <h2>Device blocking</h2>
            <p>{data.security.blocking.detail}</p>
          </div>
          <span className="sensor-state active"><Check size={13} />{data.security.blocking.provider}</span>
        </div>
        <div className="control-settings-grid">
          <div className="control-capability">
            <strong>Verified enforcement</strong>
            <p>HomeScope currently blocks devices connected through D-Link and reads the rule back before reporting success. Unsupported access points stay read-only.</p>
            <div><ShieldCheck size={16} /><span>The Mac host and all routers are protected from blocking.</span></div>
          </div>
          <div className="control-pin-form">
            <div className="control-pin-title"><KeyRound size={18} /><span><strong>Change the 4-digit PIN</strong><small>{data.security.controlPinIsDefault ? "Default PIN is currently 0000" : "A custom PIN is active"}</small></span></div>
            <div className="control-pin-fields">
              <input aria-label="Current control PIN" inputMode="numeric" type="password" maxLength={4} value={currentControlPin} onChange={(event) => setCurrentControlPin(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Current" autoComplete="off" />
              <input aria-label="New control PIN" inputMode="numeric" type="password" maxLength={4} value={newControlPin} onChange={(event) => setNewControlPin(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="New PIN" autoComplete="new-password" />
              <input aria-label="Confirm new control PIN" inputMode="numeric" type="password" maxLength={4} value={confirmControlPin} onChange={(event) => setConfirmControlPin(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Confirm" autoComplete="new-password" />
            </div>
            <button className="button primary" onClick={changeControlPin} disabled={changingControlPin || !currentControlPin || !newControlPin || !confirmControlPin}><KeyRound size={16} />{changingControlPin ? "Changing…" : "Change PIN"}</button>
            {controlPinMessage ? <div className={controlPinMessage.includes("successfully") ? "form-message success" : "form-message error"}>{controlPinMessage}</div> : null}
          </div>
        </div>
      </div>

      <div className="panel nextdns-panel">
        <div className="nextdns-heading">
          <div className="nextdns-mark"><Cloud size={23} /></div>
          <div><span className="eyebrow">24/7 CLOUD DOMAIN HISTORY</span><h2>Connect NextDNS</h2><p>{cloudMode ? "The VPS imports your cloud DNS logs continuously." : "HomeScope imports your cloud DNS logs whenever this Mac is awake. NextDNS keeps collecting while the Mac is off."}</p></div>
          <span className={nextDnsConnected ? "sensor-state active" : "sensor-state"}>{nextDnsConnected ? <Check size={13} /> : <Unplug size={13} />}{nextDnsConnected ? "Connected" : "Not connected"}</span>
        </div>
        {nextDnsConnected ? (
          <div className="nextdns-connected">
            <div><Check size={18} /><span><strong>Profile connected securely</strong><small>The API key is stored only in the collector’s private settings.</small></span></div>
            <button className="button secondary" onClick={disconnectNextDns}>Disconnect</button>
          </div>
        ) : (
          <div className="nextdns-form">
            <label><span>Profile ID</span><input value={profileId} onChange={(event) => setProfileId(event.target.value)} placeholder="Example: abc123" autoComplete="off" /></label>
            <label><span>API key</span><div className="secret-input"><KeyRound size={16} /><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="From the bottom of your Account page" autoComplete="new-password" /></div></label>
            <button className="button primary" onClick={connectNextDns} disabled={connecting || !profileId || !apiKey}>{connecting ? <RefreshCw size={16} className="spin" /> : <Cloud size={16} />}{connecting ? "Connecting…" : "Connect NextDNS"}</button>
          </div>
        )}
        <div className="nextdns-help">
          <span>Get the profile ID from your setup page and the API key from Account. NextDNS records domains and devices—not MB or GB usage.</span>
          <div><a href="https://my.nextdns.io" target="_blank" rel="noreferrer">Open NextDNS <ExternalLink size={13} /></a><a href="https://my.nextdns.io/account" target="_blank" rel="noreferrer">Account & API key <ExternalLink size={13} /></a></div>
        </div>
        {connectionMessage ? <div className={connectionMessage.startsWith("Connected") || connectionMessage.startsWith("NextDNS") ? "form-message success" : "form-message error"}>{connectionMessage}</div> : null}
      </div>

      <div className="settings-grid">
        <div className="panel settings-section">
          <PanelHeader title={cloudMode ? "VPS collector" : "Local collector"} subtitle="Device discovery and durable history" />
          <SettingRow icon={Network} title="LAN discovery" text="Scans 192.168.1.1–254 every 60 seconds" value="Active" active />
          <SettingRow icon={Router} title="Presence source" text="Uses the SLT router client table when available" value={data.collector.source || "LAN scan"} active />
          <SettingRow icon={Database} title="History database" text={cloudMode ? "SQLite stored on the private VPS" : "SQLite file stored inside this project"} value={cloudMode ? "VPS" : "Local"} active />
          <SettingRow icon={Clock3} title="Observation retention" text="Detailed scan samples are kept for 30 days" value="30 days" active />
          <a className="button secondary full-button" href={`${API}/api/export/devices.csv`}><Download size={16} />Export device inventory</a>
        </div>
        <div className="panel settings-section">
          <PanelHeader title="Privacy" subtitle={cloudMode ? "Protected remote access to your LAN" : "Designed for your Mac and your LAN"} />
          <SettingRow icon={ShieldCheck} title="Remote access" text={cloudMode ? "Dashboard requests are authenticated and encrypted" : "No network history is sent to a hosted service"} value={cloudMode ? "Protected" : "Off"} active />
          <SettingRow icon={Eye} title="TLS interception" text="HomeScope does not decrypt HTTPS traffic" value="Off" active />
          <SettingRow icon={HardDrive} title="Data location" text={cloudMode ? "/var/lib/homescope/homescope.sqlite" : "network-pulse/data/homescope.sqlite"} value={cloudMode ? "Private VPS" : "This Mac"} active />
          <div className="setting-note">Router passwords are not shown in the browser or stored in the dashboard database.</div>
        </div>
      </div>

      <div className="panel integration-section">
        <PanelHeader title="Optional visibility sensors" subtitle="Add these only when you want deeper traffic insight" />
        <div className="integration-grid">
          <IntegrationCard icon={Cloud} title="NextDNS Cloud" state={nextDnsConnected ? "configured" : "not_configured"} provider={nextDnsConnected ? "NextDNS" : ""} capability="24/7 cloud domain logs, devices, blocking, encrypted DNS" env={["Profile ID", "API key"]} />
          <IntegrationCard icon={Globe2} title="Pi-hole / AdGuard Home" state={data.integrations.dns.status === "configured" && !nextDnsConnected ? "configured" : "not_configured"} provider={!nextDnsConnected ? data.integrations.dns.provider : ""} capability="Self-hosted domains, query history, blocking, categories" env={["PIHOLE_URL + PIHOLE_TOKEN", "or ADGUARD_URL + login"]} />
          <IntegrationCard icon={Gauge} title="ntopng" state={data.integrations.traffic.status} provider={data.integrations.traffic.provider} capability="Bandwidth totals, flows, protocols, application estimates" env={["NTOPNG_URL", "NTOPNG_USER + NTOPNG_PASS"]} />
        </div>
        <div className="setup-foot"><code>{cloudMode ? "/etc/homescope/collector.env" : ".env.local"}</code><span>Add sensor details to the collector configuration, then restart HomeScope. The supplied <b>.env.example</b> lists every supported setting.</span></div>
      </div>

      <div className="panel limits-panel">
        <div className="limits-icon"><ShieldCheck size={23} /></div>
        <div><h2>Accuracy without overclaiming</h2><p>Device presence and router health work now. Exact per-device bytes require ntopng to receive the traffic. Domains require Pi-hole or AdGuard Home. Exact encrypted page paths and on-screen app activity require endpoint software and are intentionally outside passive router monitoring.</p></div>
      </div>
    </div>
  );
}

function DeviceDrawer({
  device,
  routers,
  usagePeriods,
  onClose,
  onSaved,
}: {
  device: Device;
  routers: RouterRow[];
  usagePeriods?: Record<UsagePeriodKey, UsagePeriod>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [label, setLabel] = useState(device.label);
  const [owner, setOwner] = useState(device.owner);
  const [kind, setKind] = useState(device.kind);
  const [group, setGroup] = useState(device.group_name);
  const [apId, setApId] = useState(device.ap_id || "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [controlAction, setControlAction] = useState<"block" | "unblock" | null>(null);
  const [controlPin, setControlPin] = useState("");
  const [controlError, setControlError] = useState("");
  const [controlling, setControlling] = useState(false);
  const usageFor = (period: UsagePeriodKey) => usagePeriods?.[period]?.devices.find((item) =>
    (item.mac && item.mac.toLowerCase() === device.mac.toLowerCase()) || item.host === device.ip
  );
  const dayUsage = usageFor("day");
  const weekUsage = usageFor("week");
  const monthUsage = usageFor("month");

  async function save() {
    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch(`${API}/api/devices/${encodeURIComponent(device.mac)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), owner: owner.trim(), kind, group_name: group, ap_id: apId }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "The device could not be saved.");
      await onSaved();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The device could not be saved.");
      setSaving(false);
    }
  }

  async function applyAccessControl() {
    if (!controlAction) return;
    setControlError("");
    if (!/^\d{4}$/.test(controlPin)) {
      setControlError("Enter the 4-digit control PIN.");
      return;
    }
    setControlling(true);
    try {
      const response = await fetch(`${API}/api/devices/${encodeURIComponent(device.mac)}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: controlAction, pin: controlPin }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "The router did not confirm this control.");
      setControlPin("");
      setControlAction(null);
      await onSaved();
    } catch (error) {
      setControlError(error instanceof Error ? error.message : "The router did not confirm this control.");
      setControlling(false);
    }
  }

  return (
    <>
      <button className="drawer-scrim" onClick={onClose} aria-label="Close device details" />
      <aside className="device-drawer">
        <div className="drawer-head">
          <div className="drawer-device-icon"><DeviceGlyph kind={device.kind} size={25} /></div>
          <div><span>DEVICE PROFILE</span><h2>{device.displayName}</h2><p>{device.kind} · {device.owner || "No owner assigned"}</p></div>
          <button className="icon-button" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="drawer-status"><span className={`status-dot ${device.status === "online" ? "dot-online" : "dot-offline"}`} /><strong>{device.status === "online" ? "Online now" : `Last seen ${device.lastSeenText}`}</strong><small>{device.source}</small></div>
        <div className={`profile-route ${device.association_trust}`}>
          <div className="profile-route-icon"><Router size={20} /></div>
          <span><small>{device.associationVerified ? "VERIFIED CONNECTION" : "ROUTER ATTRIBUTION"}</small><strong>{device.apName || "Router not identified"}</strong><p>{device.associationTrustLabel}{device.associationSeenText ? ` · ${device.associationSeenText}` : ""}</p></span>
          {device.association_signal ? <b>{device.association_signal} dBm</b> : null}
        </div>
        <div className="profile-usage">
          <div><span>Today</span><strong>{formatBytes(dayUsage?.total || 0)}</strong><small>{formatBytes(dayUsage?.currentBps || 0)}/s now</small></div>
          <div><span>7 days</span><strong>{formatBytes(weekUsage?.total || 0)}</strong><small>{weekUsage?.sampleCount || 0} samples</small></div>
          <div><span>30 days</span><strong>{formatBytes(monthUsage?.total || 0)}</strong><small>measured usage</small></div>
        </div>
        <div className={`device-access-card ${device.control_state === "blocked" ? "blocked" : ""}`}>
          <div className="device-access-icon">{device.control_state === "blocked" ? <Ban size={22} /> : <ShieldCheck size={22} />}</div>
          <div>
            <span>NETWORK ACCESS</span>
            <strong>{device.control_state === "blocked" ? "Blocked on D-Link Wi-Fi" : device.control_available ? "Blocking is available" : "Blocking is not available here yet"}</strong>
            <p>{device.control_detail || device.control_reason || "A verified D-Link rule will be applied only after the 4-digit PIN is confirmed."}</p>
          </div>
          <button
            className={`button ${device.control_state === "blocked" ? "secondary" : "danger"}`}
            disabled={!device.control_available}
            onClick={() => {
              setControlError("");
              setControlPin("");
              setControlAction(device.control_state === "blocked" ? "unblock" : "block");
            }}
          >
            {device.control_state === "blocked" ? <Wifi size={16} /> : <WifiOff size={16} />}
            {device.control_state === "blocked" ? "Restore access" : "Block device"}
          </button>
        </div>
        <div className="profile-section-title"><span>Network identity</span><i /></div>
        <div className="detail-grid">
          <div><span>IP address</span><code>{device.ip}</code></div>
          <div><span>MAC address</span><code>{device.mac}</code></div>
          <div><span>Hostname</span><b>{device.hostname || "Not reported"}</b></div>
          <div><span>Router / access point</span><b>{device.apName || "Not identified"} · {device.associationTrustLabel}</b></div>
          <div><span>First seen</span><b>{device.firstSeenText}</b></div>
          <div><span>Last seen</span><b>{device.lastSeenText}</b></div>
          <div><span>Manufacturer</span><b>{device.vendor || "Private / unknown"}</b></div>
          <div><span>Identity confidence</span><b>{device.identity_confidence || "Not identified"}</b></div>
        </div>
        <div className="drawer-form">
          <h3><Pencil size={16} /> Your labels</h3>
          <label><span>Device name</span><input value={label} onChange={(event) => setLabel(event.target.value)} /></label>
          <label><span>Owner</span><input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="e.g. Alex" /></label>
          <div className="two-fields">
            <label><span>Type</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option>Phone</option><option>Tablet</option><option>Laptop</option><option>Computer</option><option>TV</option><option>Speaker</option><option>Camera</option><option>Printer</option><option>Game console</option><option>Wearable</option><option>IoT</option><option>Infrastructure</option><option>Mobile</option><option>Unknown</option></select></label>
            <label><span>Group</span><select value={group} onChange={(event) => setGroup(event.target.value)}><option>Home</option><option>Family</option><option>Guest</option><option>Work</option><option>IoT</option></select></label>
          </div>
          <label><span>Connected through</span><select value={apId} onChange={(event) => setApId(event.target.value)}><option value="">Not identified</option>{routers.map((router) => <option key={router.id} value={router.id}>{router.name}</option>)}</select></label>
          <p className="field-help">Choose a router manually when the access point cannot report its client list. A later direct AP report will replace the manual choice.</p>
        </div>
        <div className="drawer-callout"><Signal size={18} /><p><strong>{device.associationTrustLabel}.</strong> {device.associationTrustDetail}.{device.associationVerified && device.association_band ? ` ${device.apName} reported ${device.association_band}${device.association_signal ? ` at ${device.association_signal} dBm` : ""}.` : ""}{device.identity_source ? ` Identity evidence: ${device.identity_source}.` : ""}</p></div>
        {saveError ? <div className="drawer-save-error" role="alert">{saveError}</div> : null}
        <div className="drawer-actions"><button className="button secondary" onClick={onClose} disabled={saving}>Cancel</button><button className="button primary" onClick={save} disabled={saving || !label.trim()}><Check size={16} />{saving ? "Saving…" : "Save changes"}</button></div>
      </aside>
      {controlAction ? (
        <div className="control-modal-layer" role="dialog" aria-modal="true" aria-labelledby="control-modal-title">
          <button className="control-modal-scrim" onClick={() => !controlling && setControlAction(null)} aria-label="Cancel device control" />
          <div className="control-modal">
            <div className={`control-modal-icon ${controlAction === "block" ? "danger" : ""}`}>{controlAction === "block" ? <Ban size={24} /> : <Wifi size={24} />}</div>
            <h2 id="control-modal-title">{controlAction === "block" ? `Block ${device.displayName}?` : `Restore ${device.displayName}?`}</h2>
            <p>{controlAction === "block" ? "D-Link will deny this MAC address and HomeScope will verify the saved rule. The device may reconnect through another unsupported access point." : "HomeScope will remove the verified D-Link deny-list entry."}</p>
            <label><span>4-digit control PIN</span><input autoFocus inputMode="numeric" type="password" maxLength={4} value={controlPin} onChange={(event) => setControlPin(event.target.value.replace(/\D/g, "").slice(0, 4))} onKeyDown={(event) => { if (event.key === "Enter") applyAccessControl(); }} placeholder="••••" autoComplete="off" /></label>
            {controlError ? <div className="form-message error" role="alert">{controlError}</div> : null}
            <div className="control-modal-actions">
              <button className="button secondary" onClick={() => setControlAction(null)} disabled={controlling}>Cancel</button>
              <button className={`button ${controlAction === "block" ? "danger" : "primary"}`} onClick={applyAccessControl} disabled={controlling || controlPin.length !== 4}>{controlling ? <RefreshCw size={16} className="spin" /> : controlAction === "block" ? <Ban size={16} /> : <Wifi size={16} />}{controlling ? "Verifying…" : controlAction === "block" ? "Confirm block" : "Restore access"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function EventItem({ event }: { event: EventRow }) {
  return (
    <div className="event-item">
      <div className={`event-icon ${event.severity}`}>{event.severity === "critical" ? <AlertTriangle size={17} /> : event.severity === "warning" ? <ShieldQuestion size={17} /> : <Activity size={17} />}</div>
      <div><strong>{event.title}</strong><span>{event.detail || event.type.replaceAll("_", " ")}</span></div>
      <time>{event.age}</time>
    </div>
  );
}

function EmptyCompact({ icon: Icon, title, text }: { icon: typeof Wifi; title: string; text: string }) {
  return <div className="empty-compact"><div><Icon size={22} /></div><strong>{title}</strong><span>{text}</span></div>;
}

function InfoCard({ icon: Icon, title, text }: { icon: typeof Wifi; title: string; text: string }) {
  return <div className="panel info-card"><div><Icon size={20} /></div><h3>{title}</h3><p>{text}</p></div>;
}

function SensorSetup({ icon: Icon, title, text, note, connected, onClick }: { icon: typeof Wifi; title: string; text: string; note: string; connected: boolean; onClick: () => void }) {
  return (
    <div className="panel sensor-setup">
      <div className="sensor-art"><Icon size={27} /></div>
      <span className="eyebrow">{connected ? "CONNECTED SENSOR" : "OPTIONAL SENSOR"}</span>
      <h2>{connected ? `${title} is connected` : title}</h2>
      <p>{text}</p>
      <div className="sensor-note"><Network size={17} /><span>{note}</span></div>
      <button className="button primary" onClick={onClick}><Settings size={16} />{connected ? "View settings" : "Set up sensor"}</button>
    </div>
  );
}

function SettingRow({ icon: Icon, title, text, value, active }: { icon: typeof Wifi; title: string; text: string; value: string; active: boolean }) {
  return <div className="setting-row"><div><Icon size={18} /></div><span><strong>{title}</strong><small>{text}</small></span><b className={active ? "setting-value active" : "setting-value"}>{value}</b></div>;
}

function IntegrationCard({ icon: Icon, title, state, provider, capability, env }: { icon: typeof Wifi; title: string; state: string; provider: string; capability: string; env: string[] }) {
  const connected = state === "configured";
  return (
    <div className="integration-card">
      <div className="integration-top"><div><Icon size={20} /></div><span className={connected ? "sensor-state active" : "sensor-state"}>{connected ? <Check size={13} /> : <Unplug size={13} />}{connected ? "Configured" : "Not connected"}</span></div>
      <h3>{title}</h3><p>{capability}</p>
      <div className="env-list">{env.map((item) => <code key={item}>{item}</code>)}</div>
      {provider ? <small>Provider: {provider}</small> : null}
    </div>
  );
}
