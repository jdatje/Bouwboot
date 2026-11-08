#!/usr/bin/env bash
# Turns on automatic updates (run once as root in the container).
set -euo pipefail
cp /opt/bouwboot/deploy/bouwboot-update.service /opt/bouwboot/deploy/bouwboot-update.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now bouwboot-update.timer
systemctl start bouwboot-update.service
systemctl list-timers bouwboot-update.timer --no-pager
