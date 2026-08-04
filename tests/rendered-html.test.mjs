import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the HomeScope application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>HomeScope — Local Network Monitor<\/title>/i);
  assert.match(html, /HomeScope/);
  assert.match(html, /(Welcome|Good (morning|afternoon|evening))/);
  assert.match(html, /Private network monitor/);
  assert.match(html, /Scan now/);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview/);
});

test("uses the final dashboard instead of starter preview assets", async () => {
  const [page, layout, packageJson, dashboard, collector] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/network-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../collector/server.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(page, /NetworkDashboard/);
  assert.match(layout, /HomeScope — Local Network Monitor/);
  assert.match(packageJson, /homescope-network-monitor/);
  assert.match(dashboard, /192\.168\.1\.1/);
  assert.match(dashboard, /Pi-hole/);
  assert.match(dashboard, /ntopng/);
  assert.match(dashboard, /Device usage history/);
  assert.match(dashboard, /30 days/);
  assert.match(dashboard, /homescope-theme/);
  assert.match(dashboard, /Connected through/);
  assert.match(dashboard, /Router not identified/);
  assert.match(dashboard, /associationVerified/);
  assert.match(dashboard, /Direct Wi-Fi clients/);
  assert.match(dashboard, /Verified downstream/);
  assert.match(collector, /associationTelemetry/);
  assert.match(collector, /downstreamClients/);
  assert.match(collector, /Math\.max\(intervalMs \* 6, 180000\)/);
  assert.match(collector, /Router not identified/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
