#!/usr/bin/env bash
# Runs every 10 minutes (bouwboot-update.timer): updates only when GitHub has something new.
set -euo pipefail
cd /opt/bouwboot
runuser -u bouwboot -- git fetch -q origin main
if [ "$(runuser -u bouwboot -- git rev-parse HEAD)" != "$(runuser -u bouwboot -- git rev-parse origin/main)" ]; then
  echo "Nieuwe versie gevonden, bijwerken..."
  # pull first, so the update script that runs is the new one
  runuser -u bouwboot -- git pull -q --ff-only
  bash /opt/bouwboot/deploy/update.sh
fi
