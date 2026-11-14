#!/usr/bin/env bash
# Pulls the latest version, builds it and restarts the service.
set -euo pipefail
cd /opt/bouwboot
# the brick step of the direct designer runs in Python on this server
python3 -c 'import numpy, scipy' 2>/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-numpy python3-scipy; } || echo 'python3-numpy/scipy niet geinstalleerd'
runuser -u bouwboot -- git pull --ff-only
cd web
runuser -u bouwboot -- npm ci --no-audit --no-fund
runuser -u bouwboot -- npm run build
bash /opt/bouwboot/deploy/fetch-data.sh || echo 'gegevens ophalen mislukt'
systemctl restart bouwboot
sleep 2
systemctl --no-pager --lines=5 status bouwboot || true
