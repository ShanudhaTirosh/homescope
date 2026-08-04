# HomeScope cloud deployment

HomeScope uses a split deployment:

- Vercel serves the dashboard and verifies the single authorized login.
- A private VPS runs the continuous collector and owns the SQLite history.
- The ZLT creates an outbound VPN to the VPS so the collector can reach the
  router and access-point management addresses.

The dashboard never sends the collector token or router passwords to the
browser.

## 1. Prepare secrets

Generate a password hash locally:

```bash
npm run auth:password
```

Generate two independent random values:

```bash
openssl rand -base64 48
openssl rand -base64 48
```

Use one as `HOMESCOPE_SESSION_SECRET`. Use the other as both
`HOMESCOPE_COLLECTOR_TOKEN` on Vercel and `COLLECTOR_API_TOKEN` on the VPS.

## 2. Configure the VPS collector

An Ubuntu VPS with Node.js 22 or newer and Caddy is sufficient.

1. Create the `homescope` system user and these directories:
   `/opt/homescope/collector`, `/etc/homescope`, and `/var/lib/homescope`.
2. Copy `collector/server.mjs` to `/opt/homescope/collector/server.mjs`.
3. Copy `ops/collector.env.example` to `/etc/homescope/collector.env`, restrict
   it to root, and fill in the token and private integrations.
4. Install `ops/homescope-collector.service` as a systemd unit.
5. Adapt `ops/Caddyfile.example` to the collector hostname.
6. Start Caddy and the HomeScope collector.

The collector intentionally refuses to bind to a public interface without an
API token. Caddy should be the only internet-facing service.

## 3. Link the home network

Configure the ZLT VPN client to connect outward to the VPS. The VPS must have a
route back to `192.168.1.0/24`. Router client tables and direct management APIs
work across a routed tunnel. Broadcast-only discovery and ARP do not cross a
routed VPN, so HomeScope does not claim evidence it cannot observe.

Do not expose any router administration page directly to the public internet.

## 4. Configure Vercel

Add these protected environment variables to the Vercel project:

```text
HOMESCOPE_AUTH_REQUIRED=true
HOMESCOPE_LOGIN_EMAIL=your-authorized-email
HOMESCOPE_PASSWORD_SCRYPT=scrypt$...
HOMESCOPE_SESSION_SECRET=first-random-value
HOMESCOPE_COLLECTOR_URL=https://collector.example.com
HOMESCOPE_COLLECTOR_TOKEN=second-random-value
```

Deploy using the included `vercel.json`. Vercel runs `npm run build:vercel`.

## 5. Validate

1. Open the Vercel URL and confirm it redirects to `/login`.
2. Confirm an incorrect password is rejected.
3. Sign in and confirm the collector becomes active.
4. From the VPS, verify that `192.168.1.1` through `.4` are reachable through
   the VPN.
5. Trigger **Scan now** and confirm the snapshot timestamp changes.

Exact per-device bandwidth still requires traffic to pass through a measured
gateway or a compatible router traffic export. DNS history does not measure
bytes.
