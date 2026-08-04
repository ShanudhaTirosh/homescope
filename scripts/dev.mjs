import { spawn } from "node:child_process";

const children = [];

function start(command, args, name) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (signal || code === 0) return;
    console.error(`${name} stopped with exit code ${code}`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 120);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start(process.execPath, ["--disable-warning=ExperimentalWarning", "collector/server.mjs"], "collector");
start("npm", ["run", "dev:web"], "web");
