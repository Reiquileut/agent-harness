<div align="center">

# agent-harness

**Dotfiles for AI agents — bootstrap Claude Code, Codex & OpenCode with one command.**

[![CI](https://github.com/Reiquileut/agent-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/Reiquileut/agent-harness/actions/workflows/ci.yml)
&nbsp;[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
&nbsp;![Node](https://img.shields.io/badge/Node-%E2%89%A5%2022-3c873a)
&nbsp;![Platforms](https://img.shields.io/badge/Linux%20·%20macOS%20·%20Windows-informational)

</div>

On a fresh machine you run **one command**, a menu opens, you pick which agents to
configure and which catalog items to install (MCP servers, skills, plugins, custom
agents, settings presets, repo docs), and `agent-harness` writes each one into the
right place for every agent — then prints the login commands for you to run.

> **Auth is never automated.** Logins differ per agent, so the tool prepares everything and
> **prints the exact login block** at the end.

---

## Contents

- [Quick start](#quick-start)
- [Highlights](#highlights)
- [The installer](#the-installer)
- [Commands](#commands)
- [What goes where](#what-goes-where)
- [Requirements](#requirements)
- [Private overlays](#private-overlays)
- [Integrations](#integrations)
- [The catalog](#the-catalog)
- [Auth block](#auth-block)
- [Post-install manifest](#post-install-manifest)
- [Architecture](#architecture)
- [Tests](#tests)
- [Docs](#docs)
- [Distribution](#distribution) · [License](#license)

---

## Quick start

```bash
# npx ships with Node — opens the interactive installer
npx github:reiquileut/agent-harness

# inside a project, set it up too
npx github:reiquileut/agent-harness scaffold
```

`pnpm` works the same: `pnpm dlx github:reiquileut/agent-harness`.

```bash
# Fresh Ubuntu box: installs Node, Claude Code, Codex, OpenCode, ai-memory…, then runs init
curl -fsSL https://raw.githubusercontent.com/Reiquileut/agent-harness/main/bootstrap/ubuntu.sh | bash -s -- --yes

# add your private overlay (dir or git URL — see "Private overlays")
npx github:reiquileut/agent-harness --overlay git@github.com:you/private-overlay.git
```

> **Needs:** Node ≥ 22, `git`, and internet. The repo is public (no login) and
> ships a committed `dist/`, so **nothing builds at install time**.

---

## Highlights

- **One menu, two scopes.** Configure your machine *and* the current repo in a
  single guided run — or drive everything with flags for CI.
- **Idempotent + `--dry-run`.** Re-running never duplicates; dry-run shows every
  action and writes nothing. Settings presets deep-merge (arrays union), so a
  permission or a hook is never added twice.
- **Secret-free.** The catalog stores env var *names* only — values are passed
  through at runtime, never written to disk or committed.
- **Cross-platform.** CI is green on Linux, macOS, and Windows (Node 22 & 24), plus a
  clean `ubuntu:24.04` bootstrap run. Catalog entries carry `platforms` (e.g. Pencil is
  Windows-only), so each OS gets only what applies.
- **Private overlays.** Keep anything tied to your accounts or clients in a separate
  private repo and layer it on with `--overlay`.
- **Integrations.** Run companion tools' own installers (ai-memory) as a catalog step.
- **Privacy guard.** `pnpm guard` fails CI if a denylisted token reaches this public repo.
- **Data-driven.** One `catalog.json` defines everything.

---

## The installer

Running the bare command opens a single menu with two groups — check anything
from either:

```
◆  Marque o que instalar (espaço alterna, enter confirma):
│
│  Nesta máquina (todos os projetos)
│  ◻ Figma   ◻ Chrome DevTools   ◻ Playwright (codex/opencode)   ◻ Context7 (codex/opencode)
│  ◻ Task Master MCP (codex)   ◻ LottieFiles   ◻ Pencil (Windows)   ◻ Stitch (claude only)
│  ◻ Claude official (context7, github, frontend-design, playwright)   ◻ OpenAI Codex plugin
│  ◻ typesafe-ai   ◻ Task Master   ◻ Obsidian skills   ◻ Warp (claude only)
│  ◻ Codex curated connectors   ◻ Codex bundled   ◻ Codex runtime
│  ◻ anti-ai-slop · global   ◻ prd · global   ◻ impeccable · global   ◻ find-skills · global
│  ◻ shadcn · global   ◻ grill-me · global   ◻ grilling · global   ◻ archify · global   …
│  ◻ Documentation Auditor · global   ◻ Impeccable Manual Edit Applier · global
│  ◻ Claude settings preset   ◻ Codex config preset   ◻ Codex global AGENTS.md
│  ◻ No AI attribution (hook)
│  Integrações
│  ◻ ai-memory — memória de longo prazo (MCP + hooks + skills)
│  ◻ <seu item> · privado     (itens do overlay ganham o sufixo " · privado")
│
│  Neste repositório (my-project)
│  ◻ AGENTS.md (+ CLAUDE.md stub)    ◻ Skill memory    ◻ .ai-memory.toml
│  ◻ anti-ai-slop · repo   ◻ prd · repo   ◻ impeccable · repo   …
│  ◻ Documentation Auditor · repo   ◻ Impeccable Manual Edit Applier · repo
│  ◻ .mcp.json + opencode.json     ◻ Merge .gitignore
└
```

It applies the machine items **and** sets up the repo in one pass, then prints the login block.
Skills and custom agents appear in both groups (**global** or **repo**); custom agents apply to
Claude Code (Markdown) and Codex (TOML) — OpenCode has no equivalent.

---

## Commands

### `init` — the installer (default)

The bare `npx github:reiquileut/agent-harness` runs this. Interactive by default
(the menu above); fully flag-drivable for CI. Non-interactive `init` flags are
**machine-only**:

```bash
agent-harness init \
  --agent claude-code --agent codex \
  --mcp figma --mcp chrome-devtools \
  --skill prd --skill impeccable \
  --plugin claude-official \
  --subagent documentation-auditor \
  --preset claude-settings --preset codex-config \
  -y

agent-harness init --all --agent claude-code   # everything in the catalog, one agent
agent-harness init --dry-run --all             # show every action, write nothing
```

Flags: repeatable `--agent/-a`, `--mcp`, `--skill`, `--plugin`, `--subagent`,
`--preset`, `--integration <id>` (e.g. `ai-memory`), `--overlay <dir|git-url>`
(also `AGENT_HARNESS_OVERLAY`, `;`-separated); plus `--all`, `--no-manifest`,
`-y/--yes`, `--dry-run`, `--force`.

### `scaffold` — repo level

Run inside any project (new or existing) to add **just the pieces you pick**:
`AGENTS.md` (canonical) with a `CLAUDE.md` stub that imports it, a skill memory file, project-scoped skills, project-scoped
custom agents, a project `.mcp.json` (and optionally `opencode.json`), and a
`.gitignore` merge.

```bash
agent-harness scaffold                          # interactive menu

# existing repo — add ONLY the docs + skills:
agent-harness scaffold --with-agents-md --skill prd --skill impeccable --no-gitignore -y

agent-harness scaffold --all -y                 # everything in the catalog

# per-repo ai-memory marker
agent-harness scaffold --with-ai-memory --ai-memory-workspace my-ws --ai-memory-project my-repo -y
```

Flags: `--with-claude-md` (implies `AGENTS.md`), `--with-agents-md`, `--with-memory`,
`--with-opencode`, `--with-ai-memory` + `--ai-memory-workspace <ws>` /
`--ai-memory-project <p>`, repeatable `--mcp`, `--skill`, `--subagent`, `--overlay`,
`--memory-dest <path>`, `--no-gitignore`, `--all`, `-y`, `--dry-run`, `--force`.
`AGENTS.md` holds the full template; Claude Code ignores it when a `CLAUDE.md`
exists, so `CLAUDE.md` is a stub: `@AGENTS.md` plus an HTML comment.
`--with-ai-memory` writes `.ai-memory.toml` (workspace/project and `[capture] ignore_paths`,
each glob both bare and `**/`-prefixed). Conventions: [docs/workflow.md](docs/workflow.md).

Project skills install into each agent's repo dir (`.claude/skills/`, `.agents/skills/`,
`.opencode/skills/`). Existing files are never clobbered (skipped unless `--force`); `.gitignore`
entries merge under a managed block; binary skill assets are copied byte-for-byte.

---

## What goes where

| | Claude Code | Codex | OpenCode |
|---|---|---|---|
| **User MCP** | `claude mcp add … --scope user` | `~/.codex/config.toml` `[mcp_servers]` | `~/.config/opencode/opencode.json` `mcp` |
| **Project MCP** | `./.mcp.json` (`mcpServers`) | — | `./opencode.json` (`mcp`) |
| **Skills** | `~/.claude/skills/` | `~/.agents/skills/` | `~/.config/opencode/skills/` |
| **Plugins** | `claude plugin …` | `~/.codex/config.toml` `[marketplaces]` + `[plugins]` | — |
| **Custom agents** | `~/.claude/agents/*.md` (user) · `.claude/agents/` (project) | `~/.codex/agents/*.toml` (user) · `.codex/agents/` (project) | — |
| **Presets** | `~/.claude/settings.json` (merge) · status-line scripts · `no-ai-attribution` hook in `~/.claude/hooks/` | `~/.codex/config.toml` (merge) | — |
| **Integrations** | `ai-memory install-mcp/-hooks --client claude-code` | same, `--client codex` | same, `--client opencode` |
| **Manifest** | `~/.claude/CLAUDE.md` (managed block) | `~/.codex/AGENTS.md` (managed block) | `~/.config/opencode/AGENTS.md` |
| **Instructions** | `~/.claude/CLAUDE.md` = `@~/.codex/AGENTS.md` · repo `CLAUDE.md` = `@AGENTS.md` stub | `~/.codex/AGENTS.md` · repo `AGENTS.md` (canonical) | `AGENTS.md` |
| **Login** | `claude` (or `/login`) | `codex login` | `opencode auth login` |

Skills go through the [`skills`](https://github.com/vercel-labs/skills) CLI (`npx skills add`) with a
bundled fallback; `"local"` skills are copied from `assets/skills/`; skills with their own installer
(Impeccable) run it once with every selected agent's provider name. MCPs are stored once in a
**neutral** shape and translated per agent (Claude `${VAR}`, Codex `env_vars`, OpenCode `{env:VAR}`);
`overrides` covers per-agent launch differences and agent-native keys. Custom agents are copied from
`assets/agents/<file>` — Markdown for Claude Code, TOML for Codex.

---

## Requirements

Works on **any machine** — Linux, macOS, or Windows — that has **Node ≥ 22**
(**≥ 22.18** for the `no-ai-attribution` hook, which runs TypeScript natively),
**git** (used to fetch from GitHub), and **internet**. On a bare Ubuntu box,
[`bootstrap/ubuntu.sh`](bootstrap/ubuntu.sh) installs all of that and the agents
(see [docs/linux.md](docs/linux.md)).

Without the agents installed it still opens the menu, runs `scaffold`, writes Codex/OpenCode configs
(plain file merges), copies local skills and applies presets. Only Claude Code's MCP/plugin steps need the
`claude` binary; without it MCPs **skip with a note** and plugins fall back to a `settings.json` merge.
Install your agents first, then run the installer.

---

## The catalog

Everything the menus offer lives in `assets/catalog.json`. Annotated excerpt:

```jsonc
{
  "agents": ["claude-code", "codex", "opencode"],
  "mcps": [
    // cross-agent (no `agents` field): { "id": "chrome-devtools", "transport": "stdio", "command": "npx", ... }
    // per-agent launch differences via `overrides`; `platforms` limits it to Windows
    { "id": "pencil", "transport": "stdio", "platforms": ["win32"], "command": "<pencil mcp server>",
      "args": ["--agent", "claudeCodeCLI"],
      "overrides": { "codex": { "args": ["--agent", "codexCLI"] } } },

    // claude-only — the `agents` allowlist scopes it (omit = all agents)
    { "id": "stitch", "transport": "http", "url": "https://stitch.googleapis.com/mcp",
      "headers": { "X-Goog-Api-Key": "${STITCH_API_KEY}" }, "env": ["STITCH_API_KEY"],  // names only; never stored
      "agents": ["claude-code"] }
  ],
  "skills": [
    { "id": "anti-ai-slop", "source": "local", "skill": "anti-ai-slop" },   // bundled in assets/skills/<id>/
    { "id": "archify", "source": "tt-a1i/archify", "requires": ["Node >= 18"] },  // fetched, bundled fallback
    { "id": "impeccable", "source": "npm:impeccable",                          // own installer CLI
      "installer": { "cmd": "npx", "args": ["--yes", "impeccable@latest", "install", "--providers={provider}"],
        "providers": { "claude-code": "claude", "codex": "codex" } } }
  ],
  "plugins": [
    { "id": "claude-official", "marketplace": "anthropics/claude-plugins-official",   // no `agents` = Claude AND Codex
      "name": "claude-plugins-official", "install": ["context7", "github", "frontend-design", "playwright"] }
  ],
  "presets": [
    { "id": "claude-settings", "agents": ["claude-code"], "files": [
        { "op": "merge-json", "asset": "presets/claude/settings.json", "dest": "~/.claude/settings.json" },
        { "op": "copy", "asset": "presets/claude/statusline-command.sh", "dest": "~/.claude/statusline-command.sh" } ] },
    { "id": "codex-global-instructions", "files": [
        { "op": "copy", "asset": "templates/clean-code-for-agents.md", "dest": "~/.codex/AGENTS.md", "keep": true },
        { "op": "ensure-prefix", "asset": "templates/CLAUDE.global-stub.md", "dest": "~/.claude/CLAUDE.md" } ] }
  ],
  "integrations": [
    { "id": "ai-memory", "bin": "ai-memory", "env": ["AI_MEMORY_SERVER_URL", "AI_MEMORY_AUTH_TOKEN"],
      "requiredEnv": ["AI_MEMORY_SERVER_URL"],
      "perAgent": [{ "cmd": "ai-memory", "args": ["install-mcp", "--client", "{agent}", "--apply"] }],
      "once":     [{ "cmd": "ai-memory", "args": ["install-instructions", "--target", "{{HOME}}/.codex/AGENTS.md"] }] }
  ],
  "templates": {
    "claude_md": "templates/CLAUDE.stub.md",             // stub: @AGENTS.md
    "agents_md": "templates/clean-code-for-agents.md",   // the full "Clean Code for Agents" doc
    "memory":    "templates/memory.md"
  },
  "gitignore": [".claude/settings.local.json", ".codex/hooks.json", ".env", ".env.*", "!.env.example", ".agent-harness/"]
}
```

**Field notes**

| Field | Meaning |
|---|---|
| MCP `env` | Names of env vars to remind you about; values are never written. |
| MCP `overrides.<agent>` | `command` / `args` replace the neutral ones for that agent; `extra` keys merge verbatim into that agent's entry. |
| MCP / Skill / Plugin / Preset `agents` | Optional allowlist (e.g. `["claude-code"]`); omit for all agents. |
| MCP / Skill / Preset file / Integration `platforms` | Optional OS allowlist (`win32` · `linux` · `darwin`); omit for all. `AGENT_HARNESS_PLATFORM` overrides detection (tests). |
| Integration | `bin` must be on PATH and `requiredEnv` set, else it warns and skips. `perAgent` commands run once per agent (`{agent}` via `agentNames`), `once` commands one time, `files` are preset-style merges. |
| Skill `source` | `owner/repo`, a URL, or `"local"` (bundled under `assets/skills/<id>/`). A remote source falls back to the bundled copy when the fetch fails; informational when `installer` is set. |
| Skill `requires` | Prerequisites the installer can't provide (a binary, a runtime); listed in the post-install manifest. |
| Skill `installer` | `cmd` + `args` run once per scope; `{provider}` = comma-joined provider names of the selected agents (from `providers`), `{scope}` = `global` / `project`. |
| Subagent `file` / `codex_file` | Filenames inside `assets/agents/`, copied verbatim — Markdown for Claude Code, TOML for Codex. |
| Plugin `name` | Marketplace's declared name, used in `<plugin>@<name>`. |
| Plugin `builtin` | The agent app registers the marketplace itself (Codex `openai-*`); only the enable tables are written. |
| Preset `files[].op` | `merge-json` / `merge-toml` deep-merge (arrays union, asset scalars win); `copy` writes verbatim (`keep` = never overwrite unless `--force`); `ensure-prefix` prepends a line (e.g. an `@import`) only if the file lacks it. `{{HOME}}` expands. |
| `templates` | `agents_md` is the full standard; `claude_md` is the stub that imports it. |

Override the whole catalog with `AGENT_HARNESS_CATALOG=/path/to/catalog.json`
(handy for an internal/team catalog without forking). The CLI warns when a value
still looks like a `<placeholder>`.

**The shipped catalog** mirrors a real Claude Code + Codex + OpenCode setup, so a
fresh machine reproduces it:

- **MCPs** — `figma`, `chrome-devtools`, `lottiefiles-creator` (all agents) · `pencil`
  (all agents, **Windows only**; `--agent` flag varies per agent) · `playwright`, `context7`
  (Codex/OpenCode — Claude gets both via the official plugin) · `taskmaster`,
  `upstash-context-7-mcp` (Codex) · `stitch` (Claude)
- **Skills** — bundled: `anti-ai-slop`, `prd`, `find-skills`, `shadcn`, `grill-me`,
  `grill-with-docs`, `paperclip-create-agent`, `computer-use`, `orca-cli`, `orchestration` ·
  fetched with a bundled fallback: `archify` · from `mattpocock/skills` (MIT): `grilling`,
  `domain-modeling` (`grill-me` delegates to `grilling`) · via its own installer:
  `impeccable` (`npx impeccable install`, which also wires its design-detector hooks and
  Claude subagents)
- **Agents** — `documentation-auditor`, `impeccable-manual-edit-applier` (Claude `.md` + Codex `.toml`)
- **Plugins** — `claude-official`, `openai-codex`, `taskmaster`, `obsidian-skills`, `typesafe-ai`
  (Claude Code + Codex) · `claude-code-warp` (Claude) · Codex app marketplaces
  `codex-openai-curated`, `codex-openai-bundled` (incl. `code-review`,
  `unified-computer-use`), `codex-openai-primary-runtime` (enable-only)
- **Presets** — `claude-settings` (no pinned model; `modelSettings`: opus-5-5 xhigh, opus-5,
  fable-5-1, sonnet-5 high; agent teams, auto mode, permissions, voice, status line using
  `python3` with `python` fallback; a `win32`-only extra adds `Bash(powershell:*)`) ·
  `codex-config` (gpt-6.1-sol, xhigh, `service_tier = "priority"`, `features.memories = false`,
  workspace-write + network; the `[windows]` tables are `win32`-only) ·
  `codex-global-instructions` (`~/.codex/AGENTS.md` + the `~/.claude/CLAUDE.md` import) ·
  `no-ai-attribution` (blanks Claude `attribution`; PreToolUse hook that denies
  `git commit` / `gh pr create|edit` carrying Claude attribution; fails open)
- **Integrations** — `ai-memory`
- **Docs** — `AGENTS.md` (the **Clean Code for Agents** standard, incl. model routing, cache
  discipline and Git workflow) and a `CLAUDE.md` stub that imports it

`computer-use`, `orca-cli`, and `orchestration` need the Orca desktop app on PATH; `requires`
surfaces that in the manifest (below).

---

## Private overlays

The public catalog is generic. Anything tied to your accounts or clients (private skills,
client-specific MCPs, server URLs) lives in a separate **overlay** layered on at run time:
`--overlay <dir|git-url>` (repeatable; on `init` and `scaffold`) or `AGENT_HARNESS_OVERLAY`
(`;`-separated).

- **Layout:** a directory with a partial `catalog.json` (`mcps`, `skills`, `subagents`,
  `plugins`, `presets`, `integrations`, `gitignore`; no `templates`) plus `skills/<id>/`,
  `agents/<file>` and `presets/…` beside it. See `test/fixtures/overlay/`.
- **Git specs** (`git@…`, `https://…`, `ssh://`, `file://`, `github:owner/repo`) are shallow-cloned
  with *your* git credentials into a temp dir that is always deleted; credentials are redacted
  from output. On a new machine run `gh auth login && gh auth setup-git` first.
- **Safety:** specs starting with `-` and asset paths with `..` or absolute paths are rejected.
  On an id collision the overlay wins, with a warning. Overlay items show " · privado" in the menu.
- **Privacy guard:** `node scripts/guard-no-private.mjs` (`pnpm guard`, first CI step) fails if a
  non-ignored file or path contains a token whose salted sha256 is in `scripts/private-denylist.sha256`
  (plaintext list lives in the private overlay repo; `AGENT_HARNESS_GUARD_LIST=<file>` adds tokens
  locally). Matches print file:line and a hash prefix, never the token.

---

## Integrations

An **integration** runs a companion tool's own installer as a catalog step
(`--integration <id>`). The shipped one is [`ai-memory`](https://github.com/akitaonrails/ai-memory):
it checks the `ai-memory` binary is on PATH and `AI_MEMORY_SERVER_URL` is set (otherwise it warns
and skips), then runs `install-mcp --client <agent> --apply` and
`install-hooks --agent <agent> --apply` per agent, and once
`install-instructions --target ~/.codex/AGENTS.md --skills-scope global --skills-agent both`. It also merges
`autoMemoryEnabled:false` / `autoDreamEnabled:false` into Claude's settings. The token
(`AI_MEMORY_AUTH_TOKEN`) is read from the environment by ai-memory itself, never stored by the
harness. Order of a run: presets → integrations → per-agent loop (manifest last).

---

## Auth block

At the end of `init` you get a copy-pasteable block listing only the agents/items
you installed:

```
✅ Installed. Run these logins once:
  Claude Code  →  claude            (OAuth on first run, or /login)
  Codex        →  codex login
  OpenCode     →  opencode auth login

  MCPs with OAuth (Figma, Notion, Google…) authenticate on first tool use.
  MCPs needing API keys — export in your shell/.env: STITCH_API_KEY
  ai-memory: export AI_MEMORY_SERVER_URL and AI_MEMORY_AUTH_TOKEN, then re-run with --integration ai-memory
  Impeccable: type /impeccable init inside the agent chat to set up design context.
```

---

## Post-install manifest

That block scrolls away, so `init` also writes a durable copy into each agent's
**global instructions file** — `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`,
`~/.config/opencode/AGENTS.md`. Skills are auto-discovered from their frontmatter,
but nothing otherwise tells the agent which MCPs, plugins and presets exist, or
that a skill needs a binary the installer never installed:

```markdown
<!-- BEGIN agent-harness -->
## Provisioned by agent-harness v1.6.0

This environment was set up by `agent-harness init`. Available to Codex:

**Skills** (`~/.agents/skills`) — anti-ai-slop, archify, computer-use, …
**MCPs** — chrome-devtools, context7, figma, playwright, taskmaster
**Subagents** (`~/.codex/agents`) — documentation-auditor, …
**Plugins** — claude-official, codex-openai-curated, openai-codex, …
**Presets** — codex-config, codex-global-instructions
**Integrations** — ai-memory

**Prerequisites the installer doesn't provide:**
- Node >= 18 — archify
- ai-memory binary on PATH — ai-memory
- Orca desktop app (`orca` on PATH) — computer-use, orca-cli, orchestration
- Env vars — AI_MEMORY_SERVER_URL, AI_MEMORY_AUTH_TOKEN
<!-- END agent-harness -->
```

Only the marked block is owned by the tool — anything around it survives, and re-running
`init` replaces the block in place. Opt out with `--no-manifest`.

---

## Architecture

```
   assets/catalog.json ──load + zod-validate──►  catalog.ts
            │
            ▼
   npx github:reiquileut/agent-harness          cli.ts (commander · init = default)
            │
            ├─ detect installed agents           agents.ts
            ▼
   overlays (dir / git) ──► overlay.ts · OS filter ──► platform.ts
            │
   ┌─ Nesta máquina ───────────┐   ┌─ Neste repositório ──────────┐
   │ 1 preset → presets.ts      │   │ CLAUDE.md / AGENTS.md / memory │
   │ 2 integration →            │
   │   integrations.ts, aimemory.ts │
   │ 3 per agent:               │
   │ MCP    → mcp.ts            │   │ project skills                 │
   │ skill  → skills.ts         │   │ project custom agents          │
   │ plugin → plugins.ts        │   │ .mcp.json / opencode.json      │  templates.ts
   │ agent  → subagents.ts      │   │ .gitignore                     │
   │ 4 manifest → manifest.ts   │   │                                │
   └───────────────────────────┘   └────────────────────────────────┘
            │                                   │
            └──── actions.ts: every change is an Action ───┘
                  (atomic write · idempotent · --dry-run previews, writes nothing)
            │
            ▼
   Claude Code  ·  Codex  ·  OpenCode      +      printed login block
```

Source layout: `src/cli.ts` routes to `src/commands/{init,scaffold}.ts`; the
`src/core/*` modules (`catalog`, `agents`, `overlay`, `platform`, `mcp`, `skills`,
`subagents`, `plugins`, `presets`, `integrations`, `aimemory`, `manifest`, `templates`,
`actions`, `fsx`) are small and single-purpose.
`assets/` holds the catalog, bundled skills, bundled custom agents, presets, and
templates.

---

## Tests

```bash
bash scripts/ci-e2e.sh            # all suites; pass a suite name to run one
pnpm test:hooks                   # unit tests of the attribution hook
pnpm guard                        # privacy guard
```

`scripts/ci-e2e.sh` runs `scripts/e2e/{10-init,15-claude-cli,20-scaffold,30-platform,40-overlay,50-integrations,60-guard}.sh`
and writes **`artifacts/e2e/report.json`**; pass/fail is its `failed` count. CI runs a
Linux/Windows/macOS × Node 22/24 matrix plus the `bootstrap-ubuntu` job (clean `ubuntu:24.04`
container, artifact `artifacts/e2e/bootstrap-ubuntu.json`).

---

## Docs

[docs/workflow.md](docs/workflow.md) (how we work: AGENTS.md, testing, model routing, ai-memory, Git,
public vs. private) · [docs/linux.md](docs/linux.md) (new Ubuntu machine runbook) — both in PT-BR.

---

## Distribution

`npx`/`pnpm dlx github:reiquileut/agent-harness` is the primary path (`dist/` is committed; nothing
builds at install time). An npm package (`@r2t/agent-harness`) is planned; `install.sh` forwards
to the same entrypoint for `curl | bash`.

---

## License

[MIT](./LICENSE). Bundled skills under `assets/skills/` keep their own licenses
(`archify` is MIT); `impeccable` (Apache-2.0) is installed from npm at run time
rather than bundled.
