# Prompts and AI tooling

The assignment asks that the prompts used be shared. This is the complete
record.

**Tool:** Claude Code (Opus 5), one session, working directly in the repository —
reading and writing files, running `go test`, `npm test`, `curl` and
`docker compose`, and driving the built UI in a headless Chromium.

---

## 1. The assignment prompt

The assignment brief was pasted in verbatim as the opening prompt: objective,
functional and non-functional requirements, constraints (React/TypeScript
frontend, Go backend), deliverables, and instructions. It is reproduced at the
end of this file.

## 2. Clarifying questions

Rather than guessing on decisions that would be expensive to reverse, four
questions were asked up front. The answers:

| Question | Answer |
|---|---|
| Go was not installed — install it, or run the toolchain through Docker? | Install Go 1.27 to `~/.local/go` (no `sudo`, nothing outside `$HOME`) |
| What REST shape? | `POST /api/v1/operations/{operation}` — operation in the path, operands in the body |
| What should the UI be? | A calculator keypad with a history panel |
| How far should the git setup go? | `git init` and local commits only — no push |

A follow-up instruction set the language convention: **the project is written
entirely in English; the working conversation was in Brazilian Portuguese.**

## 3. Planning

The next prompt asked for a written plan before any code: architecture, the
edge cases that would need to be handled, the test strategy, and how the result
would be verified. The approved plan is what the rest of the session executed —
the layering (`calc` / `httpapi`), the pointer-operand decision, the
overflow-to-422 guard, and the "verify every README `curl` example against the
running service" step were all settled there rather than discovered late.

## 4. Execution

From there the work followed the plan with no further prompting: domain package
and tests, HTTP layer and tests, frontend scaffold, state machine, components,
frontend tests, Docker, docs, git history.

---

## How the AI was actually used

Worth being precise, since "used AI tooling" covers a wide range.

**What it did well.** Generating the table-driven test matrices was the biggest
win — the backend's 134 cases and the frontend's 88 would have been tedious to
enumerate by hand, and breadth is exactly where an edge case gets missed. It was
also fast at boilerplate that has one correct shape: the nginx config, the
multi-stage Dockerfiles, the CSS custom-property theming.

**Where the judgement calls were.** The design decisions in the README are
decisions, not generated text: stdlib over a framework, pointer operands,
overflow as 422 rather than 500, strict decoding, registering each route twice
to get JSON 405s. Each was chosen deliberately and each is documented with its
reasoning.

**Bugs the AI wrote and then caught.** Two are worth recording, because they
show where generated code needs checking rather than trusting:

1. **`applyUnary` clobbered the pending operation.** The first version dispatched
   the shared `REQUEST_SUCCESS` action for unary results, which set
   `pendingOp: null` — so `9 + √16 =` would have lost the `+`. The code
   contradicted the comment sitting directly above it, which is what gave it
   away. Fixed with a dedicated `UNARY_SUCCESS` action; there is now a
   regression test asserting the result is `13`.

2. **`useKeyboard` re-bound its listener on every render.** The `handlers` object
   is constructed fresh each render, so as an effect dependency it tore the
   `keydown` listener down and re-added it continuously. Fixed by reading
   handlers through a ref and binding once.

3. **The "backend is down" message told the user the wrong thing.** The client had
   a carefully worded network error — *"Could not reach the calculator service. Is
   the backend running?"* — that turned out to be unreachable code. In every
   deployed configuration a proxy sits between browser and API (Vite in
   development, nginx in the image), so a stopped backend does not make `fetch`
   reject: the proxy answers with a 502 and an empty body, `fetch` resolves, and
   the client fell through to *"the service returned an unexpected response"*.
   Worse, a unit test asserted exactly that, so the wrong behaviour was pinned in
   place rather than caught. Fixed by treating 502/503/504 as an unreachable
   service before the body is read; the test now asserts the corrected message.

The first two came from reading the code afterwards — neither a type checker nor a
test would have found them. The third came from actually stopping the backend and
using the app, which no amount of code reading would have surfaced: the unit tests
mock `fetch` directly and therefore never exercise the proxy that causes it.

**The git history is a single burst, and that is not a claim of incremental work.**
`git log` shows fourteen commits inside about forty seconds. They are grouped as
logical units — domain, transport, tests, frontend, docker, docs — because that is
how the work was structured, but they were staged at the end of one session rather
than made as the code was written. The timestamps are left untouched on purpose:
rewriting them to imply hours of incremental work would misrepresent how this was
built. Read the messages, not the clock.

**Verification was not delegated.** Nothing was reported as working on the
strength of it having been written. Every `curl` example in the README was
executed against the running service and its real output pasted back; the UI was
driven in a headless browser in four states (desktop, error, mobile, dark) and
checked for console errors; the Docker stack was built and exercised through
nginx. Every coverage number in the README is a measured figure, not an estimate.

**One limitation is stated rather than hidden.** `go test -race` could not be run
— this machine has no C compiler, and the race detector requires cgo. The
handlers are stateless and share nothing across requests, so there is little for
it to find, but it was not run and the README does not claim it was.

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
