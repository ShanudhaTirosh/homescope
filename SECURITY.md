# Security policy

## Reporting a vulnerability

Please open a private GitHub security advisory for vulnerabilities involving
authentication, credential handling, device controls, command execution, or
exposure of private network data. Do not include real router credentials,
tokens, MAC addresses, DNS logs, or traffic captures in a public issue.

## Deployment guidance

- Run the collector on a trusted device and bind it to loopback unless a strong
  API token and protected reverse proxy are configured.
- Never expose router administration interfaces to the public internet.
- Use a unique dashboard password and change the default device-control PIN.
- Store secrets only in ignored environment files, the macOS Keychain, or a
  protected server secret store.
- Review third-party sensor permissions before connecting them.

HomeScope is a monitoring tool, not a security boundary. Router firmware and
network topology determine which telemetry and controls are actually available.
