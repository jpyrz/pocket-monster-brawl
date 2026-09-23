# Pocket Monster Brawl

An invite-only friends league for registering teams from exported game saves and playing
manual browser battles. FireRed with Generation III mechanics is the first pilot profile;
the profile architecture is intentionally not tied to one generation.

This repository contains the foundation, a local battle integration spike, the first real
FireRed save-import slice, and a durable account-to-tournament journey designed for one
self-hosted LAN server. Players connect from phones or computers on the same Wi-Fi. It does
**not** currently support internet play.

## What works now

- Mobile-first React/Vite shell with an immersive, full-viewport controller battle mode.
- Installable mobile app shell with a web manifest, iOS Home Screen metadata, safe-area
  layout, app icons, and static-only service-worker caching when served from a secure origin.
- Restart-safe local account creation/sign-in with scrypt-hashed passwords and HTTP-only sessions.
- Persistent-product UI for league creation, username lookup/invitations, joining, member
  rosters, admin tournament setup, and private per-tournament team preparation.
- Persistent private Pokémon Boxes populated from supported save imports, with full stats,
  moves, IVs, EVs, source-game provenance, and server-enforced tournament eligibility.
- Personalized Trainer Cards with selectable trainer artwork, battle record, and an animated
  partner Pokémon chosen from the player's private Box.
- Replaceable, restart-safe private team drafts during open registration, backed by immutable
  registered-team versions once a player locks for the event.
- Admin-selected tournament entrants, immutable team locking, generated single-elimination
  brackets for two or more players, automatic winner advancement, and authenticated match rooms
  that restrict each account to its assigned side and locked save-sourced team.
- PostgreSQL-journaled battle choices, pinned engine seeds/versions, restart reconstruction,
  best-of series scores, and persisted winners.
- Fastify API with health, profile, account, league, team-lock, authenticated-match, and
  local demo-battle endpoints.
- A pinned Pokémon Showdown simulator running a real server-owned Generation III custom
  battle between two validated fixture teams.
- Pokémon Showdown's battle scene renderer, including its Generation III sprites, battle
  HUD, messages, health-bar transitions, and move/faint/switch animations.
- Private Red/Blue battle views, legal move and switch submission, stale-choice protection,
  forced replacement handling, battle logs, and deterministic local reset.
- A loopback-only .NET 10 parser pinned to PKHeX.Core 26.8.26, with strict raw FireRed
  save validation and extraction of party/box Pokémon, moves, stats, IVs, EVs, and legality.
- An Analogue Pocket import screen with a parsed collection view and Generation III sprites.
- Server-owned team selection and ordering that resolves selected fingerprints against the
  parsed snapshot, freezes an immutable local registration, and rejects invented or duplicate
  Pokémon instead of trusting battle attributes submitted by the browser.
- An explicit PKHeX-to-Showdown adapter that preserves source level, species, moves, ability,
  nature, IVs, EVs, friendship, gender, shiny state, nickname, and held item.
- Tournament battle handoff that loads both players' locked imported teams while starting
  fully healed with Showdown's default maximum move PP.
- No raw-save persistence: uploaded bytes are passed through the local API to the local
  parser in memory, and the original source file is never written or changed.
- Shared versioned game/rules profiles for FireRed/Gen III and a test-only Gen II fixture.
- Source-tagged Pokemon snapshot types that preserve generation-native trained values.
- Delta metadata adapter for the documented single-screen portrait GBA subset, including
  current `screens[].outputFrame` and legacy `gameScreenFrame` geometry.
- Explicit reporting for unmapped emulator-only controls and validation for unsafe assets.
- Drizzle/PostgreSQL schema and migrations for users, sessions, leagues, invitations,
  tournaments, rules, save provenance, private drafts, locked teams, bracket series, and battles.
- A real PostgreSQL 18 service with a persistent Docker volume. Accounts, sessions, leagues,
  invitations, tournaments, normalized Pokémon snapshots, and team drafts survive restarts.

The purple controller is a clearly labeled development fixture. It is not third-party Delta
artwork and does not close the real-skin acceptance gate.

## Quick start

Only the host computer needs the repository and Docker. Everyone else joins from a browser on
the same Wi-Fi.

### 1. Install Docker

Install the latest [Docker Desktop](https://www.docker.com/products/docker-desktop/) for your
computer, open it, and wait until Docker reports that it is running. No paid account is needed
for personal use.

### 2. Start Pocket Monster Brawl

Open a terminal in the pulled-down repository folder.

macOS/Linux:

```bash
bash start-lan.sh
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-lan.ps1
```

The first start downloads and builds the required containers, so it can take several minutes.
No separate Node.js, .NET, PKHeX, or PostgreSQL installation is required.

### 3. Open the app

The launcher prints these addresses:

- The host opens `http://localhost:3000`.
- On a Mac-hosted game, other players use the stable `.local` address, such as
  `http://James-MacBook-Pro.local:3000`, while connected to the host's Wi-Fi.
- The numeric LAN address is also printed as a fallback, but it can change when the router
  assigns the host a new IP.

Keep Docker running while the app is in use. Internet access is currently required for the
Showdown battle artwork.

On iPhone, open the printed `.local` address in Safari, use **Share → Add to Home Screen**, and
launch Pocket Monster Brawl from its icon. If the app was previously installed from a numeric
IP address, delete that copy and add it once from the `.local` address; it will then keep the
same URL when the host's IP changes. If `.local` discovery is unavailable on your network, use
the printed IP fallback instead.

## Starting, stopping, and updating

Run the same start script whenever the app is stopped. To stop it without deleting data:

```bash
docker compose down
```

To update an existing checkout:

```bash
git pull
bash start-lan.sh
```

Windows users run `git pull` followed by the same PowerShell start command from step 2.

Accounts, leagues, tournaments, and team drafts remain in the `pmb_postgres` Docker volume
across restarts and rebuilds. **Do not run `docker compose down --volumes` unless you intend to
erase all application data.**

## Backup

Create a portable PostgreSQL backup with `bash backup-lan.sh` on macOS/Linux or
`.\backup-lan.ps1` in PowerShell. Backups are written under the ignored `backups` directory;
copy them off the host computer before an important event.

## Troubleshooting

```bash
docker compose ps        # all three services should be healthy
docker compose logs app  # show application errors
```

If a phone cannot connect, confirm it is on the same Wi-Fi. Try the printed `.local` address
first, then the current IP fallback.

## Source development

For source development without containers, Node.js 24 and .NET 10 are still required. Start
PostgreSQL separately, set `DATABASE_URL`, and run `npm install && npm run dev`.

## Commands

```bash
npm run dev          # web, API, and PKHeX parser together
npm run dev:web      # web only
npm run dev:api      # API only
npm run dev:parser   # PKHeX parser only
npm run parser:build
npm run lint
npm run typecheck
npm test
npm run build
npm run check        # all required checks
```

## Repository map

```text
apps/web             React client and controller lab
apps/server          Fastify API and Drizzle schema/migrations
packages/domain      Shared profile, Pokemon, and skin contracts
services/save-parser Loopback-only .NET/PKHeX FireRed parser
compose.yaml         Complete self-hosted LAN stack
```

## Next acceptance gates

1. Supply or approve one reusable single-screen GBA `.deltaskin`, including creator credit
   and reuse permission, then validate real artwork/hit-region alignment.
2. Complete and record an independent field-by-field PKHeX desktop comparison for the pilot save.
3. Add LAN administration and authentication hardening, including account recovery, rate
   limiting, CSRF protection, and an initial host-admin bootstrap flow.
4. Add organizer controls for forfeits, no-shows, bracket corrections, and tournament resets.
5. Replace battle polling with authenticated realtime updates and add disconnect timers/adjudication.

The renderer spike currently loads the official client assets from
`play.pokemonshowdown.com` at runtime. Pinning/self-hosting those assets and completing a
third-party art/license review are required before a production release. See
`THIRD_PARTY_NOTICES.md` for the current integration boundary.

LAN discovery/QR setup, sockets, local HTTPS, and a packaged desktop
installer remain unfinished. The Docker Compose stack is the current supported runtime.
