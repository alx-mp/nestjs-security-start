# back-eduia

NestJS 11 API on Fastify 5, behind the Astro BFF (`../dashboard-eduai`).
Cloned from the hardened gymlord-back base and meant, like the front, to be
copied for future projects. Keep it on current stable and keep these notes
true.

## Stack

Checked 2026-08-17 against the registry. Exact versions in `package.json`, no
ranges (`.npmrc` sets `save-exact`).

| Piece                    | Pinned  | Latest | Why not newer                                     |
| ------------------------ | ------- | ------ | ------------------------------------------------- |
| @nestjs/common, core, platform-fastify, testing | 11.2.1 | 11.2.1 | current (first-party, exempt from the release-age gate) |
| @nestjs/swagger          | 11.4.7  | 11.4.7 | current (same exemption)                           |
| fastify                  | 5.11.3  | 5.12.0 | must match the fastify that @nestjs/platform-fastify bundles (11.2.1 → 5.11.3), or two copies land in the tree and the plugin types stop lining up. Check `pnpm view @nestjs/platform-fastify dependencies` before bumping. |
| @fastify/helmet          | 13.1.0  | 13.1.0 | current                                            |
| @fastify/compress        | 9.2.0   | 9.2.0  | current                                            |
| @fastify/static          | 10.1.3  | 10.1.3 | current. Not optional: swagger-ui on Fastify needs it, and without it the app dies at boot in dev. |
| typeorm                  | 1.1.0   | 1.1.0  | current (1.x line)                                 |
| pg                       | 8.23.0  | 8.23.0 | current                                            |
| zod / nestjs-zod         | 4.4.3 / 5.5.0 | same | current                                      |
| pino / nestjs-pino       | 10.3.1 / 4.6.1 | same | current                                     |
| argon2                   | 0.45.1  | 0.45.1 | current                                            |
| typescript               | 6.0.3   | 7.0.2  | typescript-eslint 8.67 declares peer `<6.1.0`, so 6.0.x is the newest valid pin and 7 (the native-compiler rewrite) is out of range. TS 6 also forced the explicit `rootDir` in tsconfig.build.json (TS5011). Same reason the front sits on 6. |
| @swc/core                | 1.16.0  | 1.16.0 | current (dated exemption in pnpm-workspace.yaml)    |
| eslint / typescript-eslint | 10.8.1 / 8.67.0 | same | current                                  |
| vitest                   | 4.1.10  | 4.1.10 | current                                            |
| chokidar                 | 5.0.0   | 5.0.0  | direct devDep only to satisfy @swc/cli's optional peer under `strictPeerDependencies`. |
| pnpm                     | 11.1.1  | 11.1.1 | pinned in `packageManager`                          |
| node                     | >=24    | 24.x   | prod runtime; dev server runs on bun 1.3.13         |

Nest 12 exists only as alpha. 11.x is the correct line.

## Port 3125, host 127.0.0.1

The front dev server owns 4325; gymlord-back owns 3120 and 3130. This API
binds 3125, loopback only: nothing but the BFF ever calls it, so `HOST`
defaults to `127.0.0.1` and only the production container overrides it to
`0.0.0.0`. Check `ss -ltnp` before claiming a port for a clone, and never
`fuser -k` a port without checking who owns it.

## pnpm installs, bun runs

```sh
pnpm install            # dependencies
pnpm add <pkg>          # add one (exact version gets written)
pnpm update --latest    # move to current stable
pnpm audit              # advisories

bun run start:dev       # bun --watch on :3125 (systemd runs this, see infra/)
bun run build           # lockfile check -> nest build (SWC + type check)
bun run typecheck       # tsc --noEmit
bun run lint            # eslint src test
bun run test            # vitest unit suite
bun run test:e2e        # vitest against eduia_test (never eduia)
bun run ci              # lockfiles + lint + types + unit tests + build
bun run migration:run   # TypeORM migrations against .env's database
bun run keys:generate   # ES256 keypair into keys/
```

`npm install` and `bun install` are blocked the same three ways as the front:
`engines.npm`/`engines.yarn` say `please-use-pnpm` with `engine-strict`,
`scripts/enforce-pnpm.mjs` runs as preinstall, and `scripts/check-lockfiles.mjs`
fails the build if a foreign lockfile ever appears.

One deliberate difference from the front: `bunfig.toml` does NOT set
`[run] bun = true`. Production runs `node dist/main.js`, so `nest build` and
the compiled output must go through the same Node that ships. The dev server
already runs on bun because the script says `bun --watch` explicitly. A
bun-only API that sneaks into src/ dies in the prod container; stick to Node
APIs.

Supply chain lives in `pnpm-workspace.yaml` (pnpm 11 ignores these keys in
`.npmrc`): 3-day `minimumReleaseAge` with strict fail,
`trustPolicy: no-downgrade` scoped to the last 30 days, `blockExoticSubdeps`,
`allowBuilds` as an allow-list (argon2, @swc/core, esbuild; @scarf/scarf is
telemetry and stays denied), `strictDepBuilds`, `strictPeerDependencies`,
`engineStrict`. The age gate exempts the hand-pinned first-party `@nestjs/*`
packages (plus a dated `@swc/core*` entry), the same way the front exempts
first-party Astro: a framework bump is a deliberate, reviewed act, and the
gate exists for the transitive packages nobody reads. When
`ERR_PNPM_NO_MATURE_MATCHING_VERSION` hits a third-party package, pin the
previous mature version or add a dated exclude and take it back out.

## Code rules (same contract as the front)

- Files stay under 400 lines, 500 as the hard ceiling. Split by
  responsibility past that.
- Functions stay under 20 lines. Extract helpers.
- Everything is annotated. No signature left to inference that can degrade
  to `any` in an editor.
- Code comments and messages in English; user-facing docs in Spanish.
- DTOs are `createZodDto(schema)`. Input schemas are `.strict()`, so an
  unknown field is a 400. Responses go through `@ZodSerializerDto(...)`,
  which is what keeps `passwordHash` and friends out of the wire format.
- DB columns snake_case via `SnakeNamingStrategy`, TS camelCase. Dates are
  `timestamptz`. Constraints and indexes get explicit names.
- `synchronize: false`. The schema changes only through migrations, and
  entities/migrations are explicit class arrays in `data-source.ts`: if it is
  not registered there, it does not exist.
- Env is read once, through the zod schema in `src/config/env.ts`, consumed
  via `AppConfigService`. Never `process.env` in feature code.

## Security rules that do not bend

- The global providers in `app.module.ts` (ThrottlerGuard, ZodValidationPipe,
  ZodSerializerInterceptor, both filters) and the guards in `auth.module.ts`
  stay. A public endpoint gets `@Public()`; nobody disables the guard.
- Guard order matters: ThrottlerGuard first (AppModule), then JwtAuthGuard
  sets `req.user`, then RolesGuard reads it (both in AuthModule).
- Access tokens are ES256, 15 minutes, issuer `back-eduia`, audience `eduia`,
  claim `typ: 'access'`. Anything that verifies them elsewhere (the BFF, for
  instance) must check exactly those.
- Refresh tokens are opaque 48-byte values stored as SHA-256 hashes and
  rotated on every use. A rotated token showing up again means theft: every
  session of that user is revoked. `test/app.e2e-spec.ts` pins this.
- Login failures are indistinguishable on the wire. Unknown email, wrong
  password, locked account and deactivated account all answer the same 401
  with the same body, at the same argon2id cost (dummy-hash verify). The
  reason goes to the log, not the client.
- Lockout after `AUTH_MAX_LOGIN_ATTEMPTS` (5) for `AUTH_LOCKOUT_MINUTES`
  (15), counted in one atomic SQL statement so concurrent failures cannot
  race past the threshold.
- Env validation fails the boot on purpose: CORS required and `*`-free in
  production, PEM keys parsed and pinned to P-256 at startup. Do not relax it.
- Secrets arrive as env vars or their `*_FILE` variant (file wins). Nothing
  secret in code, in units, or in versioned files. `.env` and `keys/` are
  gitignored; the DB password lives in `/root/.eduia-db-password` (600).
- Logs redact `authorization` and `cookie`; the TypeORM logger prints SQL
  without parameters so emails and hashes stay out of stdout. Every response
  carries `X-Request-ID`.
- Client-facing errors are generic (`Invalid credentials`, bare 500 for
  anything unmapped). Detail belongs to the filters' server-side log.

## Talking to the front

The browser never reaches this API. `dashboard-eduai` calls it server-side
through `src/lib/api.ts`, forwarding the end user's Bearer token; its
`API_URL` points at `http://127.0.0.1:3125` (set in the front's `.env`,
`.env.example`, `astro.config.mjs` default and `infra/install.sh` seed).
Server-to-server calls carry no Origin header and CORS lets them through; the
`CORS_ORIGINS` allowlist only matters if a direct browser call is ever added,
and adding one means also touching the front's `connect-src`.

Throttler tiers are sized for that shape: all traffic arrives from one IP, so
the global buckets (40/1s, 200/10s, 800/60s) only stop runaway loops, and the
per-route `@Throttle` overrides on `/v1/auth/*` (3-10/min) are what actually
guard brute force. Do not lower the globals. `@SkipThrottle()` needs
`{ short: true, medium: true, long: true }`; the bare form is a no-op.

## Database

PostgreSQL 18, the host's `postgres-18` podman container on 127.0.0.1:5433.
App database `eduia`, e2e database `eduia_test`, both owned by role `eduia`;
`scripts/db/init-db.sh` provisions them idempotently. E2E setup forces
`DB_DATABASE=eduia_test` and drops/recreates schema `public` on every run —
never point the e2e suite at `eduia`. `vitest.e2e.config.mts` runs files
serially (`fileParallelism: false`) because each suite rebuilds the schema.

## Dev server under systemd

`bash infra/install.sh` installs `back-eduia-dev.service` (bun --watch, port
3125, `ExecStartPre` clears the port, SELinux bash shim because init_t cannot
exec binaries under /root) plus a 45-second `/health/live` watchdog timer.
Day to day: `infra/stack.sh status|restart|logs|redeploy`; `status` warns when
the running boot is older than the newest source or `.env` change. Do not
hand-start anything on 3125: the unit kills strays at startup. Do not
"simplify" the `ExecStart` bash indirection; it is the SELinux fix.

`/health` (terminus: DB ping + heap ceiling) and `/health/live` are
unversioned and skip throttling and request logging. Swagger serves `/docs`
in dev only unless `SWAGGER_ENABLED` says otherwise.

## After any change

Run the test that covers the touched path and show the output. Unit for
services, e2e for anything touching auth, headers or the HTTP surface. No
claim of success without evidence.

## Updating

```sh
pnpm update --latest
bun run ci
```

Then update the Stack table. Expect the release-age gate to hold back
anything under 3 days old, and re-check the fastify row: the root pin must
follow whatever `@nestjs/platform-fastify` bundles.

## Still open

- No git repository yet (same as the front), so no history and nothing for
  `ci` to hang on.
- Production deploy (container build is ready in `Dockerfile`; no compose or
  target host defined yet).
- The Caddy vhost, if this API ever gets exposed beyond loopback. Today it
  must not be.
