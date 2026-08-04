# Contributing to HomeScope

Contributions are welcome, especially router adapters, portability work,
accessibility improvements, tests, documentation, and privacy-preserving
network discovery.

## Local development

1. Fork and clone the repository.
2. Copy `.env.example` to `.env.local`.
3. Add only credentials for equipment you own or are authorized to manage.
4. Run `npm install` and `npm run dev`.
5. Before opening a pull request, run `npm test` and `npm run lint`.

## Project structure

- `app/` — responsive dashboard and local authentication
- `collector/` — LAN discovery, router adapters, SQLite storage, sensors, API
- `electron/` — macOS menu-bar controller
- `ops/` — launchd, systemd, and reverse-proxy templates
- `tests/` — rendered-output tests

## Router-adapter rules

- Treat router client tables as authoritative only for that router.
- Never assign an unmatched LAN client to an access point by guesswork.
- Label unavailable or stale telemetry honestly.
- Use short timeouts and backoff so monitoring cannot overload router firmware.
- Keep credentials in environment variables or private settings; never send
  them to the browser.
- New write operations require explicit UI confirmation, verification, and
  safeguards for the HomeScope host and network infrastructure.

## Privacy checklist

Do not commit `.env.local`, SQLite databases, DNS history, traffic captures,
real MAC addresses, household names, public IP addresses, SSH keys, tokens, or
router passwords. Use synthetic examples in tests and screenshots.

## Pull requests

Keep changes focused, explain the hardware or environment tested, document any
new variables in `.env.example`, and include tests for behavior that can be
verified without the physical router.
