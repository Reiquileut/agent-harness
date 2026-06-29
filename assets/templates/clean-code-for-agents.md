# Clean Code for Agents

> Default standards file written by `agent-harness`. Serves as both `CLAUDE.md`
> (Claude Code) and `AGENTS.md` (Codex / OpenCode). Short, imperative,
> action-oriented — each line is reloaded every iteration, so density matters.
> Fill in the **Project-Specific Section** at the bottom.

## 1. Function and file size
- Functions: **4–20 lines**. If it exceeds, split it.
- Files: **below 500 lines**; ideal 200–300. Split by responsibility beyond that.
- Every function must fit in a single tool call without truncation.
- Every file must fit in a single read without pagination.
- Why: agent read tools have limits (~2000 lines). Pagination fragments attention.

## 2. Single Responsibility Principle
- One module = one reason to change. One function = one action.
- Three 250-line classes beat one 800-line class, even at identical total volume.
- Mixed responsibilities force the agent to load more context for trivial changes.

## 3. Unique and greppable names
- Names must be searchable and distinctive. **Grep is the agent's primary navigation API.**
- Target: a grep of any identifier returns **< 5 matches** repo-wide.
- Forbidden generic names: `data`, `handler`, `process`, `Manager`, `Service`,
  `Helper`, `Util`, `item`, `value`, `info`, `result`, `obj`.
- Prefer: `UserRegistrationValidator`, `InvoiceLineItemTotal`, `ClaudeCodeSessionTracker`.

## 4. Comments: context and provenance
The biggest reversal from 2008-era Clean Code — the agent reads comments and benefits.

**DO**
- Write the **WHY**, not the WHAT. The model reads syntax; it doesn't know why you
  chose this over the obvious approach.
- Record provenance: bug numbers (`// fix for #1234`), commit SHAs, Jira keys, upstream issues.
- Document business constraints: why a specific order, format, or edge case exists.
- Docstring on every public function: intent + a usage example (JSDoc, `"""`, `///`).

**DON'T**
- Don't remove comments you (the agent) wrote in previous iterations — that destroys
  context you'll need next iteration.
- Don't write obvious comments (see rule 13).

## 5. Explicit types everywhere
- Python: type hints on every signature; avoid bare `Dict`/`List`/`Any`.
- JavaScript → **TypeScript**. Zero implicit `any`.
- Rust / Go / Java / Kotlin: already typed — don't escape with `unsafe` / `interface{}` / `Object`.
- Why: types are a free template for the agent. Their absence forces slow, error-prone inference.

## 6. DRY — zero duplication
- Duplication is worse for an agent than for a human: updating one copy, it may not
  find the others — the attention window has no gravity pulling "there are two copies".
- Extract shared logic into a function, module, or mixin. This is refactor safety, not aesthetics.

## 7. Tests the agent can run
Close the loop: **write → run test → read output → adjust → run again.** If tests
don't run headless, the agent goes blind.
- A **single command** runs all tests; document it in this file / README / Makefile / package.json.
- Output in a predictable, structured format (JUnit XML, JSON) is ideal.
- **Zero manual setup** — no manual DB seeding, out-of-repo secrets, or "copy and edit" config.
- F.I.R.S.T: Fast, Independent, Repeatable, Self-validating, Timely.
- Coverage: business logic **95%+**, total **80%+**. Every bugfix gets a regression test.
- Mock external I/O (API, DB, filesystem) with **named fakes** (`FakeEmailSender`,
  `StubPaymentGateway`) — greppable, reusable — never inline stubs.

## 8. Predictable directory structure
- Follow the framework convention (Rails, Django, Next.js, Laravel, Phoenix, FastAPI).
- Forbidden: `random_stuff/`, `utils2/`, `new_feature_v3_final/`, a flat folder with 200 files.
- Idiosyncratic structure forces repeated `find`/`ls`, burning tokens.

## 9. Dependency injection
- Inject dependencies via constructor/argument — never via global import or hidden singleton.
- Wrap third-party libraries behind a thin project interface (`LLMProvider.chat(...)`,
  not `OpenAI.chat(...)` scattered everywhere). Swapping providers becomes one line.
- Centralize external names (model, endpoint, bucket) in a single constant/config.

## 10. Avoid deep nesting
- Max **2 levels** of indentation in a function body.
- Use early returns and guard clauses; flatten pyramids with `match`/`switch`/helpers.
- Each level is extra state the model must track; 4 levels cost disproportionately more than 2.

## 11. Errors with context
Every exception message must contain the **offending value** (`repr()` / `%#v` / `Debug`)
and the **expected shape**.
- Bad: `raise ValueError("invalid input")`
- Good: `raise ValueError(f"invalid input: received {repr(x)}, expected non-empty string of digits")`

## 12. Formatting — decided, not discussed
Use the language's standard formatter: `cargo fmt`, `gofmt`, `prettier`, `black`/`ruff format`,
`rubocop -A`. Wire a pre-commit hook + format-on-save. No tabs-vs-spaces debates.

## 13. No obvious comments
Remove `// increment i by 1` over `i++`. The model reads code. Exception: provenance
comments from rule 4 stay.

## 14. Research libraries/APIs via Context7 MCP — non-negotiable
Training data is frozen; libraries ship breaking changes weekly. The model's recollection
of an API is a hypothesis, not a fact.

**Query Context7 before:** installing/upgrading any dependency; writing a non-trivial
third-party call; using a function/hook/method you're not 100% sure still exists;
adopting a new tool; debugging a version-mismatch / deprecated / removed-export error.

**Workflow:** `resolve-library-id` → `query-docs` (focused question) → implement from the
returned docs → cite it: `// per Context7 docs for <library>@<version>, <date>`.

**Forbidden:** guessing an API "because it used to work this way"; copy-pasting an old
pattern without re-validating; ignoring Context7 after a major version bump.

---

## Agent-specific infrastructure
- **This file (CLAUDE.md / AGENTS.md):** short, imperative, bullets — conventions, key
  commands, caveats, gotchas. Reloaded every iteration; density matters.
- **README:** high-level architecture at top, an ASCII/Mermaid component diagram, onboarding commands.
- **Structured logging:** emit JSON with named fields for debug/observability; free text
  only for end-user CLI output.
- **Observability commands:** expose `make test|lint|typecheck|build`, `pnpm test`,
  `cargo check`, `python -m mypy src/`. More one-liners → tighter feedback loop.
- **Idempotent setup:** `bin/setup` works on a clean machine. No "ask so-and-so for the .env".

## Defensive programming (enable per project)
The agent ships only the happy path unless told otherwise. Mark what this project needs:
rate limiting · retry with exponential backoff · circuit breaker · aggressive network
timeouts · graceful degradation/fallback · input validation at all boundaries ·
idempotency keys on mutations · health-check endpoint · feature flags on risky code.

## Forbidden behaviors (checklist)
- ❌ Deleting a comment the agent wrote in a previous iteration.
- ❌ A file above 500 lines, or a function above 20 lines without justification.
- ❌ `any` / untyped signatures.
- ❌ Generic names (`data`, `handler`, `Manager`, `result`).
- ❌ Duplicating logic instead of extracting.
- ❌ Skipping a test on a "simple" change.
- ❌ Hardcoding a config value that belongs in env/constant.
- ❌ Instantiating a dependency inside the class instead of injecting it.
- ❌ Throwing an exception without the offending value in the message.
- ❌ Nesting 3+ levels of `if`/`for`/`try` without flattening.
- ❌ Mixing prose logs with structured logs.
- ❌ Installing/upgrading/calling a library without checking Context7 MCP first.

---

## Project-Specific Section (fill in — read every iteration)
- **Test command:** `<e.g. pnpm test>`
- **Lint command:** `<e.g. make lint>`
- **Type-check command:** `<e.g. make typecheck>`
- **Build command:** `<e.g. make build>`
- **Setup command:** `<e.g. bin/setup>`
- **Entry points:** `<e.g. src/main.py, apps/web/app/page.tsx>`
- **Domain glossary:** `<business terms, one line each>`
- **Known caveats:** `<upstream bugs, legacy modules, hot zones>`
- **Stack:** `<language, framework, database, queues, observability>`
- **Commit conventions:** `<e.g. Conventional Commits>`
- **Branch strategy:** `<e.g. trunk-based, mandatory PR>`
- **Critical libraries to re-verify on Context7:** `<e.g. LangChain, FastAPI, Anthropic SDK>`

---

**Root principle:** clean code for agents is infrastructure, not fashion. Small functions,
SRP, unique names, explicit types, DRY, runnable tests, DI, provenance comments, and live
Context7 verification are technical constraints measurable in tokens, latency, and output
quality. Without them, the agent delivers plausible code that silently breaks what worked
yesterday. With them, it's a multiplier.
