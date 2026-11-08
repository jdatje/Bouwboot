# Bouwboot

Typ iets ("krokodil"), zie het in Lego-stenen verschijnen, bouw het na met stap-voor-stap-instructies en koop de stenen die je nog mist. Bouwboot houdt bij welke stenen er in huis zijn.

## Hoe het werkt

- **Ontwerpen**: er zijn twee bouwmethodes.
  - **Schets → 3D (standaard).** Gemini tekent het als speelgoed, TripoSR maakt er een 3D-vorm van (op een gehuurde GPU bij Modal) en die wordt in stenen opgedeeld. De kleuren komen uit de tekening. Werkt goed voor dieren en figuren.
  - **BrickGPT.** Een taalmodel dat steen voor steen een stabiel bouwwerk bedenkt. Gemini kleurt het daarna in. Goed in meubels en voertuigen, zwakker in dieren.
  - Op de resultaatpagina wissel je met "probeer de andere bouwmethode".
- **Stenen**: alleen gewone stenen (1×1, 1×2, 1×4, 1×6, 1×8, 2×2, 2×4, 2×6).
- **Kopen**: de site maakt een BrickLink-*wanted list* (XML) met alleen wat je nog mist. Upload hem op BrickLink en kies *Easy Buy*. Druk daarna op "Ik heb besteld". Als het pakket binnen is, vink je aan wat er binnen is; dat gaat dan het magazijn in.
- **Magazijn**:
  - Sets toevoegen met het setnummer (onderdelenlijst via Rebrickable).
  - Losse stenen toevoegen, of stenen scannen met een foto.
  - Onderdelen kun je op "kwijt" zetten.
  - Gebouwde sets en bouwwerken zet je op "staat in elkaar"; die stenen tellen dan niet mee als beschikbaar.
- **Alleen mijn stenen**: ontwerpt alleen met maten en kleuren die je hebt.

## Installeren op HomeDC

1. Maak in Proxmox een nieuwe LXC-container: Debian 12, 1 core, 1 GB RAM, 8 GB schijf.
2. Log in op de container en draai:
   ```bash
   apt-get update && apt-get install -y git
   git clone https://github.com/jdatje/Bouwboot /opt/bouwboot
   bash /opt/bouwboot/deploy/install.sh
   ```
3. Vul de sleutels in: `nano /etc/bouwboot.env` (zie hieronder). Draai daarna: `bash /opt/bouwboot/deploy/update.sh`.
4. Zet hem online met Tailscale, net als dmdash:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   tailscale up --hostname bouwboot
   tailscale funnel --bg 3000
   ```
   De site staat dan op `https://bouwboot.<jouw-tailnet>.ts.net`.
   - Een LXC-container heeft voor Tailscale toegang tot `/dev/net/tun` nodig. Zie de Tailscale-handleiding voor Proxmox LXC.

### /etc/bouwboot.env

| Sleutel | Wat |
|---|---|
| `APP_PASSWORD` | het wachtwoord voor het huis |
| `GEMINI_API_KEY` | zelfde sleutel als in GitHub |
| `MODAL_TOKEN_SECRET` | het `as-…`-deel van je Modal-token; hieruit wordt de sleutel voor de GPU-dienst afgeleid |
| `REBRICKABLE_API_KEY` | Rebrickable-sleutel |

Als je het Modal-token vervangt:
1. Pas het aan in GitHub (Secrets).
2. Draai de workflow **gpu** opnieuw.
3. Zet de nieuwe `MODAL_TOKEN_SECRET` in `/etc/bouwboot.env` en draai `update.sh`.

### Bijwerken

Gaat vanzelf: elke 10 minuten kijkt de container of er op GitHub een nieuwe versie staat en werkt zichzelf dan bij (`bouwboot-update.timer`). Handmatig kan ook: `bash /opt/bouwboot/deploy/update.sh`. Logboek: `journalctl -u bouwboot-update`.

## Voor ontwikkelaars

- `web/`: SvelteKit + SQLite + three.js. Lokaal zonder GPU of Gemini: `MOCK_GPU=1 MOCK_GEMINI=1 npm run dev`.
- `gpu/`: Modal-app met twee diensten:
  - `Designer`: BrickGPT, versnelde inferentie met KV-cache.
  - `Shaper`: TripoSR → voxels → stenen (`shape3d.py`).
  - Deploy en rooktest via de workflow **gpu**.
- Workflows:
  - **check-secrets** test alle sleutels.
  - **e2e** draait de hele site met echte diensten en maakt screenshots.
- Kosten: een T4-GPU bij Modal kost alleen geld terwijl hij draait (na 5 minuten stilte gaat hij uit). Een ontwerp duurt 10 tot 30 seconden.
