import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  shell,
  Tray,
} from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DASHBOARD_URL = "http://127.0.0.1:3000";
const COLLECTOR_URL = "http://127.0.0.1:4318";
const SERVICE_LABELS = ["com.homescope.collector", "com.homescope.dashboard", "com.homescope.awake"];
const sourceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

let dashboardWindow = null;
let tray = null;
let trayMenu = null;
let quitting = false;
let serviceState = { dashboard: false, collector: false };

function showInDock() {
  if (process.platform !== "darwin") return;
  app.setActivationPolicy("regular");
  app.dock?.show();
}

function hideFromDock() {
  if (process.platform !== "darwin") return;
  app.dock?.hide();
  app.setActivationPolicy("accessory");
}

function kickstartServices() {
  const domain = `gui/${process.getuid()}`;
  for (const label of SERVICE_LABELS) {
    const child = spawn("/bin/launchctl", ["kickstart", `${domain}/${label}`], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }
}

async function health(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return response.ok || response.status === 401;
  } catch {
    return false;
  }
}

async function refreshServiceState() {
  const [dashboard, collector] = await Promise.all([
    health(`${DASHBOARD_URL}/login`),
    health(`${COLLECTOR_URL}/api/health`),
  ]);
  serviceState = { dashboard, collector };
  if (!dashboard || !collector) kickstartServices();
  rebuildMenu();
  return serviceState;
}

async function waitForDashboard(timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await health(`${DASHBOARD_URL}/login`)) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 350));
  }
  return false;
}

function createDashboardWindow() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) return dashboardWindow;

  dashboardWindow = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 420,
    minHeight: 560,
    show: false,
    title: "HomeScope",
    backgroundColor: "#07120f",
    titleBarStyle: "default",
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  dashboardWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://192.168.1.") || url.startsWith("https://192.168.1.")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
  dashboardWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(DASHBOARD_URL)) {
      event.preventDefault();
      if (url.startsWith("http://192.168.1.") || url.startsWith("https://192.168.1.")) {
        shell.openExternal(url);
      }
    }
  });
  dashboardWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    dashboardWindow.hide();
    hideFromDock();
  });

  return dashboardWindow;
}

async function showDashboard() {
  kickstartServices();
  const ready = await waitForDashboard();
  if (!ready) {
    dialog.showErrorBox(
      "HomeScope is still starting",
      "The local dashboard did not respond yet. HomeScope will keep running in the menu bar; try opening it again in a few seconds.",
    );
    await refreshServiceState();
    return;
  }

  const window = createDashboardWindow();
  showInDock();
  if (!window.webContents.getURL()) {
    await window.loadURL(DASHBOARD_URL);
  }
  window.show();
  window.focus();
  app.focus({ steal: true });
  await refreshServiceState();
}

function rebuildMenu() {
  if (!tray) return;
  const statusText = serviceState.dashboard && serviceState.collector
    ? "HomeScope is monitoring"
    : "HomeScope is starting…";
  trayMenu = Menu.buildFromTemplate([
    { label: statusText, enabled: false },
    { type: "separator" },
    { label: "Open Full Dashboard", click: () => void showDashboard() },
    {
      label: "Refresh Status",
      click: () => {
        kickstartServices();
        void refreshServiceState();
      },
    },
    { type: "separator" },
    { label: "Runs locally on this Mac", enabled: false },
    {
      label: "Restart Local Services",
      click: () => {
        kickstartServices();
        void refreshServiceState();
      },
    },
  ]);
  tray.setToolTip(statusText);
}

function trayImage() {
  const packagedPath = join(process.resourcesPath, "HomeScopeTemplate.png");
  const developmentPath = join(sourceRoot, "desktop-assets", "HomeScopeTemplate.png");
  const iconPath = existsSync(packagedPath) ? packagedPath : developmentPath;
  const image = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
  image.setTemplateImage(true);
  return image;
}

function createTray() {
  tray = new Tray(trayImage());
  tray.on("click", () => void showDashboard());
  tray.on("right-click", () => tray?.popUpContextMenu(trayMenu));
  rebuildMenu();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => void showDashboard());
  app.whenReady().then(async () => {
    hideFromDock();
    kickstartServices();
    createTray();
    await refreshServiceState();
    setInterval(() => void refreshServiceState(), 15_000).unref();
  }).catch((error) => {
    dialog.showErrorBox("HomeScope could not start", error instanceof Error ? error.message : String(error));
    app.quit();
  });
}

app.on("activate", () => void showDashboard());
app.on("window-all-closed", () => {
  // The menu-bar controller and local monitoring continue running.
});
app.on("before-quit", () => {
  quitting = true;
});
