# Pocket Monster Brawl

An invite-only friends league for registering teams from exported game saves and playing
manual browser battles. FireRed with Generation III mechanics is the first pilot profile;
the profile architecture is intentionally not tied to one generation.

This repository contains the foundation, a local battle integration spike, the first real
FireRed save-import slice, and a durable account-to-tournament journey designed for one
self-hosted LAN server. Players connect from phones or computers on the same Wi-Fi. It does
**not** currently support internet play or persist active Showdown battles and match results.

## What works now

- Mobile-first React/Vite shell with an immersive, full-viewport controller battle mode.
- Restart-safe local account creation/sign-in with scrypt-hashed passwords and HTTP-only sessions.
- Persistent-product UI for league creation, username lookup/invitations, joining, member
  rosters, admin tournament setup, and private per-tournament team preparation.
- Replaceable, restart-safe private team drafts during open registration; the database schema
  separately models immutable registered-team versions for the later event-day lock operation.
- Fastify API with health, profile, and local demo-battle endpoints.
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
- Demo-battle handoff that replaces Red's fixture roster with the locked imported team while
  starting fully healed with Showdown's default maximum move PP.
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

## Run the LAN application

Only the host computer needs setup. Install Docker Desktop, clone this repository, and start
the complete stack. Players do not install Node.js, .NET, PKHeX, or PostgreSQL.

macOS or Linux:

```bash
bash start-lan.sh
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-lan.ps1
```

The script builds and starts the browser app/API, private PKHeX parser, and PostgreSQL. It
prints `http://localhost:3000` for the host and a LAN URL for phones on the same Wi-Fi. The
first build downloads the Node, .NET, and PostgreSQL images and can take several minutes.

Stop without deleting data:

```bash
docker compose down
```

The `pmb_postgres` Docker volume retains application data. Do not add `--volumes` unless you
intend to erase every account, league, tournament, and draft. The parser and database expose
no host ports; only the combined web application is reachable from the LAN.

Create a portable PostgreSQL backup with `bash backup-lan.sh` on macOS/Linux or
`.\backup-lan.ps1` in PowerShell. Backups are written under the ignored `backups` directory;
copy them off the host computer before an important event.

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
compose.yaml         Local PostgreSQL service
```

## Next acceptance gates

1. Supply or approve one reusable single-screen GBA `.deltaskin`, including creator credit
   and reuse permission, then validate real artwork/hit-region alignment.
2. Complete and record an independent field-by-field PKHeX desktop comparison for the pilot save.
3. Add LAN administration and authentication hardening, including account recovery, rate
   limiting, CSRF protection, and an initial host-admin bootstrap flow.
4. Implement tournament lock/start, bracket generation, best-of series progression, and champion recording.
5. Persist active battle decisions/results and replace polling with authenticated realtime match rooms.

The renderer spike currently loads the official client assets from
`play.pokemonshowdown.com` at runtime. Pinning/self-hosting those assets and completing a
third-party art/license review are required before a production release. See
`THIRD_PARTY_NOTICES.md` for the current integration boundary.

The PWA service worker, LAN discovery/QR screen, sockets, durable active battles, and packaged
desktop installer remain unfinished. The Docker Compose stack is the current supported runtime.
