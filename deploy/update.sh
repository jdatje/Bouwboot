#!/usr/bin/env bash
# Pulls the latest version, builds it and restarts the service.
set -euo pipefail
cd /opt/bouwboot
sudo -u bouwboot git pull --ff-only
cd web
sudo -u bouwboot npm ci --no-audit --no-fund
sudo -u bouwboot npm run build
systemctl restart bouwboot
sleep 2
systemctl --no-pager --lines=5 status bouwboot || true
