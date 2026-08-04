#!/bin/zsh
set -euo pipefail

app_dir="${HOMESCOPE_APP_ROOT:-$HOME/Library/Application Support/HomeScope}"
node_bin="${HOMESCOPE_NODE_BIN:-$(command -v node)}"
cd "$app_dir"

set -a
source "$app_dir/collector.env"
set +a

export COLLECTOR_HOST="127.0.0.1"
export COLLECTOR_PORT="4318"
export SCAN_ENABLED="true"
export COLLECTOR_API_TOKEN="$(security find-generic-password -a homescope-local -s 'HomeScope Collector API Token' -w)"
export NODE_ENV="production"

export HOMESCOPE_DATA_DIR="$app_dir/data"

exec "$node_bin" --disable-warning=ExperimentalWarning "$app_dir/collector/server.mjs"
