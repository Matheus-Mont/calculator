# Prompts and AI tooling

The assignment asks that the prompts used be shared. This is the record, written
to be accurate about who decided what rather than flattering about it.

**Tool:** Claude Code (Opus 5), working directly in the repository across three
sessions — reading and writing files, running `go test`, `npm test`, `curl` and
`docker compose`, and driving the built UI in a headless Chromium.

---

## How the work was actually divided

Worth stating plainly, because "used AI tooling" spans everything from
autocomplete to handing over the whole problem, and this sat in a specific place.

**The model proposed the architecture.** The layering (`internal/calc` knowing
nothing about HTTP, `internal/httpapi` knowing nothing about arithmetic), the
operation registry, pointer operands, overflow as a 422, the strict decoder, and
the three-tier test strategy were all put forward by the model as part of a
written plan. I reviewed that plan before any code existed and approved it.

**I decided scope, product and interface.** Which of the optional operations to
include, whether to add CI and a cross-boundary integration tier, the API shape
(operation in the path rather than the body), the stack constraints, and the
interface itself. The layout in particular went through my review twice: history
had been given more width than the calculator and read as the dominant panel, and
the redesign — one centred column, history stacked beneath and collapsed to the
latest result behind a toggle — came from that, not from the model.

**I directed the verification standard.** Nothing was to be reported as working
on the strength of having been written. Every `curl` example in the README was
executed against the running service with its real output pasted back, the UI was
driven in a headless browser, the Docker stack was built and exercised, and every
coverage figure is measured rather than estimated.

**What I did not do is write the code.** Being precise about that is the point of
this file. The value I added was direction, review and the standard applied to
both — which is the part of the work that does not transfer to the next
assignment if it is faked here.

---

## The prompts

### 1. The brief

The opening prompt was the assignment brief pasted verbatim — objective,
requirements, constraints, deliverables. On its own that is a weak prompt, and I
would not defend it as anything else. What made it workable was refusing to let
implementation start from it.

### 2. Clarification before any code

Four questions were answered before a line was written, because each would have
been expensive to reverse:

| Question | Decision |
|---|---|
| Go was not installed — install it, or run the toolchain through Docker? | Install Go 1.27 under `~/.local`, nothing outside `$HOME` |
| What REST shape? | `POST /api/v1/operations/{operation}` — operation in the path, operands in the body |
| What should the interface be? | A calculator keypad with history |
| How far should the git setup go? | Local commits only, no push |

A follow-up set the language convention: the repository is written entirely in
English; the working conversation was in Brazilian Portuguese.

### 3. A written plan, reviewed before implementation

The next prompt asked for a plan rather than code: architecture, the edge cases
that would need handling, the test strategy, and how the result would be
verified. That plan is where the decisions above were settled — including the
finiteness guard and the "verify every README example against the running
service" standard — rather than discovered late.

### 4. Iteration across sessions

Later sessions were driven by specific requests: fix the three defects found in
review, add the GitLab pipeline and the integration tier, rebalance the layout,
remove the display scrollbar. Each was a narrow instruction against working code,
not a fresh generation.

---

## What the AI got wrong

Seven defects in generated code, recorded because they mark where output needed
checking rather than trusting. **All seven were found by re-reading the code or by
exercising the running app — none by a type checker, and none by the test suite
that existed at the time.** The last two were found only when the finished
repository was reviewed as an evaluator would review it, which is the strongest
argument in this file for reviewing your own work adversarially before shipping
it.

1. **`applyUnary` clobbered the pending operation.** Unary results dispatched the
   shared success action, which set `pendingOp: null`, so `9 + √16 =` would have
   lost the `+`. Caught because the code contradicted the comment directly above
   it. Fixed with a dedicated action; a regression test now asserts `13`.

2. **`useKeyboard` re-bound its listener on every render.** The handlers object is
   built fresh each render, so as an effect dependency it tore the `keydown`
   listener down and re-added it continuously. Fixed by reading through a ref.

3. **The "backend is down" message said the wrong thing.** The client had a
   carefully worded network error that turned out to be unreachable code: in every
   deployed configuration a proxy sits between browser and API, so a stopped
   backend does not make `fetch` reject — the proxy answers 502 with an empty
   body, and the client reported "an unexpected response" instead of an
   unreachable service. A unit test asserted exactly that, pinning the wrong
   behaviour in place. Found by stopping the backend and using the app.

   This is what the integration tier exists for. The unit tests stub `fetch`, so
   none of them ever crosses a proxy. The regression test was verified to fail
   against the previous implementation before the fix was restored — a regression
   test that passes on the old code proves nothing.

4. **An impure reducer.** History ids were minted with `crypto.randomUUID()`
   inside the reducer. React may invoke a reducer more than once for the same
   action, so the same dispatch could produce different states. The id now travels
   on the action.

5. **A clipped result.** Hiding the display scrollbar exposed that `2^99` formats
   to `6.33825300114e+29` and was being silently truncated to `6.33825300114` —
   with no scrollbar there was nothing left to signal the exponent was missing, so
   the screen showed a number that was not the answer. The value is now scaled
   down until it fits, with a floor below which it scrolls instead.

6. **A crash on any deployment that is not localhost.** History ids were minted
   with `crypto.randomUUID()`, which browsers expose only in secure contexts.
   Served over plain HTTP by hostname or IP — how a container is normally reached
   — it is `undefined`, so the first successful calculation threw a TypeError,
   the result never reached the screen, and the keypad stayed disabled in its
   loading state. The app was unusable. Reproduced in a browser with the API
   removed, then fixed by dropping the UUID entirely: these ids are React keys
   within one session, so a counter does the job with no such dependency.

   This is the defect this whole file most warrants existing for. It cannot be
   seen in development, because `localhost` *is* a secure context.

7. **A race between the keyboard and the keypad.** The keypad is disabled while a
   request is in flight; the physical keyboard was not, and neither was the hook
   behind both. Holding Enter fired one request per keypress and wrote a history
   entry for each — five presses produced five requests and four duplicate
   entries for a single calculation. Fixed with a synchronous in-flight guard in
   the hook rather than in the keyboard handler, so every caller is covered.
   `state.isLoading` would not have worked: dispatching does not update state
   until the next render, so two calls in the same tick would both have read it
   as false.

---

## What was and was not verified

**Verified.** Every documented `curl` example executed against the running
service. Both regression tests above were confirmed to fail against the previous
implementation before the fixes were restored — a regression test that passes on
the broken code proves nothing. The UI driven in a headless browser at 1280, 390 and 320px, in both
colour schemes, checked for console errors. The Docker stack built with
`--no-cache` from a clean clone and exercised through nginx. Both suites run from
a fresh `git clone` so the README's figures reproduce.

**Not verified, and the README does not claim otherwise.** `go test -race` was
never run: the race detector requires cgo and the machine had no C compiler. The
handlers are stateless and share nothing across requests, so there is little for
it to find, but it was not run. There are also no browser-level end-to-end tests;
the integration tier covers the client against a real backend through a real
proxy, but nothing automated drives the UI itself.

---

## The commit history

Twenty-four commits across three sessions over five days: the initial build, a
round of bug fixes, then CI, the integration tier and the interface work.

The **first fourteen** carry near-identical timestamps. They are grouped as
logical units — domain, transport, tests, frontend, containers, docs — because
that is how the work was structured, but they were staged at the end of that
first session rather than made as the code was written. Later commits are spaced
as the work actually happened.

The timestamps are left untouched deliberately. Rewriting them to imply hours of
incremental work would misrepresent how this was built, and it is the kind of
thing that costs far more when noticed than the untidy history it would hide.
Read the messages, not the clock.

---
## Appendix: the assignment prompt, verbatim

> **Objective**
> Build a full-stack calculator application with a React frontend and a backend
> microservice. The frontend should consume the backend API to perform basic and
> advanced arithmetic operations. Focus on clean design, maintainable code, and
> testable architecture.
>
> **Requirements — Functional**
>
> Operations:
> * Addition, Subtraction, Multiplication, Division
> * Optional: Exponentiation, Square Root, Percentage
>
> Frontend (React):
> * Intuitive UI for entering input and displaying results
> * Input validation and error handling
> * Responsive design (basic mobile support)
>
> Backend (REST API):
> * Expose endpoints for calculator operations
> * Validate input and handle edge cases (division by zero, invalid data)
> * Return results in JSON format
>
> **Non-Functional**
> * Clean, readable, and idiomatic code (frontend and backend)
> * Unit tests covering key functionality for both layers
> * Documentation: setup instructions, API usage, and design rationale
> * Optional: Dockerfile for full-stack deployment
>
> **Constraints**
> * Frontend: React (TypeScript preferred)
> * Backend: Go is preferred
>
> **Deliverables**
> 1. Git repository with frontend and backend code
> 2. README with setup instructions, API examples, and design decisions
> 3. Unit tests and coverage report
> 4. Optional: Dockerfile to run frontend + backend together
>
> **Instructions**
> 1. Use any AI tooling you would like
> 2. Spend ~2–4 hours on this assignment. Prioritize correctness, clarity, and
>    maintainability over extra features.
> 3. Push your solution to GitHub, GitLab, or another Git repository.
> 4. Share the repository link with us for evaluation.
> 5. Share any prompts that you used in your work
> 6. Make sure your README includes: setup instructions; how to run the frontend
>    and backend; examples of API calls (if using REST); design decisions or
>    assumptions.
