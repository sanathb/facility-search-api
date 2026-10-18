# Facility Search API — Design

**Status:** Approved · 2026-10-19

This document records the design for the Fitness Passport Facility Search API challenge (Option 1) and the reasoning behind each decision. The brief is in [`docs/CHALLENGE.md`](CHALLENGE.md) (moved from the original `README.md` during implementation).

## 1. Goals and scope

The API lets authenticated members search fitness facilities by name as they type, and fetch one facility's full details. It must stay fast at 100,000+ facilities and be built to production standards in TypeScript, within a time budget of about 2 hours.

| Built | Documented only |
|---|---|
| Search by name (word-prefix, search-as-you-type) | Caching layer (§9) |
| Facility detail by ID | Database-backed storage (§13) |
| Login endpoint wrapping the mock `login()` | Real JWT signature verification |
| Pagination (`limit` / `offset`) | Rate limiting shared across instances |
| Amenity filter | Cursor pagination |
| Health check | Metrics and tracing |
| OpenAPI docs with Swagger UI | |
| Per-instance rate limiting | |

**Constraints**
- TypeScript on Node 24 LTS (`engines: ">=24"`).
- The repository root is `facility-search-api/`. The provided `assets/` folder is never modified.
- The app runs locally with `npm install && npm run dev`, or `npm run build && npm start` for production. No Docker or database is needed.

## 2. Data

`assets/facilities.json` is an array of 100 records with this shape:

```ts
{
  id: string;                                       // "facility-001" … "facility-100", unique
  name: string;                                     // unique, ASCII, ≤ 30 chars
  address: string;                                  // one string, e.g. "123 Market St, Sydney, NSW 2000"
  location: { latitude: number; longitude: number };
  facilities: string[];                             // amenity names, never empty
}
```

The data contains 31 distinct amenity names and a 50/50 split between NSW and VIC.

**Validation at startup.** Every record is checked against a schema, and IDs must be unique. If any check fails, the process logs the index of the failing record and exits with a non-zero code. It never serves partial data. The data file path comes from `DATA_FILE`.

## 3. API

Facility and auth routes are versioned under `/v1`. Health and docs sit at the root.

| Route | Auth | Purpose |
|---|---|---|
| `POST /v1/auth/login` | No | `{ email, password }` → `{ token, user }` via the provided `login()` |
| `GET /v1/facilities` | Bearer | Search or list; returns summaries |
| `GET /v1/facilities/:id` | Bearer | Full details of one facility |
| `GET /health` | No | `{ status: "ok", facilityCount, uptimeSeconds }` |
| `GET /docs` | No | Swagger UI; raw OpenAPI document at `/docs/json` |

### 3.1 `GET /v1/facilities`

| Param | Rules | Default |
|---|---|---|
| `q` | Optional string, 1–100 chars. Word-prefix match (§5). If omitted, all facilities are listed. | — |
| `amenities` | Optional comma-separated list, at most 20 entries. Entries are trimmed and empty entries ignored; if none remain, no amenity filter is applied. Each entry is matched case-insensitively against a whole amenity name, so `pool` matches `Pool` but not `Olympic Pool`. A facility must have **all** listed amenities. An unknown amenity returns no results. | — |
| `limit` | Integer 1–100 | 20 |
| `offset` | Integer ≥ 0 | 0 |

```json
{
  "data": [
    { "id": "facility-001", "name": "City Fitness Central", "address": "123 Market St, Sydney, NSW 2000" }
  ],
  "page": { "limit": 20, "offset": 0, "total": 3 }
}
```

**Ordering:** names that start with the whole query come first, then all other matches; each group is alphabetical (§5.3). The order is deterministic, so pages stay stable. An `offset` past the end returns an empty `data` array and the correct `total`. Unknown query parameters are ignored.

### 3.2 `GET /v1/facilities/:id`

`id` must be 1–64 characters matching `^[A-Za-z0-9_-]+$`, otherwise the response is 400. An ID that is valid but unknown returns 404.

```json
{
  "id": "facility-001",
  "name": "City Fitness Central",
  "address": "123 Market St, Sydney, NSW 2000",
  "location": { "latitude": -33.8703, "longitude": 151.208 },
  "amenities": ["Pool", "Sauna", "24/7 Access", "Yoga Classes"]
}
```

`amenities` keeps the order from the source data.

### 3.3 `POST /v1/auth/login`

The body is `{ email, password }`. `email` must be in email format and at most 254 chars; `password` must be 1–128 chars. Checking the format also keeps non-Latin-1 input away from the mock's `btoa()`, which throws on it. If the mock throws (password `"error"`), the response is 401. The route is rate-limited more strictly than the rest (§8.1).

### 3.4 Errors

Every error uses RFC 9457 Problem Details (`Content-Type: application/problem+json`):

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "Request validation failed",
  "requestId": "3f1c…",
  "errors": [{ "in": "querystring", "path": "/limit", "message": "must be <= 100" }]
}
```

`errors` appears only on validation failures.

| Status | When |
|---|---|
| 400 | Invalid input |
| 401 | Missing, malformed, invalid or expired token; the response includes `WWW-Authenticate: Bearer` |
| 404 | Unknown facility or route |
| 429 | Rate limit exceeded; the response includes `Retry-After` |
| 500 | Unexpected error; the message is generic and the details go to the log only |

### 3.5 API decisions

1. **The amenity filter uses AND.** The brief's example ("Pool" or "Sauna") is ambiguous. With AND, each amenity a user ticks narrows the results, which is how filter checkboxes usually behave.
2. **The data's `facilities` field is renamed `amenities`.** `facility.facilities` reads badly, and the API contract shouldn't mirror the storage format.
3. **Pagination uses `offset`, not a cursor.** The dataset is read-only and in memory, so an offset is simpler, stays stable and makes `total` cheap. A database-backed version would switch to cursors (§13).

## 4. Architecture

```
facility-search-api/
├── assets/                        # provided, never modified
├── docs/                          # CHALLENGE.md (the brief), DESIGN.md (this file)
├── src/
│   ├── server.ts                  # entry: config → load data → build app → listen → shutdown handling
│   ├── app.ts                     # buildApp(deps): returns a configured Fastify instance
│   ├── config.ts                  # reads and validates environment variables
│   ├── domain/facility.ts         # Facility, FacilitySummary types
│   ├── data/load-facilities.ts    # read the file, validate records, check IDs are unique
│   ├── search/tokenize.ts         # shared normalisation for names and queries
│   ├── search/facility-index.ts   # word-prefix and amenity index (no HTTP)
│   ├── repositories/facility-repository.ts   # FacilityRepository interface + in-memory implementation
│   ├── auth/token-verifier.ts     # TokenVerifier interface + MockTokenVerifier
│   ├── errors/http-error.ts       # HttpError(status, detail)
│   ├── plugins/                   # auth, error handler, swagger, rate limit, helmet, cors
│   ├── schemas/                   # TypeBox schemas for requests and responses
│   └── routes/                    # auth.ts, facilities.ts, health.ts
├── test/unit/, test/integration/
├── scripts/benchmark.ts
├── Dockerfile, .github/workflows/ci.yml, .env.example
└── README.md
```

Each layer depends only on the layers below it. The index knows nothing about HTTP, routes know nothing about how search works, and `buildApp` receives its dependencies as arguments so tests can replace any of them.

### 4.1 Boundaries

```ts
interface FacilityRepository {
  search(params: { q?: string; amenities?: string[]; limit: number; offset: number }):
    { items: FacilitySummary[]; total: number };
  findById(id: string): Facility | undefined;
}

interface TokenVerifier {
  verify(token: string): Promise<AuthenticatedUser>;   // throws InvalidTokenError
}

function buildApp(deps: {
  config: Config;
  repository: FacilityRepository;
  tokenVerifier: TokenVerifier;
}): FastifyInstance;
```

- **Routes use only `FacilityRepository`**, so a Postgres implementation could replace the in-memory one without any route changes.
- **The auth check is registered once on the facility route group**, as an `onRequest` hook. Every facility route therefore requires a token by default.
- **TypeBox schemas are the single source** for request validation, handler types, the OpenAPI document and response serialisation. Response schemas also drop undeclared fields, so a new internal field can't leak into the API by accident.

### 4.2 Technology choices

| Concern | Choice | Why |
|---|---|---|
| HTTP framework | Fastify 5 | Built-in schema validation and serialisation, pino logging, `inject()` for tests, official plugins for swagger, rate limiting, helmet and cors |
| Schemas | TypeBox via `@fastify/type-provider-typebox` | One definition gives validation, TS types and OpenAPI |
| API docs | `@fastify/swagger` + `@fastify/swagger-ui` | Generated from the route schemas |
| Tests | Vitest + `@vitest/coverage-v8` | Fast, TypeScript-native |
| Build / dev | `tsc` to `dist/`; `tsx watch` | Plain compiled JS in production; fast reload in development |
| Lint / format | ESLint (typescript-eslint) + Prettier | Standard |
| Container | Two-stage Dockerfile on `node:24-alpine`, non-root user, sets `HOST=0.0.0.0` | |
| CI | GitHub Actions on Node 24: lint, typecheck, test | |

`src/` imports `assets/auth.ts` unmodified, so `tsconfig` compiles both folders (`rootDir: "."`) and the build output is `dist/src/...`.

## 5. Search index

### 5.1 Normalisation (`tokenize.ts`)

Names and queries go through the same function:

1. Unicode NFKD, then strip combining marks ("Café" → "Cafe").
2. Lowercase.
3. Split on any run of characters that are not letters or digits (`/[^\p{L}\p{N}]+/u`), then drop empty strings.

Examples: `"24/7 Access"` → `["24", "7", "access"]`, `"Suburban Strength & Co"` → `["suburban", "strength", "co"]`. Capitals inside a word are not treated as word breaks, so `"life"` does not match `"FitLife"`.

### 5.2 Build (once, at startup)

1. Sort facilities by normalised name, breaking ties by `id`, and give each one an **ordinal** equal to its position in that order. Because ordinals follow result order, any match list kept in ascending ordinal order is already sorted for output.
2. **Word index:** a sorted array of every distinct name word, with a parallel array of postings. Each posting is a `Uint32Array` of the ordinals whose name contains that word, ascending. A word repeated within one name adds that name's ordinal once.
3. **Amenity index:** a `Map` from lowercased amenity name to an ascending `Uint32Array` of ordinals.
4. **Lookups:** `byId: Map<id, Facility>`, `byOrdinal: Facility[]`, and the normalised full name per ordinal (used for ranking).

### 5.3 Query

Example: `q = "city fit"`, `amenities = ["Pool"]`.

1. Tokenise `q` → `["city", "fit"]`. If `q` was given but no terms remain (e.g. `"&&"`), return an empty page.
2. For each distinct term, binary-search the word array for the first word ≥ the term, then walk forward while words start with the term. Union their postings into one ascending, de-duplicated ordinal list.
3. Intersect the per-term lists, starting with the shortest and stopping early if the result is empty. These are facilities matching **every** term, in any word order.
4. Intersect with the posting list of each requested amenity. An unknown amenity gives an empty result.
5. If neither `q` nor `amenities` was given, the match list is every ordinal, `0 … N-1`.
6. **Rank** with a stable partition. Facilities whose normalised full name starts with the normalised query (terms joined by single spaces, in typed order) move to the front. Order within each group is unchanged, so both stay alphabetical.
7. `total` = match count. Slice by `offset` and `limit` and map ordinals to summaries.

**Cost:** one binary search per term (O(log V), where V is the number of distinct words), then work proportional to the postings touched and the matches found. A full pass over all N facilities happens only when the query genuinely matches all of them. Very short prefixes (1 letter) touch the most postings; the benchmark (§11) measures that case. If it ever proves too slow, the fixes are a minimum query length or precomputed lists for 1–2 letter prefixes. Neither is built now.

### 5.4 Known limitations

- Capitals inside words are not split ("FitLife").
- Amenity matching is by whole name ("Pool" excludes "Olympic Pool").
- No typo tolerance.
- Each instance holds the whole dataset; memory grows linearly with N. Data changes need a restart.

## 6. Request lifecycle

For `GET /v1/facilities`, in Fastify hook order:

1. **Request ID.** Reuse the incoming `x-request-id` if it matches `^[A-Za-z0-9._-]{1,128}$`; otherwise generate `crypto.randomUUID()`. The ID is echoed in the `x-request-id` response header.
2. **Rate limit** (`onRequest`). This runs before auth, so a flood of requests never reaches the slow token verifier.
3. **Auth** (`onRequest`, facility routes only). Parse `Authorization: Bearer <token>`; a missing or malformed header returns 401 "Missing or malformed Authorization header". Otherwise call `TokenVerifier.verify`; any failure returns 401 "Invalid or expired token".
4. **Validation** against the TypeBox query schema, which converts `limit` and `offset` to integers. Invalid input returns 400. Because this runs after auth, callers without a token learn nothing about valid parameters.
5. **Handler.** Split `amenities` on commas (more than 20 non-empty entries returns 400) and call `repository.search`.
6. **Serialisation** against the response schema.
7. **Errors** from any step go to the single error handler (§8.5).

## 7. Authentication

`assets/auth.ts` is used unmodified. Its `verifyToken` has gaps, which `MockTokenVerifier` closes where a mock allows:

| Gap in `verifyToken` | Handling |
|---|---|
| A payload without `user` (e.g. `{}`) resolves to `undefined` instead of throwing | Validate the returned user against the `User` schema (`id`, `email`, `name`, `membershipType ∈ {basic, premium, elite}`, `memberSince`); reject if invalid |
| `exp` is never checked | Decode the payload segment, require a numeric `exp`, and reject if `exp ≤ now()`. The mock writes `exp` in **milliseconds** (`Date.now() + 3600000`); a real JWT uses seconds |
| The signature is never verified | Can't be fixed in a mock. Documented: production would use `jose`'s `jwtVerify` against the identity provider's JWKS, checking issuer and audience |
| Random 100–500 ms delay per call | Kept, since it simulates a remote auth service. Documented as the main latency cost (§9) |

- **Injectable dependencies.** `MockTokenVerifier` takes the underlying verify function (default: the provided `verifyToken`) and a clock (default: `Date.now`), so tests can control both.
- **One response for every failure.** All verification failures throw `InvalidTokenError`, which becomes the same 401 ("Invalid or expired token"). The specific reason is logged at debug level and never sent to the client.

## 8. Production concerns

### 8.1 Rate limiting (`@fastify/rate-limit`)

- **Global:** per IP, `RATE_LIMIT_MAX` requests (default 100) per `RATE_LIMIT_WINDOW_MS` (default 60000).
- **Login:** 10 requests per minute per IP.
- **`/health`** is exempt.
- **When the limit is exceeded:** 429 Problem Details with a `Retry-After` header. Responses carry `x-ratelimit-*` headers.
- **Storage:** an in-memory store, so limits apply per instance. With `TRUST_PROXY` set, the limit uses the client IP from `X-Forwarded-For`.

### 8.2 Security headers and limits

- **Headers:** `@fastify/helmet` defaults. The content security policy is relaxed only as far as the Swagger UI at `/docs` needs.
- **CORS:** `@fastify/cors`, enabled only for the origins listed in `CORS_ORIGINS`. It is off when that variable is empty.
- **Size limits:** `bodyLimit` is 10 KB, `q` at most 100 chars, `amenities` at most 20 entries.

### 8.3 Logging

- **Format:** Fastify's built-in pino. It writes JSON by default and uses `pino-pretty` (a dev dependency) when `NODE_ENV=development`. The level comes from `LOG_LEVEL`.
- **Redaction:** `req.headers.authorization` is redacted. Request bodies are never logged.
- **Startup log:** the facility count and the index build time.

### 8.4 Configuration (`config.ts`)

Environment variables are validated against a TypeBox schema with defaults. Invalid values stop the process at startup with a clear message. `.env.example` documents all of them, and `npm` scripts load `.env` if it exists (`node --env-file-if-exists`).

| Variable | Default |
|---|---|
| `NODE_ENV` | `development` (`development` \| `test` \| `production`) |
| `HOST` | `127.0.0.1` (the Dockerfile sets `0.0.0.0`) |
| `PORT` | `3000` |
| `LOG_LEVEL` | `info` |
| `DATA_FILE` | `assets/facilities.json` (relative to the working directory) |
| `RATE_LIMIT_MAX` | `100` |
| `RATE_LIMIT_WINDOW_MS` | `60000` |
| `CORS_ORIGINS` | empty (CORS disabled) |
| `TRUST_PROXY` | `false` |

### 8.5 Error handling

- **One error handler** (`setErrorHandler`):
  - Validation errors become a 400 with an `errors` array.
  - `HttpError` instances and other errors with a status below 500 keep their status and message.
  - Anything else becomes a generic 500, and the full error with its stack trace is logged.
- **Unknown routes:** `setNotFoundHandler` returns a 404 Problem Details response.
- **Routes** signal expected failures by throwing `HttpError(status, detail)`.

### 8.6 Shutdown

- **On SIGTERM or SIGINT:** log, then `app.close()`. This stops accepting connections, lets in-flight requests finish and runs `onClose` hooks, then the process exits with code 0. If shutdown takes more than 10 seconds, the process exits with code 1 anyway.
- **On `unhandledRejection` or `uncaughtException`:** log at fatal level and exit with code 1, so the process supervisor restarts the service from a clean state.

## 9. Caching (documented, not built)

Measured latency is dominated by the mock auth's 100–500 ms delay, not by search. In priority order:

1. **Verified-token cache:** map a token to its user for a short time, capped at the token's expiry. This removes the auth delay from repeat requests while someone types. The cost is that a revoked token keeps working until its cache entry expires.
2. **HTTP caching on the detail endpoint:** `ETag` plus `Cache-Control: private, max-age=60`.
3. **Search result caching:** not worthwhile, because the index answers in under a millisecond (to be confirmed by the benchmark).

## 10. Testing

**Unit tests** (Vitest):
- **`tokenize`:** capitals, accents, splitting on `/` and `&`, punctuation-only input, empty input.
- **`facility-index`:**
  - single-term prefixes, multi-term AND, word order not mattering, ignoring case
  - no match, and punctuation-only queries
  - the amenity filter: one, several, different capitals, unknown
  - listing everything (no `q`), and the ranking rule
  - pagination, including an offset past the end
  - a repeated word in one name not producing duplicate results
- **`MockTokenVerifier`:** valid, expired, empty `{}` payload, malformed token, missing `exp`, invalid `membershipType`. Most tests inject a fake verify function and a fixed clock; at least one uses the real `verifyToken` to show the gaps are closed.
- **`config`:** defaults, invalid values, CSV parsing.
- **`load-facilities`:** valid file, invalid record (the error names its index), duplicate IDs, missing file.

**Integration tests** (`app.inject()` with the real data file and an instant fake `TokenVerifier`):
- **401 cases:** no header, the wrong scheme, an invalid token. Each response includes `WWW-Authenticate: Bearer`.
- **Search:** `q=City` returns City Fitness Central with only `id`, `name` and `address`. Page metadata, the amenity filter, and `limit=101` returning a 400 Problem Details response with the right content type and a `requestId`.
- **Detail:** returns the full shape with `amenities`. An unknown ID returns 404; a malformed ID returns 400.
- **`/health`:** works without a token.
- **`/docs/json`:** a valid OpenAPI document containing the routes.
- **Rate limit:** with `RATE_LIMIT_MAX=2`, the third request returns 429 with `Retry-After`.
- **Request ID:** an incoming `x-request-id` is echoed.
- **End-to-end with the real mock auth:** log in, then search with the returned token. This test is slow (up to about 2.5 s).

Coverage is reported by `npm run test:coverage`. No hard threshold is enforced.

## 11. Benchmark (`npm run bench`)

`scripts/benchmark.ts` is kept out of CI because timings are noisy.

1. **Generate data:** N synthetic facilities (default 100,000, configurable by CLI argument) from word lists, using a seeded PRNG so every run produces the same data. Amenities are random subsets of the real 31.
2. **Measure the build:** index build time and the change in heap size.
3. **Measure queries:** after a warm-up, record p50, p95 and p99 latency over 1,000 iterations for each category: 1-letter, 2-letter, 3+ letter, multi-word, amenity-filtered, no match.
4. **Compare against a full scan:** run the same queries with `filter` plus `includes` on lowercased names.
5. **Output:** a Markdown table, pasted into the README along with the machine's specs.

## 12. Documentation deliverables

- **`docs/CHALLENGE.md`:** the original brief, moved unchanged.
- **`docs/DESIGN.md`:** this document.
- **`README.md`:**
  - quick start: Node 24, install, `dev`, `build` and `start`, Docker
  - `curl` commands to log in, search and fetch details
  - an API overview with a link to `/docs`
  - the key decisions: in-memory index, word-prefix matching, AND amenity filter, the `amenities` rename, offset pagination
  - the mock-auth gaps and how they are handled
  - benchmark results
  - the scaling path (§13)
  - next steps
- **npm scripts:** `dev`, `build`, `start`, `lint`, `format`, `typecheck`, `test`, `test:coverage`, `bench`.

## 13. Scaling path and future work

- **Storage:** move to Postgres, searching an indexed `tsvector` column with prefix queries (`to_tsquery('city:*')`), or to OpenSearch with prefix (edge n-gram) analysis once data is large, changes often, or needs fuzzy matching. Only a new `FacilityRepository` implementation is needed.
- **Live data updates:** build a new index in the background and swap the reference in one step, with no restart.
- **Pagination:** move to cursors keyed on (sort key, id) once data can change between page requests.
- **Rate limiting:** use a Redis store so limits are shared across instances.
- **Auth:** real JWT verification (§7), plus the verified-token cache (§9).
- **Observability:** Prometheus metrics (latency histograms per route) and OpenTelemetry tracing.
- **Search quality:** split words at capitals, typo tolerance, and relevance scoring beyond the two-group ranking.

## 14. Decision log

| Decision | Alternatives considered | Reason |
|---|---|---|
| In-memory word-prefix index behind a repository interface | SQLite FTS5; Postgres in Docker | No infrastructure for reviewers to run; shows the indexing reasoning directly; the interface keeps the database path open |
| Word-prefix matching | Substring anywhere; fuzzy matching | Standard search-as-you-type behaviour; cheap to index and explain; substring needs n-grams and handles 1–2 char queries poorly |
| Fastify + TypeBox | Express + zod; NestJS; Hono | Validation, serialisation, logging, OpenAPI and test injection with little glue code |
| Login endpoint | Dev token script | The mock's own usage example shows it; reviewers can use curl or the Swagger UI directly |
| Amenity filter uses AND | OR | Matches how filter checkboxes narrow results |
| Rename `facilities` → `amenities` | Mirror the data field | Clearer contract, separate from storage |
| Offset pagination | Cursor | Read-only in-memory data; simpler, with a cheap `total` |
| RFC 9457 Problem Details | Custom error shape | A standard format clients already know how to handle |
| Wrap the mock auth, don't edit it | Modify `assets/auth.ts` | Keeps provided assets intact; the wrapper documents the gaps |
