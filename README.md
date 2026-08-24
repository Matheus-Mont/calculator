# Calculator

A full-stack calculator: a **React + TypeScript** frontend whose every arithmetic
result is computed by a **Go REST microservice**. No arithmetic happens in the
browser — digits are typed locally, but pressing `=` (or chaining a second
operator) sends the operation to the API.

```
┌──────────────────────────┐        ┌───────────────────────────────┐
│  Frontend (React + TS)   │        │   Backend (Go, stdlib only)   │
│                          │        │                               │
│  useCalculator ──────────┼─HTTP──▶│  httpapi ──▶ calc             │
│    keypad state machine  │  JSON  │  transport   pure arithmetic  │
│  components (thin)       │        │                               │
└──────────────────────────┘        └───────────────────────────────┘
        :5173 (dev)                            :8080
```

---

## Quick start

### Prerequisites

| | Version used | Notes |
|---|---|---|
| Go | 1.27.0 | 1.22+ required — the router uses method patterns and path parameters added in 1.22 |
| Node.js | 24.18 | 20+ should work |
| Docker | 29.7 + Compose v5.3 | optional, for the containerised stack |

### Run it with Docker (one command)

```bash
docker compose up --build
```

Then open **http://localhost:3000**. The API is also published on
**http://localhost:8080** so you can `curl` it directly.

If those ports are taken:

```bash
FRONTEND_PORT=3001 BACKEND_PORT=9090 docker compose up --build
```

### Run it locally

Two terminals. Backend first:

```bash
cd backend && go run ./cmd/server
```

Then the frontend:

```bash
cd frontend && npm install && npm run dev
```

Open **http://localhost:5173**. The Vite dev server proxies `/api` to
`localhost:8080`, so the browser only ever sees one origin and CORS never
applies in development.

There is a `Makefile` for the common tasks — `make help` lists them.

---

## API

Base path: `/api/v1`. Every response is JSON, including every error.

### `GET /healthz`

```bash
curl http://localhost:8080/healthz
```
```json
{"status":"ok"}
```

### `GET /api/v1/operations`

Lists what the service can do, so a client can discover the operations and their
arity instead of hard-coding them.

```bash
curl http://localhost:8080/api/v1/operations
```
```json
{"operations":[
  {"operation":"add","arity":2,"description":"Adds b to a (a + b)."},
  {"operation":"divide","arity":2,"description":"Divides a by b (a / b). b must not be zero."},
  {"operation":"multiply","arity":2,"description":"Multiplies a by b (a * b)."},
  {"operation":"percentage","arity":2,"description":"Computes a percent of b ((a / 100) * b)."},
  {"operation":"power","arity":2,"description":"Raises a to the power of b (a ^ b)."},
  {"operation":"sqrt","arity":1,"description":"Square root of a. a must not be negative."},
  {"operation":"subtract","arity":2,"description":"Subtracts b from a (a - b)."}
]}
```

### `POST /api/v1/operations/{operation}`

The operation is named in the path; the operands go in the body. `b` is omitted
for unary operations.

```bash
curl -X POST http://localhost:8080/api/v1/operations/add \
  -H 'Content-Type: application/json' \
  -d '{"a":2,"b":3}'
```
```json
{"operation":"add","operands":{"a":2,"b":3},"result":5}
```

Every operation, as actually returned by the running service:

| Operation | Request | Response |
|---|---|---|
| `add` | `{"a":2,"b":3}` | `{"operation":"add","operands":{"a":2,"b":3},"result":5}` |
| `subtract` | `{"a":10,"b":4}` | `{"operation":"subtract","operands":{"a":10,"b":4},"result":6}` |
| `multiply` | `{"a":6,"b":7}` | `{"operation":"multiply","operands":{"a":6,"b":7},"result":42}` |
| `divide` | `{"a":10,"b":4}` | `{"operation":"divide","operands":{"a":10,"b":4},"result":2.5}` |
| `power` | `{"a":2,"b":10}` | `{"operation":"power","operands":{"a":2,"b":10},"result":1024}` |
| `sqrt` | `{"a":81}` | `{"operation":"sqrt","operands":{"a":81},"result":9}` |
| `percentage` | `{"a":20,"b":50}` | `{"operation":"percentage","operands":{"a":20,"b":50},"result":10}` |

### Errors

One envelope for every failure, with a stable machine-readable `code`. Branch on
the code, not on the message.

```json
{"error":{"code":"division_by_zero","message":"cannot divide by zero"}}
```

| Code | Status | Cause |
|---|---|---|
| `division_by_zero` | 400 | divisor is zero |
| `negative_square_root` | 400 | `sqrt` of a negative number |
| `invalid_operands` | 400 | operand missing, wrong type, or wrong count for the operation |
| `invalid_json` | 400 | body is malformed, empty, or has unknown fields |
| `method_not_allowed` | 405 | wrong verb for the path (`Allow` header names the right one) |
| `not_found` | 404 | no such endpoint |
| `unsupported_operation` | 404 | unknown operation; the response lists the valid set |
| `request_too_large` | 413 | body exceeds 1 MiB |
| `result_not_finite` | 422 | the result overflows float64 |
| `internal_error` | 500 | a bug in this service |

Each of these, verified against the running service:

```bash
# 400 — division by zero
curl -X POST http://localhost:8080/api/v1/operations/divide \
  -H 'Content-Type: application/json' -d '{"a":10,"b":0}'
# {"error":{"code":"division_by_zero","message":"cannot divide by zero"}}

# 400 — square root of a negative number
curl -X POST http://localhost:8080/api/v1/operations/sqrt \
  -H 'Content-Type: application/json' -d '{"a":-9}'
# {"error":{"code":"negative_square_root","message":"cannot take the square root of a negative number"}}

# 422 — the result overflows float64
curl -X POST http://localhost:8080/api/v1/operations/multiply \
  -H 'Content-Type: application/json' -d '{"a":1.7976931348623157e308,"b":10}'
# {"error":{"code":"result_not_finite","message":"the result is too large to represent as a finite number"}}

# 404 — unknown operation, with the valid set included
curl -X POST http://localhost:8080/api/v1/operations/modulo \
  -H 'Content-Type: application/json' -d '{"a":10,"b":3}'
# {"error":{"code":"unsupported_operation","message":"unsupported operation",
#  "supported_operations":["add","divide","multiply","percentage","power","sqrt","subtract"]}}

# 400 — missing operand (note: NOT treated as zero)
curl -X POST http://localhost:8080/api/v1/operations/divide \
  -H 'Content-Type: application/json' -d '{"a":10}'
# {"error":{"code":"invalid_operands","message":"operand \"b\" is required for operation \"divide\""}}

# 400 — second operand supplied to a unary operation
curl -X POST http://localhost:8080/api/v1/operations/sqrt \
  -H 'Content-Type: application/json' -d '{"a":16,"b":2}'
# {"error":{"code":"invalid_operands","message":"operation \"sqrt\" takes a single operand; remove \"b\""}}

# 400 — unknown field
curl -X POST http://localhost:8080/api/v1/operations/add \
  -H 'Content-Type: application/json' -d '{"a":1,"b":2,"c":3}'
# {"error":{"code":"invalid_json","message":"json: unknown field \"c\""}}

# 405 — wrong method
curl -X GET http://localhost:8080/api/v1/operations/add
# {"error":{"code":"method_not_allowed","message":"method GET is not allowed for this endpoint"}}
```

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | port the API listens on |
| `CORS_ALLOWED_ORIGIN` | `http://localhost:5173` | origin allowed to call the API; `*` allows any |
| `VITE_API_BASE_URL` | `/api/v1` | frontend override for a backend on another host |

---

## Tests

```bash
make test              # the two unit suites (fast)
make test-integration  # cross-boundary tests (needs Go)
make test-all          # everything
make cover             # unit suites, with coverage reports
```

Or directly:

```bash
cd backend  && go test ./... -cover
cd frontend && npm run test:coverage
cd frontend && npm run test:integration
```

### Three tiers

| Tier | What it covers | Where |
|---|---|---|
| Unit — backend | Arithmetic rules and HTTP behaviour, via `httptest` | `backend/internal/**/*_test.go` |
| Unit — frontend | API client, state machine, formatting, rendered UI | `frontend/src/**/*.test.{ts,tsx}` |
| Integration | The real Go binary behind the real Vite proxy, called through the real client with an unmocked `fetch` | `frontend/src/test/integration/` |

The integration tier exists because of a defect the unit tiers could not see. The
client tests stub `fetch`, so no unit test ever crosses a proxy — and a stopped
backend does not make `fetch` reject, it makes a proxy answer `502`. The client
read that as a malformed reply and told the user the service had answered
strangely, when it had not answered at all. That case is now a regression test
(`reports the service as unreachable, not as a malformed reply`), verified to
fail against the previous implementation.

### Coverage

Measured on the committed code — **254 test cases, all passing**.

**Backend** — `go test ./... -coverprofile=coverage.out && go tool cover -func=coverage.out`

| Package | Coverage | |
|---|---|---|
| `internal/calc` | **100.0%** | the arithmetic domain |
| `internal/httpapi` | **98.6%** | routing, validation, error mapping, middleware |
| `cmd/server` | 18.5% | config and the health probe; the rest is `run()`, the blocking server lifecycle |
| **total** | **78.4%** | 134 test cases |

The total is dragged down by `cmd/server`, which is process wiring: starting a
listener, waiting on a signal, shutting down. Testing that meaningfully means
starting and killing a real process, which belongs in an integration test rather
than a unit test. The two packages holding the actual logic are at 100% and 98.6%.

**Frontend** — `npm run test:coverage` (v8 provider)

| Metric | Coverage |
|---|---|
| Statements | **96.07%** (196/204) |
| Branches | 93.56% (160/171) |
| Functions | **100%** (49/49) |
| Lines | **98.35%** (179/182) |

105 unit cases across the API client, the `useCalculator` state machine, number
formatting, and full-UI tests that click real buttons — plus **15 integration
cases** that run against a real backend and are excluded from the coverage
figures above, since they exercise the shipped code rather than measure it.

HTML reports land at `backend/coverage.html` and `frontend/coverage/index.html`.

### Continuous integration

`.gitlab-ci.yml` runs four jobs across three stages: the Go suite (with `gofmt`
and `go vet` as gates), the frontend suite, the integration suite, and both
container image builds. The backend job compiles a static binary once and passes
it downstream as an artifact, so the integration job runs on a plain Node image
with no Go toolchain of its own. Both coverage figures are reported back to
GitLab, the frontend's as a Cobertura report.

### What the tests actually cover

Not just happy paths — the interesting cases are the edges:

- **Backend domain**: every operation across positives, negatives, decimals and
  identities; `0^0`, negative and fractional exponents; division by zero;
  `sqrt` of a negative; four distinct overflow-to-infinity paths.
- **Backend HTTP**: malformed JSON, unknown fields, trailing content after the
  object, an empty body, a 2 MiB body, operands of the wrong type, `1e400`
  (which does not fit in a float64), missing operands, arity violations, wrong
  methods, unknown paths, CORS preflight, CORS headers on *error* responses,
  a disallowed origin, and a panicking handler.
- **Frontend**: digit entry and its edge cases (leading zeros, a second decimal
  point, a lone minus sign after backspace), operator chaining, unary operations
  feeding a pending binary one, the loading state, error recovery, history, all
  22 keypad buttons, physical-keyboard input, reducer purity under `StrictMode`,
  collapsing and expanding the history, fitting an oversized result to the
  display, and the difference between a stopped backend and a malformed reply.

---

## Design decisions

### Backend: standard library only, no framework

`backend/go.mod` has **zero external dependencies**. Go 1.22 added method
patterns and path parameters to `net/http.ServeMux` (`POST /api/v1/operations/{operation}`
plus `r.PathValue`), which is the only thing chi or gin would have been pulled in
for. Zero dependencies also means no module downloads in the Docker build, no
supply-chain surface, and nothing to keep up to date.

### The operation registry

Operations live in one map in `internal/calc/calc.go`, each entry pairing the
implementation with its arity and description:

```go
type Definition struct {
    Op          Operation
    Arity       int
    Description string
    apply       func(a, b float64) (float64, error)
}
```

Both the compute handler and `GET /api/v1/operations` read from it, so the
endpoint that advertises the API cannot drift from the one that implements it —
a test asserts that every advertised operation actually computes. Adding an
operation is a single entry, not a change in four places.

### Layering

`internal/calc` performs arithmetic and knows nothing about HTTP. `internal/httpapi`
handles HTTP and knows nothing about arithmetic. The single place that speaks
both vocabularies is `fromDomainError`, which maps domain sentinels onto status
codes. This is what makes the arithmetic directly unit-testable and lets the
transport be swapped without touching the maths.

The frontend mirrors it: `useCalculator` holds every calculator semantic and is
tested against a stubbed API client; the components are thin and presentational.

### Operands are pointers

```go
type calculateRequest struct {
    A *float64 `json:"a"`
    B *float64 `json:"b"`
}
```

A `float64` field cannot distinguish "absent" from "explicitly zero". With plain
values, `{"a":10}` on a `divide` would decode `b` as `0` and return
`division_by_zero` — blaming the user for a divisor they never sent. Pointers
turn that into `invalid_operands`, which names the real problem. There is a test
asserting exactly this.

### Overflow is a 422, not a 500

`1e308 * 10` is `+Inf`, and `0^-1` is `+Inf`. Go's `encoding/json` **cannot
marshal `Inf` or `NaN`** — it returns an error. Without a guard, a valid-looking
request would produce a 500 with a broken body. `calc.Evaluate` checks every
result with `math.IsInf`/`math.IsNaN` and returns `ErrResultNotFinite`, which
maps to **422 Unprocessable Entity**: the request was well-formed and the
operands were individually fine, the *result* is simply not representable.

### Strict request decoding

`DisallowUnknownFields`, a rejection of trailing content after the JSON object,
and `http.MaxBytesReader` capping the body at 1 MiB. A typo like `{"a":1,"vb":2}`
fails loudly instead of silently becoming a missing operand.

### JSON errors everywhere, including 404 and 405

`net/http`'s built-in 404 and 405 are `text/plain`. Each route is therefore
registered twice — once with its method (`GET /healthz`) and once without
(`/healthz`) — and since a pattern carrying a method is more specific, the
method-less twin catches every other verb and answers in JSON with an `Allow`
header. A client never has to parse two different error formats.

### CORS wraps the router, not the handlers

Error responses carry CORS headers too. If they did not, a browser would block
the body of a 400 and the UI could only report "something went wrong" instead of
"cannot divide by zero". A test asserts headers are present on an error response.

### Frontend: every result comes from the API

Digits accumulate locally, but arithmetic never does. Pressing `=` sends the
pending operation; so does pressing a *second* operator, which is what makes
`12 ÷ 4 + 5` chain the way a physical calculator does (`12 ÷ 4` is flushed to
`3` the moment `+` is pressed). The backend is genuinely load-bearing rather
than decorative.

A unary result feeds a pending binary operation rather than replacing it, so
`9 + √16 =` is `13`.

**An oversized result shrinks rather than being clipped.** `2^99` formats to
`6.33825300114e+29`, wider than the panel at the display's natural size. The
value is measured after each change and scaled down until it fits, the way a
physical calculator does, with a floor below which it stops shrinking and
scrolls instead — 44px at 1280px wide, 25px at 390px, 19px at 320px, uncut at
all three. Scrollbars are hidden on the display and on history expressions,
since a strip of browser chrome across a readout reads as part of the number;
that is precisely why clipping had to be solved rather than left to the user to
scroll past.

**A stopped backend reports itself as unreachable, not as a strange reply.** In
every deployed configuration a proxy sits between the browser and the API — Vite
in development, nginx in the image — so a stopped backend does not make `fetch`
reject. The proxy answers with a 502 and an empty body. The client treats
502/503/504 as an unreachable service before it tries to read the body, which is
what makes the message the user sees ("Is the backend running?") match what
actually happened.

### Accessibility and responsiveness

Real `<button>` elements throughout; `aria-label`s spell out operators
("Divide", not "÷"); the display is an `<output>` with `aria-live="polite"`; the
error banner is `role="alert"`; focus rings are visible for keyboard users; the
`prefers-reduced-motion` and `prefers-color-scheme` media queries are both
honoured. The layout is a single centred column at every width: the calculator
owns the main area and history sits beneath it, collapsed to the most recent
result with a toggle that reveals the rest. That keeps the keypad the subject —
as a sidebar, history ended up wider than the calculator itself — and means
there is no reflow between breakpoints. Full physical-keyboard
support, since that is how most people use a calculator on a desktop.

### Containers

The backend image is `FROM scratch` with a static `CGO_ENABLED=0` binary and a
non-root UID — **10.5 MB**, with no shell or package manager for an attacker to
reach. Because scratch has no `curl`, the container health check re-executes the
binary with a `-healthcheck` flag that probes `/healthz` itself. Both images run
their test suites during the build, so a broken commit cannot produce a working
image. Compose gates the frontend on the backend's healthcheck.

---

## Assumptions

**Percentage is ambiguous, so this codebase commits to one reading.**
`percentage(a, b)` means **"a percent of b"** — `(a / 100) * b` — so
`percentage(20, 50)` is `10`. The alternatives, both rejected: `a` *as a
percentage of* `b` (`a/b*100`, which would make it `40`), and the
markup convention `a + (a * b / 100)` found on some pocket calculators. The
choice is the one that reads naturally from the operand order and matches how
the `%` key is labelled in the UI.

**Floating point is IEEE-754, and the README does not pretend otherwise.**
The API returns raw `float64`, so `0.1 + 0.2` really does come back as
`0.30000000000000004`. The frontend formats to 12 significant digits for
display, which hides the artefact without touching what the API returns. Exact
decimal arithmetic would need `math/big.Rat` or a decimal type — a reasonable
change for a financial application, and unnecessary complexity for a calculator.

**Arity is enforced strictly.** Sending `b` to `sqrt` is an error rather than
being silently ignored, because quietly dropping an operand hides a client bug.

**The API is unauthenticated and stateless.** There is no rate limiting and no
persistence; history lives in browser memory and is gone on refresh. For a
public deployment the API would need at minimum a rate limit.

---

## Project structure

```
calculator/
├── backend/
│   ├── cmd/server/main.go        # config, timeouts, graceful shutdown, health probe
│   └── internal/
│       ├── calc/                 # arithmetic + domain errors   (100% covered)
│       └── httpapi/              # routing, validation, errors, middleware (98.6%)
├── frontend/
│   └── src/
│       ├── api/client.ts         # typed fetch wrapper, discriminated-union results
│       ├── hooks/useCalculator.ts# the keypad state machine — all the logic
│       ├── hooks/useKeyboard.ts  # physical keyboard bindings
│       ├── components/           # Display, Keypad, Key, History, ErrorBanner
│       └── lib/format.ts         # float64 display formatting
│       └── test/integration/     # real backend + real proxy + real fetch
├── .gitlab-ci.yml                # unit, integration, and image-build jobs
├── docker-compose.yml
├── Makefile
└── PROMPTS.md                    # the prompts behind this repository
```

---

## With more time

- **Browser-level end-to-end tests.** The integration tier covers the client
  against a real backend through a real proxy, but nothing automated drives the
  actual UI; that was verified by hand in a headless browser. A Playwright suite
  against `docker compose up` would close the last gap.
- **Request IDs** threaded from the frontend through `slog`, so one calculation
  is traceable end to end.
- **Rate limiting** — the API is unauthenticated and currently unprotected.
- **`golangci-lint` and ESLint** — `gofmt`, `go vet` and `tsc --strict` are
  clean and gated in CI, but neither linter is wired up.
- **Decimal arithmetic** behind a flag, if exactness ever mattered more than
  speed.
