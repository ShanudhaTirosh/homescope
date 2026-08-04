#!/bin/zsh
set -euo pipefail

: "${HOMESCOPE_VPS_HOST:?Set HOMESCOPE_VPS_HOST to the VPS hostname or IP address}"
ssh_user="${HOMESCOPE_VPS_USER:-ubuntu}"
ssh_key="${HOMESCOPE_SSH_KEY:-$HOME/.ssh/homescope}"
remote_target="$ssh_user@$HOMESCOPE_VPS_HOST"

# A Mac network change can leave the previous server-side SSH session half-open.
# Clear only HomeScope's dedicated reverse-forward port before reconnecting.
/usr/bin/ssh \
  -T \
  -i "$ssh_key" \
  -o BatchMode=yes \
  -o ConnectTimeout=10 \
  "$remote_target" \
  "sudo -n /usr/bin/fuser -k 4319/tcp >/dev/null 2>&1 || true"

exec /usr/bin/ssh \
  -N \
  -T \
  -i "$ssh_key" \
  -o BatchMode=yes \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=10 \
  -o ServerAliveCountMax=2 \
  -o TCPKeepAlive=yes \
  -o ConnectTimeout=15 \
  -R 127.0.0.1:4319:127.0.0.1:4318 \
  "$remote_target"
