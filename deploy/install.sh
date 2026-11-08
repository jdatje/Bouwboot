#!/usr/bin/env bash
# Installs Bouwboot in a fresh Debian/Ubuntu LXC container (run as root).
set -euo pipefail

apt-get update
apt-get install -y curl git ca-certificates build-essential python3
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id bouwboot >/dev/null 2>&1 || useradd --system --home /opt/bouwboot --shell /usr/sbin/nologin bouwboot
if [ ! -d /opt/bouwboot/.git ]; then
  git clone https://github.com/jdatje/Bouwboot /opt/bouwboot
fi
mkdir -p /var/lib/bouwboot
chown -R bouwboot:bouwboot /opt/bouwboot /var/lib/bouwboot

if [ ! -f /etc/bouwboot.env ]; then
  cp /opt/bouwboot/deploy/bouwboot.env.example /etc/bouwboot.env
  chmod 600 /etc/bouwboot.env
  echo ">>> Vul nu /etc/bouwboot.env in (nano /etc/bouwboot.env) en draai daarna: bash /opt/bouwboot/deploy/update.sh"
fi

cp /opt/bouwboot/deploy/bouwboot.service /etc/systemd/system/bouwboot.service
systemctl daemon-reload
systemctl enable bouwboot
bash /opt/bouwboot/deploy/update.sh
bash /opt/bouwboot/deploy/install-autoupdate.sh
