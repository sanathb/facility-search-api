# Facility Search API — Design

**Status:** Approved · 2026-10-19 · refined while planning and prototyping the implementation; the decision log (§14) lists the changes of substance

This document records the design for the Fitness Passport Facility Search API challenge (Option 1) and the reasoning behind each decision. The brief is in [`docs/CHALLENGE.md`](CHALLENGE.md) (moved from the original `README.md` during implementation).

## 1. Goals and scope

The API lets authenticated members search fitness facilities by name as they type, and fetch one facility's full details. It must stay fast at 100,000+ facilities and be built to production standards in TypeScript, within a time budget of about 2 hours.

| Built                                            | Documented only                       |
| ------------------------------------------------ | ------------------------------------- |
| Search by name (word-prefix, search-as-you-type) | Caching layer (§9)                    |
| Facility detail by ID                            | Database-backed storage (§13)         |
| Login endpoint wrapping the mock `login()`       | Real JWT signature verification       |
| Pagination (`limit` / `offset`)                  | Rate limiting shared across instances |
| Amenity filter                                   | Cursor pagination                     |
| Health check                                     | Metrics and tracing                   |
| OpenAPI docs with Swagger UI                     |                                       |
| Per-instance rate limiting                       |                                       |

**Constraints**

- TypeScript on Node 24 LTS (`engines: ">=24"`; `.nvmrc` pins 24 for nvm).
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

**Validation at startup.** Every record is checked against a schema, and IDs must be unique and follow the detail route's rule (§3.2), so every loaded facility can be fetched. If any check fails, the process logs the index of the failing record and exits with a non-zero code. It never serves partial data. The data file path comes from `DATA_FILE`.

## 3. API

Facility and auth routes are versioned under `/v1`. Health and docs sit at the root.

| Route                    | Auth   | Purpose                                                              |
| ------------------------ | ------ | -------------------------------------------------------------------- |
| `POST /v1/auth/login`    | No     | `{ email, password }` → `{ token, user }` via the provided `login()` |
| `GET /v1/facilities`     | Bearer | Search or list; returns summaries                                    |
| `GET /v1/facilities/:id` | Bearer | Full details of one facility                                         |
| `GET /health`            | No     | `{ status: "ok", facilityCount, uptimeSeconds }`                     |
| `GET /docs`              | No     | Swagger UI; raw OpenAPI document at `/docs/json`                     |

### 3.1 `GET /v1/facilities`

| Param       | Rules                                                                                                                                                                                                                                                                                                                                                                              | Default |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `q`         | Optional string, 1–100 chars. Word-prefix match (§5). If omitted, all facilities are listed.                                                                                                                                                                                                                                                                                       | —       |
| `amenities` | Optional comma-separated list, at most 20 entries and 1,000 characters. Entries are trimmed and empty entries ignored; if none remain, no amenity filter is applied. Each entry is matched case-insensitively against a whole amenity name, so `pool` matches `Pool` but not `Olympic Pool`. A facility must have **all** listed amenities. An unknown amenity returns no results. | —       |
| `limit`     | Safe integer 1–100                                                                                                                                                                                                                                                                                                                                                                 | 20      |
| `offset`    | Safe integer ≥ 0                                                                                                                                                                                                                                                                                                                                                                   | 0       |

```json
{
  "data": [
    {
      "id": "facility-001",
      "name": "City Fitness Central",
      "address": "123 Market St, Sydney, NSW 2000"
    }
  ],
  "page": { "limit": 20, "offset": 0, "total": 3 }
}
```

**Ordering:** names that start with the whole query come first, then all other matches; each group is alphabetical (§5.3). The order is deterministic, so pages stay stable. An `offset` past the end returns an empty `data` array and the correct `total`. Unknown query parameters are ignored.

### 3.2 `GET /v1/facilities/:id`

`id` must be 1–64 characters matching `^[A-Za-z0-9_-]+$`, otherwise the response is 400. That includes IDs too long for Fastify's router (over 100 characters), which fail before routing (§8.5). An ID that is valid but unknown returns 404.

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

Every error the application produces, including unknown routes and malformed URLs, uses RFC 9457 Problem Details (`Content-Type: application/problem+json`). The OpenAPI document declares error responses with that media type. Three kinds of error come from outside the application and are not Problem Details: Fastify's 503 while the server is closing, Node's HTTP parser errors (400, 408, 431), and, with CORS on, an incomplete preflight request (400 `text/plain`).

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

`errors` appears only on validation failures. Each `path` is a JSON Pointer to the invalid field (`""` for the whole input); for a missing field it points at that field, for example `/password`.

| Status | When                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------- |
| 400    | Invalid input                                                                                  |
| 401    | Missing, malformed, invalid or expired token; the response includes `WWW-Authenticate: Bearer` |
| 404    | Unknown facility or route                                                                      |
| 429    | Rate limit exceeded; the response includes `Retry-After`                                       |
| 500    | Unexpected error; the message is generic and the details go to the log only                    |

### 3.5 API decisions

1. **The amenity filter uses AND.** The brief's example ("Pool" or "Sauna") is ambiguous. With AND, each amenity a user ticks narrows the results, which is how filter checkboxes usually behave. An "any of" option would need its own parameter, because separate requests can't be merged into one correctly paged list.
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
│   ├── plugins/                   # authenticate.ts, error-handler.ts, swagger.ts,
│   │                              #   security.ts (helmet, cors, rate limit)
│   ├── schemas/                   # problem.ts, facilities.ts, auth.ts (TypeBox)
│   └── routes/                    # auth.ts, facilities.ts, health.ts
├── test/
│   ├── helpers.ts                 # fixtures and fast fakes: facility(), fakeVerifier, fakeLogin
│   ├── test-app.ts                # testConfig(), buildTestApp()
│   └── unit/, integration/
├── scripts/benchmark.ts
├── Dockerfile, .dockerignore, .github/workflows/ci.yml, .env.example, .nvmrc
└── README.md
```

Each layer depends only on the layers below it. The index knows nothing about HTTP, routes know nothing about how search works, and `buildApp` receives its dependencies as arguments so tests can replace any of them.

### 4.1 Boundaries

```ts
interface FacilityRepository {
  search(params: FacilitySearch): Promise<FacilitySearchResult>; // { q?, amenities?, limit, offset } → { items, total }
  findById(id: string): Promise<Facility | undefined>;
  count(): Promise<number>; // for /health
}

interface TokenVerifier {
  verify(token: string): Promise<AuthenticatedUser>; // rejects with InvalidTokenError
}

async function buildApp(deps: {
  config: Config;
  repository: FacilityRepository;
  tokenVerifier: TokenVerifier;
  login: LoginFn; // same signature as the mock's login()
}): Promise<FastifyInstance>;
```

- **Routes use only `FacilityRepository`**, so a Postgres implementation could replace the in-memory one without any route changes. Its methods are async for that reason, although the in-memory version answers synchronously.
- **The auth check is registered once on the facility route group**, as a `preValidation` hook. Every facility route therefore requires a token by default. `preValidation`, not `onRequest`, is deliberate: `@fastify/rate-limit` attaches its `onRequest` hook to each route, and Fastify runs a plugin's own hooks before route-level ones, so an `onRequest` auth hook would check tokens before the rate limit applied. A test guards this order.
- **`login` is a dependency** so tests can pass a fast fake; production passes the provided `login()`.
- **TypeBox schemas are the single source** for request validation, handler types, the OpenAPI document and response serialisation. Response schemas also drop undeclared fields, so a new internal field can't leak into the API by accident.

### 4.2 Technology choices

| Concern        | Choice                                                                                                                                        | Why                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP framework | Fastify 5                                                                                                                                     | Built-in schema validation and serialisation, pino logging, `inject()` for tests, official plugins for swagger, rate limiting, helmet and cors |
| Schemas        | TypeBox 1.x (the `typebox` package) via `@fastify/type-provider-typebox` 6                                                                    | One definition gives validation, TS types and OpenAPI                                                                                          |
| API docs       | `@fastify/swagger` + `@fastify/swagger-ui`                                                                                                    | Generated from the route schemas                                                                                                               |
| Tests          | Vitest 5 + `@vitest/coverage-v8`                                                                                                              | Fast, TypeScript-native                                                                                                                        |
| Build / dev    | TypeScript 6.0 (`tsc`) to `dist/`; `tsx watch`                                                                                                | Plain compiled JS in production; fast reload in development. Not TypeScript 7: typescript-eslint supports only versions below 6.1              |
| Lint / format  | ESLint (typescript-eslint) + Prettier                                                                                                         | Standard                                                                                                                                       |
| Container      | Two-stage Dockerfile on `node:24-alpine`, non-root user, sets `HOST=0.0.0.0`                                                                  |                                                                                                                                                |
| CI             | GitHub Actions (`actions/checkout@v7`, `actions/setup-node@v7`, Node from `.nvmrc`): lint, format check, typecheck, test, build, Docker build |                                                                                                                                                |

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
3. **Short-prefix lists:** a `Map` from every 1-, 2- and 3-letter prefix of any name word to the ascending ordinals of facilities with a word starting with it. A short prefix can match many common words ("fit": fitness, fitlife, fitzroy), so merging their postings on every keystroke would be the slowest path, and at 1,000,000 facilities the per-query allocations caused garbage-collection pauses of hundreds of milliseconds. Longer prefixes rarely span many large lists. These lists hold more ordinals than the word postings themselves; the whole index is about 21 MB at 100,000 facilities (§11).
4. **Amenity index:** a `Map` from lowercased amenity name to an ascending `Uint32Array` of ordinals.
5. **Lookups:** `byId: Map<id, Facility>`, `byOrdinal: Facility[]`, and the normalised full name per ordinal, which is a sorted array because ordinals follow name order.

### 5.3 Query

Example: `q = "city fit"`, `amenities = ["Pool"]`.

1. Tokenise `q` → `["city", "fit"]`. If `q` was given but no terms remain (e.g. `"&&"`), return an empty page.
2. For each distinct term of 1–3 letters, take its precomputed short-prefix list. For a longer term, two binary searches find the run of words starting with it (words sharing a prefix sit together in sorted order); union their postings into one ascending, de-duplicated ordinal list by merging them pairwise, round by round as merge sort does: O(P log k) for P ordinals in k lists.
3. Intersect the per-term lists, starting with the shortest and stopping early if the result is empty. These are facilities matching **every** term, in any word order.
4. Intersect with the posting list of each requested amenity. An unknown amenity gives an empty result.
5. If neither `q` nor `amenities` was given, the match list is every ordinal, `0 … N-1`.
6. **Rank:** facilities whose normalised full name starts with the normalised query (terms joined by single spaces, in typed order) come first; each group stays alphabetical. Names starting with the query sit together in name order, so they are one run of ordinals, and therefore one run within the ascending matches. Binary searches find it, without checking every match.
7. `total` = match count. The page is cut from three slices laid end to end (that run, the matches before it, the matches after it) by `offset` and `limit`, then mapped to summaries.

**Cost:** a lookup or a few binary searches per term (O(log V), where V is the number of distinct words), then work proportional to the postings touched by terms of 4 or more letters and to the intersections, which write into two reused scratch buffers rather than allocating per request. Ranking takes two binary searches over the N names and two over the M matches, O(log N + log M), and paging O(limit). Nothing reads all N facilities unless a filter genuinely matches most of them. An earlier version sorted the concatenated postings for every prefix and ranked by checking each match; at 1,000,000 facilities its 1-letter queries were no faster than a full scan (§11), which is why short-prefix lists and run-based ranking exist.

### 5.4 Known limitations

- Capitals inside words are not split ("FitLife").
- Amenity matching is by whole name ("Pool" excludes "Olympic Pool").
- No typo tolerance, and no full Unicode case folding (for example, an uppercase Greek final Σ lowercases differently in a query than inside a name).
- Each instance holds the whole dataset; memory grows linearly with N: about 21 MB of index at 100,000 facilities and 199 MB at 1,000,000 (§11). Data changes need a restart.

## 6. Request lifecycle

For `GET /v1/facilities`, in Fastify hook order:

1. **Request ID.** Reuse the incoming `x-request-id` if it matches `^[A-Za-z0-9._-]{1,128}$`; otherwise generate `crypto.randomUUID()`. The ID is echoed in the `x-request-id` response header.
2. **Rate limit** (`onRequest`, attached to each route by `@fastify/rate-limit`). This runs before auth, so a flood of requests never reaches the slow token verifier.
3. **Auth** (`preValidation`, facility routes only). Parse `Authorization: Bearer <token>`; a missing or malformed header returns 401 "Missing or malformed Authorization header". Otherwise call `TokenVerifier.verify`. A rejected token (`InvalidTokenError`) returns 401 "Invalid or expired token"; any other failure, such as the auth service being down, returns 500, so an outage never looks like a bad token.
4. **Validation** against the TypeBox query schema, which converts `limit` and `offset` to integers. Invalid input returns 400. Validation coerces a value such as `limit=1e400` to `Infinity` and skips its minimum and maximum, so the handler also requires `limit` and `offset` to be safe integers. Because this runs after auth, callers without a token learn nothing about valid parameters.
5. **Handler.** Split `amenities` on commas (more than 20 non-empty entries returns 400) and call `repository.search`.
6. **Serialisation** against the response schema.
7. **Errors** from any step go to the single error handler (§8.5).

## 7. Authentication

`assets/auth.ts` is used unmodified. Its `verifyToken` has gaps, which `MockTokenVerifier` closes where a mock allows:

| Gap in `verifyToken`                                                             | Handling                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A payload without `user` (e.g. `{}`) resolves to `undefined` instead of throwing | Validate the returned user against the `User` schema (`id`, `email`, `name`, `membershipType ∈ {basic, premium, elite}`, `memberSince`); reject if invalid                    |
| `exp` is never checked                                                           | Decode the payload segment, require a numeric `exp`, and reject if `exp ≤ now()`. The mock writes `exp` in **milliseconds** (`Date.now() + 3600000`); a real JWT uses seconds |
| The signature is never verified                                                  | Can't be fixed in a mock. Documented: production would use `jose`'s `jwtVerify` against the identity provider's JWKS, checking issuer and audience                            |
| Random 100–500 ms delay per call                                                 | Kept, since it simulates a remote auth service. Documented as the main latency cost (§9)                                                                                      |

- **Injectable dependencies.** `MockTokenVerifier` takes the underlying verify function (default: the provided `verifyToken`) and a clock (default: `Date.now`), so tests can control both.
- **One response for every failure.** All verification failures throw `InvalidTokenError`, which becomes the same 401 ("Invalid or expired token"). The specific reason is logged at debug level and never sent to the client. Other errors from the verifier are not token problems and return 500.

## 8. Production concerns

### 8.1 Rate limiting (`@fastify/rate-limit`)

- **Global:** per IP, `RATE_LIMIT_MAX` requests (default 100) per `RATE_LIMIT_WINDOW_MS` (default 60000). Unknown routes count too: the not-found handler uses the limiter, so URLs can't be probed without limit. The exception is a request Fastify's router rejects outright (a malformed URL or a path parameter over 100 characters): it gets a 400 before any hook runs, so it skips the limiter and the security headers, but it reaches no route and reveals nothing (§8.5).
- **Login:** its own fixed limit of 10 requests per minute per IP, separate from the global count.
- **`/health`** is exempt. So are CORS preflight (`OPTIONS`) requests when `CORS_ORIGINS` is set: `@fastify/cors` answers them in its app-level `onRequest` hook, which runs before the limiter's route-level hook, and they do no work.
- **When the limit is exceeded:** 429 Problem Details with a `Retry-After` header. Responses carry `x-ratelimit-*` headers.
- **Storage:** an in-memory store, so limits apply per instance.
- **Behind a load balancer:** `TRUST_PROXY` lists the load balancers' addresses or CIDR ranges. Each entry must be an IP address or CIDR range, checked at startup, so a hop count such as `1` or a boolean is rejected. Only those proxies' `X-Forwarded-For` entries are trusted, so the limit uses the client address the load balancer adds, and a client can't pick its own IP. Trusting every hop (`true`) would let clients spoof it; Fastify 5.12 ignores hop counts.

### 8.2 Security headers and limits

- **Headers:** `@fastify/helmet` defaults; nothing is relaxed. The default content security policy includes `upgrade-insecure-requests`, so over plain HTTP Swagger UI at `/docs` loads only from `localhost`; on any other host it needs HTTPS, which production has (TLS ends at the load balancer).
- **CORS:** `@fastify/cors`, enabled only for the origins listed in `CORS_ORIGINS`. It is off when that variable is empty.
- **Size limits:** `bodyLimit` is 10 KB, `q` at most 100 chars, `amenities` at most 20 entries.

### 8.3 Logging

- **Format:** Fastify's built-in pino. It writes JSON, because `NODE_ENV` defaults to `production`. `npm run dev` sets `development`, which switches to `pino-pretty` (a dev dependency) for readable output. The level comes from `LOG_LEVEL`.
- **Redaction:** `req.headers.authorization` is redacted. Request bodies are never logged.
- **Health polls:** `/health` requests are left out of the request log, so load-balancer checks don't drown real traffic. They are matched by route, so a query string doesn't matter.
- **Startup log:** the facility count and the index build time.

### 8.4 Configuration (`config.ts`)

Environment variables are validated against a TypeBox schema with defaults. Invalid values stop the process at startup with a clear message. `.env.example` documents all of them. `npm run dev` loads `.env` if it exists (`--env-file-if-exists`); production reads real environment variables. Blank values count as unset.

| Variable               | Default                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `NODE_ENV`             | `production` (`development` \| `test` \| `production`); `npm run dev` sets `development` |
| `HOST`                 | `127.0.0.1` (the Dockerfile sets `0.0.0.0`)                                              |
| `PORT`                 | `3000`                                                                                   |
| `LOG_LEVEL`            | `info`                                                                                   |
| `DATA_FILE`            | `assets/facilities.json` (relative to the working directory)                             |
| `RATE_LIMIT_MAX`       | `100`                                                                                    |
| `RATE_LIMIT_WINDOW_MS` | `60000`                                                                                  |
| `CORS_ORIGINS`         | empty (CORS disabled)                                                                    |
| `TRUST_PROXY`          | empty: no proxy trusted. Otherwise comma-separated addresses or CIDR ranges              |

### 8.5 Error handling

- **One error handler** (`setErrorHandler`):
  - Validation errors become a 400 with an `errors` array.
  - `HttpError` instances and other errors with a 4xx status keep their status and message.
  - Anything else becomes a generic 500, and the full error with its stack trace is logged. That includes values that aren't `Error`s (a dependency can reject with anything) and errors carrying a non-4xx status.
- **Unknown routes:** `setNotFoundHandler` returns a 404 Problem Details response. It is registered after the rate limiter and uses it.
- **Router errors:** a malformed URL or an over-long path parameter fails inside Fastify's router, and is logged as "Request rejected by the router" because Fastify writes no completion line for it. It fails before any hook or the error handler runs. Fastify's `frameworkErrors` option turns these into 400 Problem Details with the request ID, and any other framework error into a generic 500.
- **Routes** signal expected failures by throwing `HttpError(status, detail)`.

### 8.6 Shutdown

- **On SIGTERM or SIGINT:** log, then `app.close()`. This stops accepting connections, lets in-flight requests finish and runs `onClose` hooks, then the process exits with code 0. If shutdown takes more than 10 seconds, the process exits with code 1 anyway.
- **On `unhandledRejection` or `uncaughtException`:** log at fatal level and exit with code 1, so the process supervisor restarts the service from a clean state.

## 9. Caching (documented, not built)

Measured latency is dominated by the mock auth's 100–500 ms delay, not by search. In priority order:

1. **Verified-token cache:** map a token to its user for a short time, capped at the token's expiry. This removes the auth delay from repeat requests while someone types. The cost is that a revoked token keeps working until its cache entry expires.
2. **HTTP caching on the detail endpoint:** `ETag` plus `Cache-Control: private, max-age=60`.
3. **Search result caching:** not worthwhile. At 100,000 facilities the index answers single-word queries in microseconds and multi-word or amenity-filtered queries in under 0.5 ms at p99 (§11).

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
  - 500 random searches over 300 generated facilities giving exactly the same pages and totals as a brute-force implementation of these rules
- **`MockTokenVerifier`:** valid, expired, empty `{}` payload, malformed token, missing `exp`, invalid `membershipType`. Most tests inject a fake verify function and a fixed clock; at least one uses the real `verifyToken` to show the gaps are closed.
- **`config`:** defaults, invalid values (including `TRUST_PROXY` entries that aren't addresses or ranges), list parsing.
- **`load-facilities`:** valid file, invalid record (the error names its index), duplicate IDs, missing file.

**Integration tests** (`app.inject()` with the real data file, an instant fake `TokenVerifier` and a fake `login`):

- **401 cases:** no header, the wrong scheme, an invalid token. Each response includes `WWW-Authenticate: Bearer`.
- **Search:** `q=City` returns City Fitness Central with only `id`, `name` and `address`. Page metadata, the amenity filter, and `limit=101` returning a 400 Problem Details response with the right content type and a `requestId`.
- **Detail:** returns the full shape with `amenities`. An unknown ID returns 404; a malformed ID returns 400.
- **`/health`:** works without a token and is never rate limited.
- **Errors:** unknown routes are rate limited; a malformed URL and an over-long id return 400 Problem Details; a dependency rejecting with a non-`Error` value, or an error with a non-4xx status, returns a generic 500.
- **`/docs/json`:** a valid OpenAPI document containing the routes.
- **Rate limit:** with a limit of 2, the third request to a facility route returns 429 with `Retry-After`, even without a token (the limiter runs before auth). Login allows 10 attempts a minute.
- **CORS:** no CORS headers by default; configured origins are allowed.
- **Verifier outage:** a verifier error other than `InvalidTokenError` returns 500, not 401.
- **Trusted proxies:** with `TRUST_PROXY` set, spoofed `X-Forwarded-For` entries don't escape the rate limit.
- **Response schemas:** fields a schema doesn't declare never reach the client.
- **OpenAPI:** `limit` and `offset` are optional, and error responses use `application/problem+json`.
- **Request ID:** an incoming `x-request-id` is echoed.
- **End-to-end with the real mock auth:** log in, then search with the returned token. This test is slow (up to about 2.5 s).

Coverage is reported by `npm run test:coverage`. No hard threshold is enforced.

## 11. Benchmark (`npm run bench`)

`scripts/benchmark.ts` is kept out of CI because timings are noisy. It runs with `--expose-gc`, so the heap is measured after garbage collection.

1. **Generate data:** N synthetic facilities (default 100,000, configurable by CLI argument) from word lists, using a seeded PRNG so every run produces the same data. Amenities are random subsets of the real 31.
2. **Measure the build:** index build time and the memory it adds (JS heap plus typed-array storage, which lives outside the heap).
3. **Measure queries:** after a warm-up, record p50, p95 and p99 latency over 1,000 iterations for each category: 1 letter, 2 letters, 3 letters, 4+ letters (including "kalo" and "berka", which each start 13 generated brand words, so their lists are merged per request), multi-word, with amenities, no match. Each row also shows the index's slowest sample, so pauses can't hide behind p99.
4. **Compare against a full scan:** run the same queries over every facility, using `includes` on lowercased names and amenity sets, both prepared once outside the timing. With no ranking or sorting, it is the cheapest alternative. Each measurement starts after a garbage collection.
5. **Output:** a Markdown table, pasted into the README along with the machine's specs.
6. **Scale check:** `npm run bench -- 1000000` runs the same measurements at 1,000,000 facilities. On the reference machine, three earlier versions of the index fell short there. Sorting the matching words' postings per request made 1-letter queries no faster than the full scan (48 ms against 52 ms at p50). Merging them per request caused garbage-collection pauses of several hundred milliseconds for 3-letter prefixes. Allocating a list per intersection caused pauses of up to 2 s for multi-word queries. With 1–3 letter prefix lists built at startup, run-based ranking and reused scratch buffers (§5), every query type stays around 3 ms at p99, and the slowest sample varies between runs (8–26 ms), against 34–98 ms at p50 for the scan.

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
- **npm scripts:** `dev`, `build`, `start`, `typecheck`, `lint`, `format`, `format:check`, `test`, `test:watch`, `test:coverage`, `bench`.

## 13. Scaling path and future work

- **Storage:** move to Postgres, searching an indexed `tsvector` column with prefix queries (`to_tsquery('city:*')`), or to OpenSearch with prefix (edge n-gram) analysis once data is large, changes often, or needs fuzzy matching. Only a new `FacilityRepository` implementation is needed.
- **Live data updates:** build a new index in the background and swap the reference in one step, with no restart.
- **Pagination:** move to cursors keyed on (sort key, id) once data can change between page requests.
- **Rate limiting:** use a Redis store so limits are shared across instances.
- **Auth:** real JWT verification (§7), plus the verified-token cache (§9).
- **Observability:** Prometheus metrics (latency histograms per route) and OpenTelemetry tracing.
- **Search quality:** split words at capitals, typo tolerance, and relevance scoring beyond the two-group ranking.

## 14. Decision log

| Decision                                                                                                                                              | Alternatives considered                                                                                       | Reason                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| In-memory word-prefix index behind a repository interface                                                                                             | SQLite FTS5; Postgres in Docker                                                                               | No infrastructure for reviewers to run; shows the indexing reasoning directly; the interface keeps the database path open      |
| Word-prefix matching                                                                                                                                  | Substring anywhere; fuzzy matching                                                                            | Standard search-as-you-type behaviour; cheap to index and explain; substring needs n-grams and handles 1–2 char queries poorly |
| Fastify + TypeBox                                                                                                                                     | Express + zod; NestJS; Hono                                                                                   | Validation, serialisation, logging, OpenAPI and test injection with little glue code                                           |
| Login endpoint                                                                                                                                        | Dev token script                                                                                              | The mock's own usage example shows it; reviewers can use curl or the Swagger UI directly                                       |
| Amenity filter uses AND                                                                                                                               | OR                                                                                                            | Matches how filter checkboxes narrow results                                                                                   |
| Rename `facilities` → `amenities`                                                                                                                     | Mirror the data field                                                                                         | Clearer contract, separate from storage                                                                                        |
| Offset pagination                                                                                                                                     | Cursor                                                                                                        | Read-only in-memory data; simpler, with a cheap `total`                                                                        |
| RFC 9457 Problem Details                                                                                                                              | Custom error shape                                                                                            | A standard format clients already know how to handle                                                                           |
| Wrap the mock auth, don't edit it                                                                                                                     | Modify `assets/auth.ts`                                                                                       | Keeps provided assets intact; the wrapper documents the gaps                                                                   |
| Auth hook at `preValidation`                                                                                                                          | `onRequest`                                                                                                   | Runs after the per-route rate limiter and before input validation                                                              |
| TypeScript 6.0                                                                                                                                        | TypeScript 7                                                                                                  | typescript-eslint supports only TypeScript below 6.1                                                                           |
| `TRUST_PROXY` as an address list                                                                                                                      | `true`; a hop count                                                                                           | `true` trusts client-supplied `X-Forwarded-For` entries; Fastify 5.12 ignores hop counts                                       |
| `NODE_ENV` defaults to `production`                                                                                                                   | `development`                                                                                                 | Safe by default: JSON logs and no dev-only packages; `npm run dev` opts into development                                       |
| 1–3 letter prefix lists built at startup; ranking by binary search; pairwise merge for longer prefixes; intersections into two reused scratch buffers | Sorting or merging postings on every request; checking every match while ranking; a new list per intersection | Measured at 1,000,000 facilities: the per-request versions were no faster than a full scan, or paused for garbage collection   |
