# Clean Code for Agents

> Default standards file written by `agent-harness`. This is the canonical
> `AGENTS.md` (Codex / OpenCode read it directly); `CLAUDE.md` is a one-line
> `@AGENTS.md` import, because Claude Code does not read AGENTS.md when a
> CLAUDE.md exists. Edit rules here, never in CLAUDE.md. Short, imperative,
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

## 7. Tests: E2E first, failures before code
Close the loop: **write → run test → read output → adjust → run again.** If tests
don't run headless, the agent goes blind.

**Order is non-negotiable**
- **Never write a unit test after the code it tests.** A test written to fit code that
  already exists encodes the bug along with the behavior — it passes by construction and
  proves nothing.
- Testing a unit in **isolation**? First write **every way it can fail** — empty, null,
  boundary, wrong type, duplicate, out-of-order, timeout, partial failure, concurrent
  write — **then** write the code. The failure list *is* the test suite; the code is what
  makes it pass.

**E2E is the default mechanism**
- Prefer **end-to-end** tests over unit tests. Verify a complex feature by driving it the
  way a real caller does: real stack, real wiring, real boundaries.
- Why: an E2E test survives refactors, catches the integration bugs unit tests cannot see,
  and is the only evidence the feature actually works.
- Every E2E run ends in a **verifiable, repeatable artifact** at a fixed, documented path:
  a structured report (JUnit XML / JSON), plus trace, screenshot, or request transcript
  when the flow is visual or networked. Named, diffable, committed or uploaded by CI.
- **Repeatable** means one documented command, same result on a clean machine, zero manual
  steps, and pass/fail decided by the artifact — never by a human squinting at output.

**Mechanics**
- A **single command** runs all tests; document it in this file / README / Makefile / package.json.
- Output in a predictable, structured format (JUnit XML, JSON) is ideal.
- **Zero manual setup** — no manual DB seeding, out-of-repo secrets, or "copy and edit" config.
- F.I.R.S.T: Fast, Independent, Repeatable, Self-validating, Timely.
- Coverage: business logic **95%+**, total **80%+**. Every bugfix gets a regression test —
  E2E whenever the bug is reachable end-to-end.
- Mock external I/O (API, DB, filesystem) with **named fakes** (`FakeEmailSender`,
  `StubPaymentGateway`) — greppable, reusable — never inline stubs. **Not in E2E:** an E2E
  that mocks the system under test is a unit test in costume.

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

## Model routing — delegate to cheaper subagents (default, all projects)
Goal: cut cost and speed up delivery. The orchestrator (**Opus 5.5** daily driver, or
**Fable 5.1**) plans, decides, integrates, and reviews. It delegates execution to
Sonnet/Haiku via the `Agent` tool's `model` param (`"sonnet"` / `"haiku"`) whenever a
subtask fits below. Use a non-fork `subagent_type`; `fork` ignores `model`. Applies only
to harnesses with model selection (Claude Code). Source: anthropic.com/claude/* pages, 2026-10-08.

| Model | Price in/out per Mtok | Use for |
|---|---|---|
| **Fable 5.1** | $10 / $50 | Orchestrator only for multi-day, async, or unattended jobs, codebase-wide features, deep perf work, high-stakes code review, and multi-stage research. Otherwise prefer Opus (≈ Fable level on most work, 2.5x cheaper). |
| **Opus 5.5** | $4 / $20 | Default orchestrator: ambiguous or architectural work, production code where correctness is critical, complex documents, long multi-tool agents, coordinating subagents, and final review. |
| **Sonnet 5.5** | $2 / $10 | Well-scoped, well-defined tasks with clear acceptance criteria: implementing a specified feature or bugfix, reviewing a diff, investigating a defined question, drafting docs/reports/slides, UI polish, diagrams and user flows, analyzing given documents, and writing tests from a failure list. |
| **Haiku 5.5** | $0.10 / $0.50 (≤100K prompt) | High-volume, repetitive, or latency-sensitive work: classify, summarize, extract fields, search or list files, mechanical edits across many files (rename, boilerplate), browser/form automation, routing, context compaction, running commands and reporting output, and parallel fan-out. |

- Pick the **cheapest model that does the subtask reliably**. If its output fails review,
  escalate one tier (Haiku → Sonnet → Opus); never retry the same tier more than once.
- **Keep in the orchestrator:** ambiguous requirements, architecture and trade-off decisions,
  anything touching money, auth, security, or data deletion, final integration, and conclusions for the user.
- **Brief subagents completely** (goal, files, constraints, acceptance criteria, output
  format). They do not see the conversation.
- Run independent subtasks **in parallel** (several `Agent` calls in one message).
- Don't delegate trivial one-step work (one grep, one read of a known file); the overhead
  exceeds the savings.
- The orchestrator **verifies subagent output** before reporting it as done, and the reply
  states which model handled which subtask.

### Cache discipline (subagent prompt-cache TTL = 5 min)
Why: a cache read costs ~0.1x input; once a subagent idles > 5 min its whole context is
re-written at 1.25x+ (~12–20x that call's input). Resuming large idle subagents drains the
weekly limit. A fresh subagent loses nothing — the cost is in *keeping one alive and coming back*.
User decision, 2026-10-09.
- Subagents are **one-shot**: one complete brief → one result → done. Never SendMessage
  a subagent idle > 4 min; spawn a fresh one with a compact brief (current diff + fix list).
- No subagent waits: no pipelines/teams with idle agents; the orchestrator holds
  dependencies and spawns the next agent only after the previous one finishes.
- Long commands (build/test > 3 min) run in the orchestrator (background), not inside a
  subagent. Haiku "runs commands" only for short ones.
- Keep subagent context small: name the exact files, demand compact output (diff + summary).
- Don't delegate when the orchestrator already holds the needed context.
- Review subagent output immediately; if review takes > 4 min, fixes go to a fresh agent.
- Main session too: resuming a huge session after a long idle re-pays its context; prefer a
  fresh session from an ai-memory handoff.

## Git workflow
- **Conventional Commits** with a scope (`feat(web): …`, `fix(api): …`, `docs(agents): …`);
  message language follows the project (PT-BR where the team writes PT-BR).
- **No AI attribution** in commits or PRs: no `Co-Authored-By: Claude`, no
  "Generated with Claude Code", no session links. (Claude Code: `attribution` blanked in
  `~/.claude/settings.json` + a PreToolUse guard hook — both from `agent-harness`.)
- **Never `git push`** (or open/merge a PR) unless the user asked for it in this session.
- **No squash merges** — keep every commit for full traceability.
- Branch before committing when on the default branch; commit only when asked.

## Forbidden behaviors (checklist)
- ❌ Deleting a comment the agent wrote in a previous iteration.
- ❌ Resuming (SendMessage) a subagent idle > 4 min, or leaving a subagent waiting on another.
- ❌ Pushing, opening a PR, or adding AI attribution without the user asking.
- ❌ A file above 500 lines, or a function above 20 lines without justification.
- ❌ `any` / untyped signatures.
- ❌ Generic names (`data`, `handler`, `Manager`, `result`).
- ❌ Duplicating logic instead of extracting.
- ❌ Skipping a test on a "simple" change.
- ❌ Writing a unit test after the code it covers.
- ❌ Writing an isolated unit before listing how it can fail.
- ❌ Shipping a complex feature with no E2E path proving it works.
- ❌ An E2E run that leaves no artifact, or needs a human to read it to decide pass/fail.
- ❌ Hardcoding a config value that belongs in env/constant.
- ❌ Instantiating a dependency inside the class instead of injecting it.
- ❌ Throwing an exception without the offending value in the message.
- ❌ Nesting 3+ levels of `if`/`for`/`try` without flattening.
- ❌ Mixing prose logs with structured logs.
- ❌ Installing/upgrading/calling a library without checking Context7 MCP first.

---

## Project-Specific Section (fill in — read every iteration)
- **Test command:** `<e.g. pnpm test>`
- **E2E command:** `<e.g. pnpm test:e2e>`
- **E2E artifact path:** `<e.g. artifacts/e2e/report.json, artifacts/e2e/traces/>`
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
SRP, unique names, explicit types, DRY, E2E-first tests, DI, provenance comments, and live
Context7 verification are technical constraints measurable in tokens, latency, and output
quality. Without them, the agent delivers plausible code that silently breaks what worked
yesterday. With them, it's a multiplier.
