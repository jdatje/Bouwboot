#!/usr/bin/env bash
# Downloads the LDraw parts library (3D shapes of LEGO parts, ldraw.org, CC BY 2.0) and the Rebrickable
# database (parts and set inventories) into DATA_DIR. Only when missing or older than 30 days.
set -uo pipefail
DATA_DIR="${DATA_DIR:-/var/lib/bouwboot}"
[ -f /etc/bouwboot.env ] && DATA_DIR="$(grep -E '^DATA_DIR=' /etc/bouwboot.env | cut -d= -f2- || echo "$DATA_DIR")"
DATA_DIR="${DATA_DIR:-/var/lib/bouwboot}"
command -v unzip >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unzip; }
fresh() { [ -e "$1" ] && [ -n "$(find "$1" -maxdepth 0 -mtime -30 2>/dev/null)" ]; }

if ! fresh "$DATA_DIR/ldraw/.done"; then
  echo "LDraw-bibliotheek ophalen..."
  tmp="$(mktemp -d "$DATA_DIR/ldraw-new.XXXX")"
  if curl -fsSL -o "$tmp/complete.zip" https://library.ldraw.org/library/updates/complete.zip &&
     curl -fsSL -o "$tmp/unf.zip" https://library.ldraw.org/library/unofficial/ldrawunf.zip; then
    if (cd "$tmp" && unzip -q complete.zip && mkdir -p unofficial && cd unofficial && unzip -q ../unf.zip); then
      rm -f "$tmp"/*.zip && touch "$tmp/.done"
      rm -rf "$DATA_DIR/ldraw.old"; [ -d "$DATA_DIR/ldraw" ] && mv "$DATA_DIR/ldraw" "$DATA_DIR/ldraw.old"
      mv "$tmp" "$DATA_DIR/ldraw" && rm -rf "$DATA_DIR/ldraw.old" "$DATA_DIR/ldraw-cache"
    else
      echo "LDraw uitpakken mislukt (schijf vol?)"; rm -rf "$tmp"
    fi
  else
    echo "LDraw ophalen mislukt"; rm -rf "$tmp"
  fi
fi

mkdir -p "$DATA_DIR/rebrickable"
if ! fresh "$DATA_DIR/rebrickable/.done"; then
  echo "Rebrickable-gegevens ophalen..."
  ok=1
  for f in parts part_categories part_relationships inventories inventory_parts sets colors; do
    curl -fsSL -o "$DATA_DIR/rebrickable/$f.csv.gz" "https://cdn.rebrickable.com/media/downloads/$f.csv.gz" || ok=0
  done
  [ $ok = 1 ] && touch "$DATA_DIR/rebrickable/.done"
fi
chown -R bouwboot:bouwboot "$DATA_DIR/ldraw" "$DATA_DIR/rebrickable" 2>/dev/null || true
