# Project Instructions

## Product

- Product: Pocket Monster Brawl, an invite-only league for save-sourced manual battles.
- Primary user loop: upload an exported save, register a locked team, join a scheduled match,
  choose moves/switches, and receive a recorded result.
- Launch model: local development now; private friends pilot later.
- Mobile-first target: 360–430 px, then tablet and desktop.

## Stack

- Client: React 19, Vite 8, TypeScript 6, React Router, TanStack Query.
- Styling: SCSS Modules with the tokens in `apps/web/src/index.css`.
- API: Node.js 24, Fastify, PostgreSQL, and Drizzle migrations.
- Live battle: Socket.IO and a pinned Pokemon Showdown simulator worker when implemented.
- Save parser: a separate .NET 10 service with pinned PKHeX.Core when implemented.
- Hosting: Docker Compose on one always-on Linux host with HTTPS; provider not selected.
- PWA: deferred until live battle/reconnect behavior works; never cache authenticated data or moves.

## Commands

- Install: `npm install`
- Develop: `npm run dev`
- Lint: `npm run lint`
- Type check: `npm run typecheck`
- Unit tests: `npm test`
- Production build: `npm run build`
- Required full check: `npm run check`
- Generate migration: `npm run db:generate -w @pmb/server`
- Apply migration: `npm run db:migrate -w @pmb/server`

## Backend and security

- Store schema history in `apps/server/drizzle` and never edit an applied migration.
- The server owns registered teams, battle state, legal requests, decisions, seeds, and results.
- Keep raw saves private. Do not trust filenames, extensions, or browser-supplied team data.
- Validate archive paths, decompressed size, metadata, and assets for every `.deltaskin` import.
- Never execute skin package content or load external skin asset URLs.
- Keep secrets out of client code and Git; commit only placeholder names in `.env.example`.
- Make registered team versions and frozen season-rule versions immutable.
- Journal accepted battle decisions with request IDs and idempotency before acknowledgment.

## Domain boundaries

- Game adapters preserve source-native data and provenance.
- Battle adapters map snapshots to the engine and validate explicitly.
- Versioned profiles choose mechanics and competition rules per season/match.
- UI capabilities describe available concepts; do not hard-code Generation III globally.
- Controller skins are cosmetic and must never select rules or reveal hidden battle state.

## Delivery

- Preserve unrelated user changes in a dirty worktree.
- Implement and verify phone layouts before desktop refinements.
- Run `npm run check` before handoff.
- Do not claim FireRed import support without real-save fidelity fixtures and written comparison.
- Do not claim Delta compatibility from the labeled development fixture alone.
- Do not deploy or select paid infrastructure without explicit user direction.
