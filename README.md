<div align="center">

# agent-harness

**Dotfiles for AI agents — bootstrap Claude Code, Codex & OpenCode with one command.**

[![CI](https://github.com/Reiquileut/agent-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/Reiquileut/agent-harness/actions/workflows/ci.yml)
&nbsp;[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
&nbsp;![Node](https://img.shields.io/badge/Node-%E2%89%A5%2020-3c873a)
&nbsp;![Platforms](https://img.shields.io/badge/Linux%20·%20macOS%20·%20Windows-informational)

</div>

On a fresh machine you run **one command**, a menu opens, you pick which agents to
configure and which catalog items to install (MCP servers, skills, plugins, custom
agents, settings presets, repo docs), and `agent-harness` writes each one into the
right place for every agent — then prints the login commands for you to run.

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
- [Post-install manifest](#post-install-manifest)
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
  action and writes nothing. Settings presets deep-merge (arrays union), so a
  permission or a hook is never added twice.
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
│  ◻ Figma   ◻ Chrome DevTools   ◻ Playwright (codex/opencode)   ◻ Context7 (codex/opencode)
│  ◻ Task Master MCP (codex)   ◻ LottieFiles   ◻ n8n-mcp   ◻ Pencil   ◻ Stitch (claude only)
│  ◻ Claude official (context7, github, frontend-design, playwright)   ◻ OpenAI Codex plugin
│  ◻ n8n-mcp skills (claude only)   ◻ Task Master   ◻ Obsidian skills   ◻ Warp (claude only)
│  ◻ Codex curated connectors   ◻ Codex bundled   ◻ Codex runtime
│  ◻ anti-ai-slop · global   ◻ prd · global   ◻ impeccable · global   ◻ find-skills · global
│  ◻ shadcn · global   ◻ grill-me · global   ◻ archify · global   …
│  ◻ Documentation Auditor · global   ◻ Impeccable Manual Edit Applier · global
│  ◻ Claude settings preset   ◻ Codex config preset   ◻ Codex global AGENTS.md
│
│  Neste repositório (my-project)
│  ◻ CLAUDE.md    ◻ AGENTS.md    ◻ Skill memory
│  ◻ anti-ai-slop · repo   ◻ prd · repo   ◻ impeccable · repo   …
│  ◻ Documentation Auditor · repo   ◻ Impeccable Manual Edit Applier · repo
│  ◻ .mcp.json + opencode.json     ◻ Merge .gitignore
└
```

It applies the machine items **and** sets up the repo in one pass, then prints
the login block. Skills appear in both groups: **global** (all your projects) or
**repo** (just this one). So you can run it inside an existing repo and add, say,
only `CLAUDE.md` + `AGENTS.md` + a couple of skills. Custom agents follow the same
global/repo split and apply to **Claude Code** (Markdown) and **Codex** (TOML) —
OpenCode has no equivalent subagent concept.

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
`--preset`; plus `--all`, `--no-manifest`, `-y/--yes`, `--dry-run`, `--force`.

### `scaffold` — repo level

Run inside any project (new or existing) to add **just the pieces you pick**:
`CLAUDE.md`, `AGENTS.md`, a skill memory file, project-scoped skills, project-scoped
custom agents, a project `.mcp.json` (and optionally `opencode.json`), and a
`.gitignore` merge.

```bash
agent-harness scaffold                          # interactive menu

# existing repo — add ONLY the docs + skills:
agent-harness scaffold --with-claude-md --with-agents-md --skill prd --skill impeccable --no-gitignore -y

agent-harness scaffold --all -y                 # everything in the catalog
```

Flags: `--with-claude-md`, `--with-agents-md`, `--with-memory`, `--with-opencode`,
repeatable `--mcp`, `--skill`, and `--subagent`, `--memory-dest <path>`,
`--no-gitignore`, `--all`, `-y`, `--dry-run`, `--force`.

Project skills install into each applicable agent's repo dir (`.claude/skills/`,
`.agents/skills/`, `.opencode/skills/`; agent-scoped skills go only where they
apply). Existing files are never clobbered (skipped unless `--force`);
`.gitignore` entries merge under a managed block without duplicating. Bundled
skill assets that are binary (images, fonts, archives) are copied byte-for-byte,
never re-encoded.

---

## What goes where

| | Claude Code | Codex | OpenCode |
|---|---|---|---|
| **User MCP** | `claude mcp add … --scope user` | `~/.codex/config.toml` `[mcp_servers]` | `~/.config/opencode/opencode.json` `mcp` |
| **Project MCP** | `./.mcp.json` (`mcpServers`) | — | `./opencode.json` (`mcp`) |
| **Skills** | `~/.claude/skills/` | `~/.agents/skills/` | `~/.config/opencode/skills/` |
| **Plugins** | `claude plugin …` | `~/.codex/config.toml` `[marketplaces]` + `[plugins]` | — |
| **Custom agents** | `~/.claude/agents/*.md` (user) · `.claude/agents/` (project) | `~/.codex/agents/*.toml` (user) · `.codex/agents/` (project) | — |
| **Presets** | `~/.claude/settings.json` (merge) · status-line scripts | `~/.codex/config.toml` (merge) · `~/.codex/AGENTS.md` | — |
| **Manifest** | `~/.claude/CLAUDE.md` (managed block) | `~/.codex/AGENTS.md` (managed block) | `~/.config/opencode/AGENTS.md` |
| **Instructions** | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` |
| **Login** | `claude` (or `/login`) | `codex login` | `opencode auth login` |

Skills are delegated to the [`skills`](https://github.com/vercel-labs/skills) CLI
(`npx skills add`), falling back to the bundled copy when the fetch fails;
`"local"` skills are copied straight from `assets/skills/`; skills with their own
installer (Impeccable → `npx impeccable install`) run that once with every
selected agent's provider name. MCP definitions are stored once in a **neutral**
shape and translated to each agent's format — Claude `${VAR}`, Codex `env_vars`,
OpenCode `{env:VAR}` for the secret-free env passthrough; the per-agent
`overrides` field covers servers whose launch differs per agent (Pencil's `--agent`
flag) or need agent-native keys (Codex `startup_timeout_sec`, per-tool
`approval_mode`). Custom agents have no equivalent installer CLI, so they're
copied straight from `assets/agents/<file>` — Markdown for Claude Code, TOML for
Codex.

---

## Requirements

Works on **any machine** — Linux, macOS, or Windows — that has **Node ≥ 20**,
**git** (used to fetch from GitHub), and **internet**.

Even without the agents installed, it still: opens the menu, runs `scaffold`,
writes **Codex** and **OpenCode** MCP/plugin configs (plain file merges — no
binary needed), copies local skills, applies presets, and sets up the repo.

Only **Claude Code's** MCP/plugin steps go through the `claude` binary. If Claude
isn't installed on that machine, MCPs **skip with a note** (install Claude and
re-run) and plugins fall back to a `settings.json` merge — they never error.
Recommended order on a new machine: install your agents first, then run the
installer.

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

    // one entry, per-agent launch differences via `overrides`
    { "id": "pencil", "label": "Pencil", "transport": "stdio",
      "command": "C:\\Program Files\\Pencil\\...\\mcp-server-windows-x64.exe",
      "args": ["--app", "desktop", "--agent", "claudeCodeCLI"],
      "overrides": { "codex":    { "args": ["--app", "desktop", "--agent", "codexCLI"] },
                     "opencode": { "args": ["--app", "desktop", "--agent", "openCodeCLI"] } } },

    // agent-native extras (Codex only here) — merged verbatim into that agent's entry
    { "id": "taskmaster", "transport": "stdio", "command": "npx",
      "args": ["-y", "--package=task-master-ai", "task-master-mcp"], "agents": ["codex"],
      "overrides": { "codex": { "extra": { "startup_timeout_sec": 120,
                     "tools": { "set_task_status": { "approval_mode": "approve" } } } } } },

    // claude-only — the `agents` allowlist scopes it (omit = all agents)
    { "id": "stitch", "transport": "http", "url": "https://stitch.googleapis.com/mcp",
      "headers": { "X-Goog-Api-Key": "${STITCH_API_KEY}" },   // ${VAR} expands at runtime
      "env": ["STITCH_API_KEY"], "agents": ["claude-code"] }   // env = var NAMES only; never stored
  ],
  "skills": [
    { "id": "anti-ai-slop", "source": "local", "skill": "anti-ai-slop" },   // bundled in assets/skills/<id>/
    { "id": "archify", "source": "tt-a1i/archify", "skill": "archify",      // `npx skills add`, bundled fallback
      "requires": ["Node >= 18"] },                                          // surfaced in the manifest
    { "id": "impeccable", "source": "npm:impeccable", "skill": "impeccable",  // own installer CLI
      "installer": { "cmd": "npx",
        "args": ["--yes", "impeccable@latest", "install", "--scope={scope}", "--providers={provider}", "-y"],
        "providers": { "claude-code": "claude", "codex": "codex" } } }         // agents not listed skip
  ],
  "subagents": [
    { "id": "documentation-auditor", "label": "Documentation Auditor",
      "file": "documentation-auditor.md",          // Claude Code variant (assets/agents/)
      "codex_file": "documentation-auditor.toml" } // Codex variant — omit to skip Codex
  ],
  "plugins": [
    { "id": "claude-official",                     // omit `agents` = Claude Code AND Codex
      "marketplace": "anthropics/claude-plugins-official", "name": "claude-plugins-official",
      "install": ["context7", "github", "frontend-design", "playwright"] },
    { "id": "codex-openai-curated", "agents": ["codex"], "builtin": true,   // app-registered marketplace:
      "name": "openai-curated", "install": ["github", "gmail", "notion"] }  // only [plugins.*] enable tables
  ],
  "presets": [
    { "id": "claude-settings", "agents": ["claude-code"], "files": [
        { "op": "merge-json", "asset": "presets/claude/settings.json", "dest": "~/.claude/settings.json" },
        { "op": "copy", "asset": "presets/claude/statusline-command.sh", "dest": "~/.claude/statusline-command.sh" } ] },
    { "id": "codex-config", "agents": ["codex"], "files": [
        { "op": "merge-toml", "asset": "presets/codex/config.toml", "dest": "~/.codex/config.toml" } ] },
    { "id": "codex-global-instructions", "agents": ["codex"], "files": [
        { "op": "copy", "asset": "templates/clean-code-for-agents.md", "dest": "~/.codex/AGENTS.md", "keep": true } ] }
  ],
  "templates": {
    "claude_md": "templates/clean-code-for-agents.md",   // CLAUDE.md and AGENTS.md both
    "agents_md": "templates/clean-code-for-agents.md",   // get the same "Clean Code for Agents" doc
    "memory":    "templates/memory.md"
  },
  "gitignore": [".claude/settings.local.json", ".codex/hooks.json", ".impeccable/config.local.json", ".opencode/cache/", ".agent-harness/"]
}
```

**Field notes**

| Field | Meaning |
|---|---|
| MCP `env` | Names of env vars to remind you about; values are never written. |
| MCP `overrides.<agent>` | `command` / `args` replace the neutral ones for that agent; `extra` keys merge verbatim into that agent's entry. |
| MCP / Skill / Plugin / Preset `agents` | Optional allowlist (e.g. `["claude-code"]`); omit for all agents. |
| Skill `source` | `owner/repo`, a URL, or `"local"` (bundled under `assets/skills/<id>/`). A remote source falls back to the bundled copy when the fetch fails; informational when `installer` is set. |
| Skill `requires` | Prerequisites the installer can't provide (a binary, a runtime); listed in the post-install manifest. |
| Skill `installer` | `cmd` + `args` run once per scope; `{provider}` = comma-joined provider names of the selected agents (from `providers`), `{scope}` = `global` / `project`. |
| Subagent `file` / `codex_file` | Filenames inside `assets/agents/`, copied verbatim — Markdown for Claude Code, TOML for Codex. |
| Plugin `name` | Marketplace's declared name, used in `<plugin>@<name>`. |
| Plugin `builtin` | The agent app registers the marketplace itself (Codex `openai-*`); only the enable tables are written. |
| Preset `files[].op` | `merge-json` / `merge-toml` deep-merge (arrays union, asset scalars win); `copy` writes verbatim (`keep` = never overwrite unless `--force`). `{{HOME}}` expands. |
| `templates` | Both docs point at one file (DRY); written as separate, independently-editable files. |

Override the whole catalog with `AGENT_HARNESS_CATALOG=/path/to/catalog.json`
(handy for an internal/team catalog without forking). The CLI warns when a value
still looks like a `<placeholder>`.

**The shipped catalog** mirrors a real Claude Code + Codex + OpenCode setup, so a
fresh machine reproduces it:

- **MCPs** — `figma`, `chrome-devtools`, `lottiefiles-creator`, `n8n-mcp`, `pencil` (all
  agents; Pencil's `--agent` flag varies per agent) · `playwright`, `context7` (Codex/OpenCode —
  Claude gets both via the official plugin) · `taskmaster`, `upstash-context-7-mcp` (Codex) ·
  `stitch` (Claude)
- **Skills** — bundled: `anti-ai-slop`, `prd`, `find-skills`, `shadcn`, `grill-me`,
  `grill-with-docs`, `paperclip-create-agent`, `gestao-crise-atalaia`, `paper-diario-atalaia`,
  `computer-use`, `orca-cli`, `orchestration` · fetched with a
  bundled fallback: `archify` · via its own installer: `impeccable` (`npx impeccable install`,
  which also wires its design-detector hooks and Claude subagents)
- **Agents** — `documentation-auditor`, `impeccable-manual-edit-applier` (Claude `.md` + Codex `.toml`)
- **Plugins** — `claude-plugins-official`, `openai-codex`, `taskmaster`, `obsidian-skills`
  (Claude Code + Codex) · `n8n-skills`, `claude-code-warp` (Claude) · Codex app marketplaces
  `openai-curated`, `openai-bundled`, `openai-primary-runtime` (enable-only)
- **Presets** — Claude `settings.json` (Fable 5.1 `[1m]`, xhigh effort, always-thinking, agent
  teams, auto mode, permissions, voice, status line + its two scripts) · Codex `config.toml`
  (gpt-6-astra, xhigh, pragmatic, on-request approvals, workspace-write + network, multi-agent,
  memories) · Codex global `AGENTS.md`
- **Docs** — `CLAUDE.md` and `AGENTS.md` both write the **Clean Code for Agents** standard

`computer-use`, `orca-cli`, and `orchestration` need the Orca desktop app on PATH —
`requires` surfaces that in the manifest (below) instead of letting the agent
discover it by failing.

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
  MCPs needing API keys — export in your shell/.env: STITCH_API_KEY, N8N_API_URL, N8N_API_KEY
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
## Provisioned by agent-harness v1.4.0

This environment was set up by `agent-harness init`. Available to Codex:

**Skills** (`~/.agents/skills`) — anti-ai-slop, archify, computer-use, …
**MCPs** — chrome-devtools, context7, figma, n8n-mcp, pencil, playwright, taskmaster
**Subagents** (`~/.codex/agents`) — documentation-auditor, …
**Plugins** — claude-official, codex-openai-curated, openai-codex, …
**Presets** — codex-config, codex-global-instructions

**Prerequisites the installer doesn't provide:**
- Node >= 18 — archify
- Orca desktop app (`orca` on PATH) — computer-use, orca-cli, orchestration
- Env vars — N8N_API_URL, N8N_API_KEY
<!-- END agent-harness -->
```

Only the marked block is owned by the tool — anything you write around it survives
(presets run first, so a global `AGENTS.md` template lands before the block is
appended), and re-running `init` replaces the block in place rather than appending
a second one. Opt out with `--no-manifest`.

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
   │ preset → presets.ts        │   │ CLAUDE.md / AGENTS.md / memory │
   │ MCP    → mcp.ts            │   │ project skills                 │
   │ skill  → skills.ts         │   │ project custom agents          │
   │ plugin → plugins.ts        │   │ .mcp.json / opencode.json      │  templates.ts
   │ agent  → subagents.ts      │   │ .gitignore                     │
   │ manifest → manifest.ts     │   │                                │
   └───────────────────────────┘   └────────────────────────────────┘
            │                                   │
            └──── actions.ts: every change is an Action ───┘
                  (atomic write · idempotent · --dry-run previews, writes nothing)
            │
            ▼
   Claude Code  ·  Codex  ·  OpenCode      +      printed login block
```

Source layout: `src/cli.ts` routes to `src/commands/{init,scaffold}.ts`; the
`src/core/*` modules (`catalog`, `agents`, `mcp`, `skills`, `subagents`, `plugins`,
`presets`, `manifest`, `templates`, `actions`, `fsx`) are small and single-purpose.
`assets/` holds the catalog, bundled skills, bundled custom agents, presets, and
templates.

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

[MIT](./LICENSE). Bundled skills under `assets/skills/` keep their own licenses
(`archify` is MIT); `impeccable` (Apache-2.0) is installed from npm at run time
rather than bundled.
