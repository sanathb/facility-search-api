# Facility Search API

A REST API for searching Fitness Passport facilities by name as you type, filtering by amenities, and fetching a facility's details. It is built with TypeScript and Fastify, and designed to stay fast at 100,000+ facilities.

- The brief is in [`docs/CHALLENGE.md`](docs/CHALLENGE.md).
- The design and the reasoning behind it are in [`docs/DESIGN.md`](docs/DESIGN.md).

## Quick start

You need Node 24 (`nvm use` reads `.nvmrc`).

```bash
npm install
npm run dev
```

The API listens on `http://127.0.0.1:3000`. Interactive docs are at [`/docs`](http://127.0.0.1:3000/docs). `npm run dev` restarts on changes, prints readable logs and loads `.env` if you have one (see [`.env.example`](.env.example)); without one, Node notes `.env not found` and carries on.

For the production build, which logs JSON:

```bash
npm run build
npm start
```

With Docker:

```bash
docker build -t facility-search-api .
docker run --rm -p 3000:3000 facility-search-api
```

## Try it

The mock login accepts any email and password, except the password `error`. It takes 0.5–2 seconds, like a real identity provider.

```bash
API=http://127.0.0.1:3000
TOKEN=$(curl -s -X POST $API/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"jane@example.com","password":"secret"}' | node -pe 'JSON.parse(fs.readFileSync(0)).token')

curl -s "$API/v1/facilities?q=city%20fit" -H "authorization: Bearer $TOKEN"
curl -s "$API/v1/facilities?amenities=Pool,Sauna&limit=5" -H "authorization: Bearer $TOKEN"
curl -s "$API/v1/facilities/facility-001" -H "authorization: Bearer $TOKEN"
```

In Swagger UI, call `POST /v1/auth/login`, copy the token, then click **Authorize**.

## API

| Route                    | Auth   | Purpose                                                                             |
| ------------------------ | ------ | ----------------------------------------------------------------------------------- |
| `POST /v1/auth/login`    | No     | Exchange `{ email, password }` for `{ token, user }`                                |
| `GET /v1/facilities`     | Bearer | Search; returns `{ data: [{ id, name, address }], page: { limit, offset, total } }` |
| `GET /v1/facilities/:id` | Bearer | One facility: `{ id, name, address, location, amenities }`                          |
| `GET /health`            | No     | `{ status, facilityCount, uptimeSeconds }`                                          |
| `GET /docs`              | No     | Swagger UI; the OpenAPI document is at `/docs/json`                                 |

Search parameters:

- `q`: 1–100 characters. Every typed word must match the start of a word in the name, in any order, ignoring case and accents. `city fit` finds "City Fitness Central"; `ness` doesn't.
- `amenities`: comma-separated, at most 20 names and 1,000 characters. A facility must have all of them. Names match whole and ignore case, so `pool` matches "Pool" but not "Olympic Pool".
- `limit`: 1–100, default 20. `offset`: default 0.

Results whose name starts with the whole query come first; each group is alphabetical. Every error, including unknown routes and malformed URLs, is an [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457) body with a `requestId` you can find in the logs.

## Design decisions

| Decision                                                | Why                                                                                      | Trade-off                                                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| In-memory index behind a `FacilityRepository` interface | No database for reviewers to run; shows the indexing directly                            | Each instance holds the whole dataset, and data changes need a restart. A Postgres implementation can replace it without route changes. |
| Word-prefix matching over a sorted word list            | Standard search-as-you-type behaviour; a lookup or two binary searches per typed word    | No mid-word or typo matches: "life" doesn't find "FitLife"                                                                              |
| Amenity filter means "has all"                          | Each ticked amenity narrows the results, like filter checkboxes                          | No "any of" option; it would need its own parameter, because separate requests can't be merged into one correctly paged list            |
| The data's `facilities` field is `amenities` in the API | `facility.facilities` reads badly; the contract shouldn't mirror storage                 | Differs from the source data                                                                                                            |
| Offset pagination                                       | Read-only data makes offsets stable and `total` cheap                                    | A database-backed version should switch to cursors                                                                                      |
| Fastify + TypeBox                                       | One schema per route drives validation, TypeScript types, OpenAPI and response filtering | TypeBox is less familiar than zod                                                                                                       |

The full reasoning, including the alternatives considered, is in [`docs/DESIGN.md`](docs/DESIGN.md).

### How search works

At startup, facilities are sorted by name and numbered in that order. The index keeps every distinct name word in a sorted array, and for each word, the numbers of the facilities containing it. A typed word is found by binary search, then the lists of the words starting with it are merged. One- to three-letter prefixes can match many common words, so their merged lists are built at startup instead. Only facilities matching every typed word are kept.

Because the numbers follow name order, the matches are already alphabetical, so facilities are never sorted per request. Names that start with the whole query also sit together in that order, so the ranking finds them with a binary search instead of checking every match. See [`src/search/facility-index.ts`](src/search/facility-index.ts).

### Gaps in the provided mock auth

`assets/auth.ts` is used unmodified. `MockTokenVerifier` wraps its `verifyToken` and closes the gaps a mock allows:

| Gap                                                                             | Handling                                                                                                                                       |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A payload without `user` (e.g. `{}`) resolves to `undefined` instead of failing | The user's shape is validated; the token is rejected otherwise                                                                                 |
| `exp` is never checked                                                          | The wrapper reads `exp` and rejects expired tokens                                                                                             |
| The signature is never checked                                                  | Can't be fixed in a mock. Production would use `jose` to verify signatures against the identity provider's keys and check issuer and audience. |
| Every call waits 100–500 ms                                                     | Kept, as it simulates a remote auth service. It is the slowest part of every request (see next steps).                                         |

Every rejected token gets the same 401; the specific reason is logged at debug level only. Any other verifier failure returns 500, so an outage never looks like a bad token.

## Performance

`npm run bench` builds the index over 100,000 generated facilities, then times 1,000 searches per query type. For comparison it times a full scan: the same queries checked against every facility, using names and amenity sets prepared in advance, with no ranking or sorting. That is the cheapest alternative.

Results on an Intel Core i7-9750H (2.6 GHz), 16 GB RAM, Node 24.22:

- Index build: 826 ms, using 20.9 MB.

| Query type     | Index p50 | Index p95 | Index p99 | Index max | Full scan p50 | Full scan p95 |
| -------------- | --------- | --------- | --------- | --------- | ------------- | ------------- |
| 1 letter       | 0.006 ms  | 0.013 ms  | 0.022 ms  | 0.043 ms  | 3.671 ms      | 4.091 ms      |
| 2 letters      | 0.004 ms  | 0.006 ms  | 0.007 ms  | 0.019 ms  | 4.665 ms      | 5.326 ms      |
| 3 letters      | 0.004 ms  | 0.006 ms  | 0.007 ms  | 0.026 ms  | 4.832 ms      | 5.281 ms      |
| 4+ letters     | 0.021 ms  | 0.054 ms  | 0.059 ms  | 0.098 ms  | 4.490 ms      | 5.144 ms      |
| multi-word     | 0.083 ms  | 0.173 ms  | 0.180 ms  | 0.241 ms  | 5.245 ms      | 5.701 ms      |
| with amenities | 0.269 ms  | 0.328 ms  | 0.364 ms  | 0.422 ms  | 9.683 ms      | 10.352 ms     |
| no match       | 0.003 ms  | 0.003 ms  | 0.003 ms  | 0.018 ms  | 3.983 ms      | 4.417 ms      |

Single-word queries take microseconds: 1–3 letter prefixes read lists built at startup, a longer prefix merges the lists of the few words it starts, and the ranking finds names that start with the query by binary search. Multi-word and amenity queries take a few tenths of a millisecond, spent intersecting lists. Even the slowest of the 7,000 timed searches took under 0.5 ms. A full scan takes 4–10 ms at this size.

At 1,000,000 facilities (`npm run bench -- 1000000`, several minutes), the index builds in 10 s and uses 199 MB. Every query type stays under 3.1 ms at p99, and the slowest of the 7,000 timed searches took 7.8 ms, against 34–98 ms at p50 for a full scan. Three earlier versions fell short at that size:

- Sorting the matching words' lists on every request made 1-letter queries no faster than a full scan (48 ms against 52 ms at p50).
- Merging those lists per request instead caused garbage-collection pauses of several hundred milliseconds for 3-letter prefixes such as "fit".
- Allocating a new list for every intersection caused pauses of up to 2 s for multi-word queries.

That's why lists for 1–3 letter prefixes are built at startup, and why intersections write into two reused buffers.

## Production concerns

- **Validation:** every input is checked against its schema, and responses are filtered by theirs, so internal fields can't leak.
- **Rate limiting:** 100 requests a minute per client IP by default; login has its own limit of 10 a minute. Unknown routes count too; only `/health` is exempt. The limiter runs before the token check, so floods never reach the slow verifier. Behind a load balancer, list its addresses in `TRUST_PROXY`, so limits use the client address it adds to `X-Forwarded-For`; nothing else in that header is trusted.
- **Security headers and CORS:** Helmet defaults. Their content security policy includes `upgrade-insecure-requests`, so over plain HTTP Swagger UI loads only from `localhost`; production traffic is HTTPS anyway. CORS is off unless `CORS_ORIGINS` is set. Request bodies are limited to 10 KB.
- **Errors:** client errors keep their message; anything unexpected becomes a generic 500, with the details in the log only. A request the router rejects outright (a malformed URL, or a path parameter over 100 characters) gets a 400 before any hook runs, so it skips the rate limiter and security headers, but it reaches no route.
- **Logging:** structured JSON (pino) with request IDs; readable output in development. An incoming `x-request-id` is reused when well-formed. Authorization headers are redacted, and `/health` polls aren't logged.
- **Configuration:** environment variables, checked at startup; see [`.env.example`](.env.example). Invalid settings stop the process with a clear message.
- **Startup checks:** the data file is validated record by record. A bad record stops startup instead of serving partial data.
- **Shutdown:** SIGTERM and SIGINT let in-flight requests finish, with a 10-second limit. Unhandled errors exit so the supervisor can restart the process.

## Testing

```bash
npm test               # unit and integration tests
npm run test:coverage  # with a coverage report
npm run lint && npm run format:check && npm run typecheck
```

- **Unit tests** cover the tokenizer, index, data loader, config and token verifier.
- **Integration tests** call the whole app through Fastify's `inject()`, with fast fake auth. They cover status codes, Problem Details, rate limits, CORS, request IDs and the OpenAPI document.
- **End-to-end test:** one test logs in and searches using the real mock auth.
- **CI:** GitHub Actions runs every check, the production build and the Docker build on each push.

## Project layout

```
src/
  server.ts              entry point: config → data → index → app → listen
  app.ts                 buildApp(): the Fastify app, built from its dependencies
  config.ts              environment variables, with defaults and validation
  domain/                facility types and the facility id rule
  search/                tokenizer and the in-memory index (no HTTP)
  repositories/          FacilityRepository interface + in-memory implementation
  data/                  loads and validates assets/facilities.json
  auth/                  TokenVerifier interface + wrapper around the mock
  errors/                HttpError: an error with a status that is safe to show
  plugins/               auth hook, error handler, security, swagger
  routes/                health, auth, facilities
  schemas/               TypeBox schemas (validation, types, OpenAPI)
test/unit, test/integration
scripts/benchmark.ts
```

## Next steps

- **Cache verified tokens** for a short time, capped at the token's expiry. That removes the 100–500 ms auth delay from repeat requests. The cost is that a revoked token keeps working until its entry expires.
- **Add HTTP caching** for facility details (`ETag`, `Cache-Control: private`). Caching search results isn't worth it: the index answers faster than a cache lookup over the network.
- **Verify real JWTs** with `jose` against the identity provider's published keys.
- **Move to Postgres** (prefix search on an indexed `tsvector`) or OpenSearch once the data changes often or outgrows memory, using cursor pagination.
- **Refresh data without restarts** by building a new index in the background and swapping it in.
- **Share rate limits across instances** with a Redis store.
- **Add metrics and tracing:** Prometheus and OpenTelemetry.
- **Improve search quality:** split words at capitals ("FitLife"), tolerate typos, and score relevance beyond the two-group ranking.
