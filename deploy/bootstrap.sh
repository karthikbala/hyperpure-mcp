#!/usr/bin/env bash
set -euo pipefail
if [[ $(id -u) != 0 || $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
  echo 'This helper requires root on Linux x86-64; see docs/deployment.md.' >&2
  exit 1
fi
APP=/opt/hyperpure-mcp
install -d -m 755 "$APP"
id hyperpure-mcp >/dev/null 2>&1 || useradd --system --home-dir /var/lib/hyperpure-mcp --create-home --shell /usr/sbin/nologin hyperpure-mcp
install -d -o hyperpure-mcp -g hyperpure-mcp -m 700 /var/lib/hyperpure-mcp
install -d -m 700 /etc/hyperpure-mcp
NODE_VERSION=v24.21.0
if [ ! -x "$APP/runtime/bin/node" ]; then
  stage=$(mktemp -d)
  trap 'rm -rf "$stage"' EXIT
  cd "$stage"
  curl --fail --silent --show-error --location --max-time 180 -O "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz"
  curl --fail --silent --show-error --location --max-time 30 -O "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  grep " node-$NODE_VERSION-linux-x64.tar.xz$" SHASUMS256.txt | sha256sum --check -
  mkdir -p "$APP/runtime"
  tar -xJf "node-$NODE_VERSION-linux-x64.tar.xz" -C "$APP/runtime" --strip-components=1
fi
