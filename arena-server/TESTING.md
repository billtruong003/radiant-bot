# Testing — Radiant Arena Server

How to run the test + smoke loops for `arena-server/` during development.

---

## Quick reference

| Command | What it does | When to use |
|---|---|---|
| `npm run typecheck` | `tsc --noEmit` | Catch type errors fast. Run after every edit. |
| `npm run lint` | Biome over `src/` (config in `biome.json`) | Catch style/format/import-order issues. Auto-fix via `npm run lint:fix`. |
| `npm test` | Vitest single-run | Unit tests for auth, admin handler, future physics. Fastest signal. |
| `npm run test:watch` | Vitest watch mode | Live re-run as you edit. |
| `npm run build` | `tsc -p tsconfig.build.json` → `dist/` | Catches anything `--noEmit` skips. |
| `npm run smoke` | `tsx scripts/smoke-room.ts` | End-to-end smoke against a **running** dev server. |
| `npm run dev` | `tsx watch src/index.ts` | Hot-reload dev server. Required for `npm run smoke`. |

The full pre-commit gate is `npm run typecheck && npm run lint && npm test && npm run build`. CI in `D.9` will run the same chain plus `smoke` against a freshly-launched server.

---

## Unit tests (`npm test`)

Vitest configured in [`vitest.config.ts`](./vitest.config.ts). Tests live under `tests/`:

- `tests/auth.test.ts` — HMAC token sign/verify round-trips (Lát D.2 baseline, 12 cases).
- `tests/admin-create.test.ts` — `/admin/create-room` handler (Lát D.3, 4 cases — happy / 401 bad sig / 503 over-limit / 400 invalid body).
- `tests/turn-loop.test.ts` — DuelRoom message handlers + state machine (Lát D.4, 12 cases). Uses `@colyseus/testing` to boot an in-memory server and connect mock WS clients, then drives select_weapon → ready → countdown → active → shoot → animating → animation_complete → next turn → concede → ended.

### Env stubbing
`vitest.config.ts` sets `test.env.*` with safe defaults (test secrets + dummy port). `src/env.ts` runs `parseEnv()` at module load and would otherwise `process.exit(1)` during test import — vitest's `env` block satisfies the Zod schema before any test file resolves its imports.

If you need a test to assert env-failure behavior, override per-test with `process.env.X = ''` in `beforeEach` and re-import the module via dynamic `await import()` after each override.

### `@colyseus/testing` quirks
The harness's `boot()` import at module top crashes vitest's worker-IPC
serializer (`TypeError: Buffer.from on Object`). Workaround: lazy-load via
dynamic `await import('@colyseus/testing')` inside `beforeAll`. See
`tests/turn-loop.test.ts` for the pattern.

`pool: 'threads'` is also required in `vitest.config.ts` — the default
`forks` pool hits the same serializer bug.

`vitest.config.ts` shortens timer envs (`COUNTDOWN_MS=300`,
`TURN_DEADLINE_MS=1500`, `ANIMATION_TIMEOUT_MS=1000`,
`RESULT_DISPOSE_DELAY_MS=200`) so turn-loop tests complete in ~6s instead
of waiting the real spec values (3s/30s/8s/10s).

### Mocking Colyseus `matchMaker`
`matchMaker.createRoom` is a non-configurable getter on the `@colyseus/core` singleton — `vi.spyOn` fails on it. The admin-create test demonstrates the workaround: module-level `vi.mock('@colyseus/core', async (importOriginal) => { ... })` with `importOriginal` to keep `Room`, `Client`, etc. intact (DuelRoom needs them).

### Adding new tests
1. Add `tests/<feature>.test.ts`. Vitest picks it up automatically (`include: ['tests/**/*.test.ts']`).
2. If your code imports `src/env.ts` transitively, the env stub in `vitest.config.ts` covers you. Add new env vars to that block if you introduce them.
3. Mock external deps via `vi.mock()` at module top — supertest + `import('../src/...')` after the mock for cleanest layering.

---

## Smoke test (`npm run smoke`)

`scripts/smoke-room.ts` pretends to be the bot: probes `/health`, builds a valid `CreateRoomRequest` body, signs with `ARENA_TOKEN_SECRET`, POSTs to `/admin/create-room`, asserts the 200 response shape. Real Colyseus room is created (not mocked) — proves the full handler-to-`matchMaker.createRoom` path.

### Setup (one-time)
```bash
cp .env.example .env
# Edit .env — set ARENA_TOKEN_SECRET + ARENA_RESULT_SECRET to any non-empty values.
# For pairing with the bot, the values MUST match bot's .env.
```

### Run
```bash
# Terminal 1 — start the dev server
npm run dev
# → "arena server listening" on port 2567

# Terminal 2 — run smoke
npm run smoke
# → [smoke] probing http://localhost:2567/health ...
# → [smoke] health OK
# → [smoke] POST http://localhost:2567/admin/create-room (body 1234 bytes)
# → [smoke] ✓ room created: room_name=ABC123XYZ ws_url=ws://localhost:2567
# → [smoke] PASS
```

### Exit codes
- `0` — smoke passed
- `1` — misconfigured (env or unexpected error)
- `2` — server unreachable (start `npm run dev` first)
- `3` — handler rejected the request (signature / body / capacity)
- `4` — handler accepted but malformed response

CI integrations can read the exit code instead of grep'ing log output.

---

## Debugging tips

### Test fails: `[env] invalid environment: ARENA_TOKEN_SECRET: Required`
The vitest `env` block in `vitest.config.ts` should prevent this. If you see it, your test imported `src/env.ts` BEFORE vitest applied the env stub — usually because the test loads via static `import` instead of dynamic `await import()`. Restructure top-of-file imports OR move secret-touching code into a dynamic import after `vi.mock`.

### Test fails: `Cannot redefine property: createRoom`
You're using `vi.spyOn(matchMaker, 'createRoom')`. Colyseus's matchMaker is frozen. Use the `vi.mock('@colyseus/core', async (importOriginal) => ...)` pattern from `tests/admin-create.test.ts`.

### Smoke fails: `/health unreachable`
The dev server isn't running. Open another terminal and run `npm run dev`. Confirm it logs `arena server listening` on the port you expect.

### Smoke fails: `401 invalid_signature`
`ARENA_TOKEN_SECRET` in your `.env` doesn't match the value the server is running with. Either:
- Restart `npm run dev` after editing `.env` (the running process snapshotted the old value).
- Verify your `.env` is in `arena-server/`, not the parent monorepo root.

### Smoke fails: `503 ROOM_LIMIT_REACHED`
The dev server has been running long enough to accumulate 5 zombie rooms. Restart `npm run dev` to reset the counter, or set `MAX_CONCURRENT_ROOMS=50` in `.env` for development.

### Lint complains about CRLF on a fresh checkout
Git's `autocrlf` converts LF → CRLF on Windows checkout. Run `npm run lint:fix` to normalize, OR add a project-level `.gitattributes` enforcing `* text=auto eol=lf` (not yet committed — TODO).

### `process.exit unexpectedly called`
A module under test called `process.exit()` synchronously. Vitest catches this and reports the test as failed. Usually means `src/env.ts` ran with missing vars (see env-stub note above).
