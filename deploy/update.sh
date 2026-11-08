#!/usr/bin/env bash
# Pulls the latest version, builds it and restarts the service.
set -euo pipefail
cd /opt/bouwboot
runuser -u bouwboot -- git pull --ff-only
cd web
runuser -u bouwboot -- npm ci --no-audit --no-fund
runuser -u bouwboot -- npm run build
systemctl restart bouwboot
sleep 2
systemctl --no-pager --lines=5 status bouwboot || true
