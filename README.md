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

**New machine, same setup.** The catalog flags the owner's everyday setup as `default`, so the
menu opens with it already checked — press Enter. Without the menu:

```bash
# everything flagged default, for every agent you name
npx github:reiquileut/agent-harness init -y --defaults -a claude-code -a codex -a opencode

# the same, plus the private overlay's defaults (needs `gh auth login && gh auth setup-git`)
npx github:reiquileut/agent-harness init -y --defaults -a claude-code -a codex \
  --overlay github:you/private-overlay
```

```bash
# Fresh Mac with Homebrew: installs Node, Claude Code, Codex, OpenCode, ai-memory, TWG…, then init --defaults
curl -fsSL https://raw.githubusercontent.com/Reiquileut/agent-harness/main/bootstrap/macos.sh | bash -s -- --yes

# Fresh Ubuntu box: the same through apt, NodeSource and the official installers
curl -fsSL https://raw.githubusercontent.com/Reiquileut/agent-harness/main/bootstrap/ubuntu.sh | bash -s -- --yes

# add your private overlay (dir or git URL — see "Private overlays")
npx github:reiquileut/agent-harness --overlay git@github.com:you/private-overlay.git
```

Neither bootstrap asks for a secret: it installs everything, then prints the logins and tokens
to set afterwards, with one re-run (`init -y --defaults --overlay …`) that adds what waited for them.

> **Needs:** Node ≥ 22 (≥ 22.18 for the hooks, mods and status line), `git`, and internet. The
> repo is public (no login) and ships a committed `dist/`, so **nothing builds at install time**.

---

## Highlights

- **One menu, two scopes.** Configure your machine *and* the current repo in a
  single guided run — or drive everything with flags for CI.
- **Your setup by default.** Entries flagged `default` come pre-checked in the menu and are what
  `init -y --defaults` installs, so another machine ends up matching this one.
- **Claude Code mods.** A bundled local plugin marketplace (`agent-harness-mods`: tool skins,
  cache-tax, ai-memory first read, savvy) staged into `~/.claude/mods`; mods you edit there are kept.
- **Global hooks.** Disk/Docker hygiene and the no-attribution guard for Claude Code, plus Codex's
  ai-memory start-up read; all TypeScript run directly by Node, so they work on every OS.
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
- **Integrations.** Run companion tools' own installers (ai-memory, Atlassian TWG skills) as a
  catalog step.
- **Privacy guard.** `pnpm guard` fails CI if a denylisted token reaches this public repo.
- **Data-driven.** One `catalog.json` defines everything.

---

## The installer

Running the bare command opens a single menu with two groups — check anything
from either:

```
◆  Marque o que instalar (já vem marcado o seu setup padrão; espaço alterna, enter confirma):
│
│  Nesta máquina (todos os projetos)
│  ◻ Figma   ◼ Chrome DevTools   ◼ Playwright (codex/opencode)   ◼ Context7 (codex/opencode)
│  ◼ Task Master MCP (codex)   ◻ LottieFiles   ◼ Pencil (Windows)   ◻ Stitch (claude only)
│  ◼ Claude official (context7, github, frontend-design, playwright)   ◼ OpenAI Codex plugin
│  ◼ typesafe-ai   ◼ Task Master   ◼ Obsidian skills   ◼ Warp (claude only)
│  ◼ Mod tool-skins   ◼ Mod cache-tax   ◼ Mod ai-memory-first-read   ◼ Mod savvy
│  ◼ Codex curated connectors   ◼ Codex bundled   ◼ Codex runtime
│  ◼ anti-ai-slop · global   ◼ prd · global   ◼ impeccable · global   ◼ find-skills · global
│  ◼ shadcn · global   ◼ grill-me · global   ◼ grilling · global   ◼ archify · global   …
│  ◼ Documentation Auditor · global   ◼ Impeccable Manual Edit Applier · global   …
│  ◼ Claude settings preset   ◼ Codex config preset   ◼ Codex global AGENTS.md
│  ◼ No AI attribution (hook)   ◼ Higiene de disco/Docker (hook)
│  Integrações
│  ◼ ai-memory — memória de longo prazo (MCP + hooks + skills)
│  ◼ TWG (Atlassian Teamwork Graph) skills
│  ◻ <seu item> · privado     (itens do overlay ganham o sufixo " · privado")
│
│  Neste repositório (my-project)
│  ◻ AGENTS.md (+ CLAUDE.md stub)    ◻ Skill memory    ◻ .ai-memory.toml
│  ◻ anti-ai-slop · repo   ◻ prd · repo   ◻ impeccable · repo   …
│  ◻ Documentation Auditor · repo   ◻ Impeccable Manual Edit Applier · repo
│  ◻ .mcp.json + opencode.json     ◻ Merge .gitignore
└
```

`◼` marks the catalog's `default` entries (an overlay can flag its own). Repo items start unchecked.
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

agent-harness init -y --defaults -a codex      # the entries flagged default (the owner's setup)
agent-harness init --all --agent claude-code   # everything in the catalog, one agent
agent-harness init --dry-run --all             # show every action, write nothing
```

Flags: repeatable `--agent/-a`, `--mcp`, `--skill`, `--plugin`, `--subagent`,
`--preset`, `--integration <id>` (e.g. `ai-memory`), `--overlay <dir|git-url>`
(also `AGENT_HARNESS_OVERLAY`, `;`-separated); plus `--defaults`, `--all`, `--no-manifest`,
`-y/--yes`, `--dry-run`, `--force`.

`-y` alone installs only what the item flags name (as in v1.6). `--defaults` adds every entry
flagged `default`, public and overlay alike; item flags add to it. `--force` also replaces a
bundled mod you edited in `~/.claude/mods`.

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
| **Mods** | `~/.claude/mods` (local marketplace `agent-harness-mods`, `claude plugin install <mod>@agent-harness-mods`) | — | — |
| **Custom agents** | `~/.claude/agents/*.md` (user) · `.claude/agents/` (project) | `~/.codex/agents/*.toml` (user) · `.codex/agents/` (project) | — |
| **Presets** | `~/.claude/settings.json` (merge) | `~/.codex/config.toml` (merge) | — |
| **Status line** | `~/.claude/statusline.ts`, run as `node ~/.claude/statusline.ts` | — | — |
| **Global hooks** | `~/.claude/hooks/` — `no-ai-attribution` commit/PR guard, `docker-disk-hygiene` | `~/.codex/hooks.json` + `~/.codex/hooks/` — ai-memory start-up read (with the ai-memory integration) | — |
| **Integrations** | `ai-memory install-mcp/-hooks --client claude-code` · TWG `--agent claude` | ai-memory `--client codex` · TWG's canonical `~/.agents/skills` | ai-memory `--client opencode` · TWG `--agent opencode` |
| **Manifest** | `~/.claude/CLAUDE.md` (managed block) | `~/.codex/AGENTS.md` (managed block) | `~/.config/opencode/AGENTS.md` |
| **Instructions** | `~/.claude/CLAUDE.md` = `@~/.codex/AGENTS.md` · repo `CLAUDE.md` = `@AGENTS.md` stub | `~/.codex/AGENTS.md` (the rules in their own managed block) · repo `AGENTS.md` (canonical) | `AGENTS.md` |
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
(**≥ 22.18** for the hooks, the mods and the status line, which are TypeScript run natively),
**git** (used to fetch from GitHub), and **internet**. On a bare Ubuntu box,
[`bootstrap/ubuntu.sh`](bootstrap/ubuntu.sh) installs all of that and the agents
(see [docs/linux.md](docs/linux.md)); on a Mac with Homebrew, [`bootstrap/macos.sh`](bootstrap/macos.sh)
does (see [docs/macos.md](docs/macos.md)). Both are generated from `bootstrap/src/`
(`pnpm build:bootstrap`), so each stays one self-contained file for `curl | bash`.

Without the agents installed it still opens the menu, runs `scaffold`, writes Codex/OpenCode configs
(plain file merges), copies local skills and applies presets. Only Claude Code's MCP/plugin steps need the
`claude` binary; without it MCPs **skip with a note** and plugins fall back to a `settings.json` merge.
Install your agents first, then run the installer.

---

## The catalog

Everything the menus offer lives in `assets/catalog.json`, in six sections (`mcps`, `skills`,
`subagents`, `plugins` with the mods, `presets`, `integrations`) plus `templates` and `gitignore`.
Entries flagged `default` are the owner's setup: pre-checked in the menu and installed by
`init --defaults`. Entries name env vars, never values. Override the whole catalog with
`AGENT_HARNESS_CATALOG=/path/to/catalog.json` (the CLI warns when a value still looks like a
`<placeholder>`).

**[docs/catalog.md](docs/catalog.md)** has the annotated format, every field, and the full list of
what ships: MCPs, skills, agents, plugins, mods, presets and integrations, with the defaults marked.

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
- **Defaults:** overlay entries carry their own `default` flag, so `--defaults --overlay …` brings the
  private side of your setup too; leave risky ones (an MCP that writes to a paid account) unflagged.
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
`autoMemoryEnabled:false` / `autoDreamEnabled:false` into Claude's settings and, for Codex, copies
`~/.codex/hooks/ai-memory-startup.ts` (+ its `.txt`) and merges a SessionStart entry into
`~/.codex/hooks.json`, so each Codex session opens by reading the project's memory. The token
(`AI_MEMORY_AUTH_TOKEN`) is read from the environment by ai-memory itself, never stored by the
harness. Order of a run: presets → integrations → per-agent loop (manifest last).

`twg-skills` installs the Atlassian Teamwork Graph skills (Jira, Confluence, Rovo search…) with your
own `twg` CLI: `twg skills install -y --agent claude --agent opencode` (the canonical
`~/.agents/skills` copy covers Codex). Those skills are Atlassian-licensed, so this repo never bundles
them. Without `twg` on PATH it warns with the setup hint (`twg setup`) and skips.

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
  Integrations read from your environment: AI_MEMORY_SERVER_URL, AI_MEMORY_AUTH_TOKEN
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
## Provisioned by agent-harness v1.7.0

This environment was set up by `agent-harness init`. Available to Codex:

**Skills** (`~/.agents/skills`) — anti-ai-slop, archify, computer-use, …
**MCPs** — chrome-devtools, context7, playwright, taskmaster, upstash-context-7-mcp
**Subagents** (`~/.codex/agents`) — documentation-auditor, …
**Plugins** — claude-official, codex-openai-curated, openai-codex, …
**Presets** — codex-config, codex-global-instructions
**Integrations** — ai-memory, twg-skills

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
pnpm test:hooks                   # node --test of the hooks and the status line
pnpm guard                        # privacy guard
```

`scripts/ci-e2e.sh` runs every `scripts/e2e/[0-9]*.sh` suite (`10-init`, `15-claude-cli`, `20-scaffold`,
`30-platform`, `40-overlay`, `50-integrations`, `60-guard`, `70-bootstrap`, `71-bootstrap-build`,
`72-bootstrap-macos`, `80-defaults`, `82-mods`, `84-hooks`, `86-global-rules`, `88-twg`, `89-statusline`)
and writes **`artifacts/e2e/report.json`**; pass/fail is its `failed` count. Fakes for the agent CLIs
(`claude`, `ai-memory`, `twg`) live in `test/fixtures/bin/`, and the Mac stand-ins (`uname`, `brew`,
plus `curl`/`npm` that refuse to download) in `test/fixtures/bootstrap-macos/`, so no real agent,
account or installer is touched. CI runs a Linux/Windows/macOS × Node 22/24 matrix plus two real
bootstrap runs: `bootstrap-ubuntu` (clean `ubuntu:24.04` container) and `bootstrap-macos` (macOS
runner, stock bash 3.2), artifacts `artifacts/e2e/bootstrap-<os>.json`.

---

## Docs

[docs/workflow.md](docs/workflow.md) (how we work: AGENTS.md, the default setup, hooks/mods/status line,
testing, model routing, ai-memory, Git, public vs. private) · [docs/linux.md](docs/linux.md) (new Ubuntu machine
runbook) · [docs/macos.md](docs/macos.md) (new Mac runbook) — all three in PT-BR ·
[docs/catalog.md](docs/catalog.md) (catalog format and the shipped list).

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
