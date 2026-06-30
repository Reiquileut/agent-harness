<div align="center">

# agent-harness

**Dotfiles for AI agents — bootstrap Claude Code, Codex & OpenCode with one command.**

[![CI](https://github.com/Reiquileut/agent-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/Reiquileut/agent-harness/actions/workflows/ci.yml)
&nbsp;[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
&nbsp;![Node](https://img.shields.io/badge/Node-%E2%89%A5%2020-3c873a)
&nbsp;![Platforms](https://img.shields.io/badge/Linux%20·%20macOS%20·%20Windows-informational)

</div>

On a fresh machine you run **one command**, a menu opens, you pick which agents to
configure and which catalog items to install (MCP servers, skills, plugins, repo
docs), and `agent-harness` writes each one into the right place for every agent —
then prints the login commands for you to run.

> **Auth is never automated.** Logins are OAuth/browser flows that differ per
> agent, so the tool prepares everything and **prints the exact login block** at
> the end.

---

## Contents

- [Quick start](#quick-start)
- [Highlights](#highlights)
- [The installer](#the-installer)
- [Commands](#commands)
- [What goes where](#what-goes-where)
- [Requirements](#requirements)
- [The catalog](#the-catalog)
- [Auth block](#auth-block)
- [Architecture](#architecture)
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

> **Needs:** Node ≥ 20, `git`, and internet. The repo is public (no login) and
> ships a committed `dist/`, so **nothing builds at install time**.

---

## Highlights

- **One menu, two scopes.** Configure your machine *and* the current repo in a
  single guided run — or drive everything with flags for CI.
- **Idempotent + `--dry-run`.** Re-running never duplicates; dry-run shows every
  action and writes nothing.
- **Secret-free.** The catalog stores env var *names* only — values are passed
  through at runtime, never written to disk or committed.
- **Cross-platform.** CI is green on Linux, macOS, and Windows (Node 20 & 22).
- **Data-driven.** One `catalog.json` defines everything; edit it without
  touching code.

---

## The installer

Running the bare command opens a single menu with two groups — check anything
from either:

```
◆  Marque o que instalar (espaço alterna, enter confirma):
│
│  Nesta máquina (todos os projetos)
│  ◻ Figma        ◻ Chrome DevTools    ◻ Stitch  (claude only)
│  ◻ Claude official (context7, github, frontend-design, playwright)
│  ◻ anti-ai-slop · global   ◻ prd · global   ◻ impeccable · global
│
│  Neste repositório (my-project)
│  ◻ CLAUDE.md    ◻ AGENTS.md    ◻ Skill memory
│  ◻ anti-ai-slop · repo   ◻ prd · repo   ◻ impeccable · repo
│  ◻ .mcp.json + opencode.json     ◻ Merge .gitignore
└
```

It applies the machine items **and** sets up the repo in one pass, then prints
the login block. Skills appear in both groups: **global** (all your projects) or
**repo** (just this one). So you can run it inside an existing repo and add, say,
only `CLAUDE.md` + `AGENTS.md` + a couple of skills.

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
  --skill prd \
  --plugin claude-official \
  -y

agent-harness init --all --agent claude-code   # everything in the catalog, one agent
agent-harness init --dry-run --all             # show every action, write nothing
```

Flags: repeatable `--agent/-a`, `--mcp`, `--skill`, `--plugin`; plus `--all`,
`-y/--yes`, `--dry-run`, `--force`.

### `scaffold` — repo level

Run inside any project (new or existing) to add **just the pieces you pick**:
`CLAUDE.md`, `AGENTS.md`, a skill memory file, project-scoped skills, a project
`.mcp.json` (and optionally `opencode.json`), and a `.gitignore` merge.

```bash
agent-harness scaffold                          # interactive menu

# existing repo — add ONLY the docs + skills:
agent-harness scaffold --with-claude-md --with-agents-md --skill prd --skill impeccable --no-gitignore -y

agent-harness scaffold --all -y                 # everything in the catalog
```

Flags: `--with-claude-md`, `--with-agents-md`, `--with-memory`, `--with-opencode`,
repeatable `--mcp` and `--skill`, `--memory-dest <path>`, `--no-gitignore`,
`--all`, `-y`, `--dry-run`, `--force`.

Project skills install into each applicable agent's repo dir (`.claude/skills/`,
`.agents/skills/`, `.opencode/skills/`; agent-scoped skills like `impeccable` go
only where they apply). Existing files are never clobbered (skipped unless
`--force`); `.gitignore` entries merge under a managed block without duplicating.

---

## What goes where

| | Claude Code | Codex | OpenCode |
|---|---|---|---|
| **User MCP** | `claude mcp add … --scope user` | `~/.codex/config.toml` `[mcp_servers]` | `~/.config/opencode/opencode.json` `mcp` |
| **Project MCP** | `./.mcp.json` (`mcpServers`) | — | `./opencode.json` (`mcp`) |
| **Skills** | `~/.claude/skills/` | `~/.agents/skills/` | `~/.config/opencode/skills/` |
| **Plugins** | `claude plugin …` | — | — |
| **Instructions** | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` |
| **Login** | `claude` (or `/login`) | `codex login` | `opencode auth login` |

Skills are delegated to the [`skills`](https://github.com/vercel-labs/skills) CLI
(`npx skills add`); `"local"` skills are copied straight from `assets/skills/`.
MCP definitions are stored once in a **neutral** shape and translated to each
agent's format — Claude `${VAR}`, Codex `env_vars`, OpenCode `{env:VAR}` for the
secret-free env passthrough.

---

## Requirements

Works on **any machine** — Linux, macOS, or Windows — that has **Node ≥ 20**,
**git** (used to fetch from GitHub), and **internet**.

Even without the agents installed, it still: opens the menu, runs `scaffold`,
writes **Codex** and **OpenCode** MCP configs (plain file merges — no binary
needed), copies local skills, and sets up the repo.

Only **Claude Code's** MCP/plugin steps go through the `claude` binary. If Claude
isn't installed on that machine, those steps **skip with a note** (install Claude
and re-run) — they never error. Recommended order on a new machine: install your
agents first, then run the installer.

---

## The catalog

Everything the menus offer lives in one data-driven file you edit without
touching code (`assets/catalog.json`). MCP entries are transport-neutral.
Annotated excerpt:

```jsonc
{
  "agents": ["claude-code", "codex", "opencode"],
  "mcps": [
    // cross-agent — installed for every selected agent
    { "id": "chrome-devtools", "label": "Chrome DevTools", "transport": "stdio",
      "command": "npx", "args": ["-y", "chrome-devtools-mcp@latest"], "env": [] },
    { "id": "figma", "label": "Figma", "transport": "http",
      "url": "https://mcp.figma.com/mcp", "headers": {}, "env": [] },

    // claude-only — the `agents` allowlist scopes it (omit = all agents)
    { "id": "stitch", "label": "Stitch", "transport": "http",
      "url": "https://stitch.googleapis.com/mcp",
      "headers": { "X-Goog-Api-Key": "${STITCH_API_KEY}" },   // ${VAR} expands at runtime
      "env": ["STITCH_API_KEY"], "agents": ["claude-code"] }   // env = var NAMES only; never stored
  ],
  "skills": [
    { "id": "anti-ai-slop", "source": "local", "skill": "anti-ai-slop" },   // bundled in assets/skills/<id>/
    { "id": "impeccable",   "source": "local", "skill": "impeccable",
      "agents": ["claude-code"] }                                           // skills take `agents` too
  ],
  "plugins": [
    { "id": "claude-official", "agent": "claude-code",
      "marketplace": "anthropics/claude-plugins-official", "name": "claude-plugins-official",
      "install": ["context7", "github", "frontend-design", "playwright"] }
  ],
  "templates": {
    "claude_md": "templates/clean-code-for-agents.md",   // CLAUDE.md and AGENTS.md both
    "agents_md": "templates/clean-code-for-agents.md",   // get the same "Clean Code for Agents" doc
    "memory":    "templates/memory.md"
  },
  "gitignore": [".claude/settings.local.json", ".opencode/cache/", ".agent-harness/"]
}
```

**Field notes**

| Field | Meaning |
|---|---|
| MCP `env` | Names of env vars to remind you about; values are never written. |
| MCP / Skill `agents` | Optional allowlist (e.g. `["claude-code"]`); omit for all agents. |
| Skill `source` | `owner/repo`, a URL, or `"local"` (bundled under `assets/skills/<id>/`). |
| Plugin `name` | Marketplace's declared name, used in `<plugin>@<name>`. |
| `templates` | Both docs point at one file (DRY); written as separate, independently-editable files. |

Override the whole catalog with `AGENT_HARNESS_CATALOG=/path/to/catalog.json`
(handy for an internal/team catalog without forking). The CLI warns when a value
still looks like a `<placeholder>`.

**The shipped catalog** mirrors a real Claude Code setup, so a fresh machine
reproduces it:

- **MCPs** — `figma`, `chrome-devtools` (cross-agent) · `pencil`, `stitch` (Claude only)
- **Skills** — `anti-ai-slop`, `prd` (cross-agent) · `impeccable` (Claude only; Apache-2.0; bundled)
- **Plugins** — 6 Claude marketplaces: `claude-plugins-official`, `n8n-skills`, `openai-codex`, `taskmaster`, `obsidian-skills`, `claude-code-warp`
- **Docs** — `CLAUDE.md` and `AGENTS.md` both write the **Clean Code for Agents** standard

---

## Auth block

At the end of `init` you get a copy-pasteable block listing only the agents/items
you installed:

```
✅ Installed. Run these logins once:
  Claude Code  →  claude            (OAuth on first run, or /login)
  Codex        →  codex login
  OpenCode     →  opencode auth login

  MCPs with OAuth (Notion, Google…) authenticate on first tool use.
  MCPs needing API keys — export in your shell/.env: STITCH_API_KEY
```

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
   ┌─ Nesta máquina ───────────┐   ┌─ Neste repositório ──────────┐
   │ MCP    → mcp.ts            │   │ CLAUDE.md / AGENTS.md / memory │
   │ skill  → skills.ts         │   │ project skills                 │
   │ plugin → plugins.ts        │   │ .mcp.json / opencode.json      │  templates.ts
   └───────────────────────────┘   └────────────────────────────────┘
            │                                   │
            └──── actions.ts: every change is an Action ───┘
                  (atomic write · idempotent · --dry-run previews, writes nothing)
            │
            ▼
   Claude Code  ·  Codex  ·  OpenCode      +      printed login block
```

Source layout: `src/cli.ts` routes to `src/commands/{init,scaffold}.ts`; the
`src/core/*` modules (`catalog`, `agents`, `mcp`, `skills`, `plugins`,
`templates`, `actions`, `fsx`) are small and single-purpose. `assets/` holds the
catalog, bundled skills, and templates.

---

## Distribution

1. **GitHub (primary).** `npx`/`pnpm dlx github:reiquileut/agent-harness`. `dist/`
   is committed and the build runs via `prepack` (publish only) — nothing builds
   at install time, on any npm/pnpm version.
2. **npm (future).** Publish `@r2t/agent-harness` (`publishConfig.access: public`).
3. **`curl | bash` (optional).** `install.sh` forwards to the same entrypoint; a
   redirect (`vercel.json`) can serve it from a custom domain.

---

## License

[MIT](./LICENSE). Bundled skills under `assets/skills/` keep their own licenses —
`impeccable` is Apache-2.0 (declared in its `SKILL.md`).
