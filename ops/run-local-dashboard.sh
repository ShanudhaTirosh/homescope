#!/bin/zsh
set -euo pipefail

app_root="${HOMESCOPE_APP_ROOT:-$HOME/Library/Application Support/HomeScope}"
dashboard_root="$app_root/dashboard"
node_bin="${HOMESCOPE_NODE_BIN:-$(command -v node)}"

cd "$dashboard_root"

export HOST="127.0.0.1"
export PORT="3000"
export NODE_ENV="production"
export HOMESCOPE_AUTH_REQUIRED="true"
export HOMESCOPE_CLOUD_MODE="false"
export HOMESCOPE_COOKIE_SECURE="false"
export HOMESCOPE_COLLECTOR_URL="http://127.0.0.1:4318"
export HOMESCOPE_COLLECTOR_TOKEN="$(/usr/bin/security find-generic-password -a homescope-local -s "HomeScope Collector API Token" -w)"
export HOMESCOPE_LOGIN_EMAIL="$(/usr/bin/security find-generic-password -a homescope-local -s "HomeScope Login Email" -w)"
export HOMESCOPE_PASSWORD_SCRYPT="$(/usr/bin/security find-generic-password -a homescope-local -s "HomeScope Password Scrypt" -w)"
export HOMESCOPE_SESSION_SECRET="$(/usr/bin/security find-generic-password -a homescope-local -s "HomeScope Session Secret" -w)"

exec "$node_bin" "$dashboard_root/server.js"
