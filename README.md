# agent-harness

[![CI](https://github.com/Reiquileut/agent-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/Reiquileut/agent-harness/actions/workflows/ci.yml)

> **Dotfiles for AI agents + bootstrapper.** One command on a fresh machine:
> pick which agents to configure (Claude Code, Codex, OpenCode) and which catalog
> items to install (MCPs, skills, plugins), and `agent-harness` writes each one
> into the right place for each agent — then prints the login commands you run
> yourself.

Auth is **not** automated. Logins are OAuth/browser flows that differ per agent,
so the tool prepares everything and **prints the exact login block** at the end.

## Architecture

```
              assets/catalog.json   ← one neutral, data-driven file you edit
                       │             (core/catalog.ts: load + zod-validate)
                       ▼
        ┌──────────────────────────────┐
        │  init (machine)  ·  scaffold (repo)   │  src/cli.ts (commander; init is default)
        └──────────────────────────────┘
                       │ detect installed agents (core/agents.ts)
                       ▼
   neutral MCP  ─► translate per agent (core/mcp.ts) ─► claude CLI / TOML / JSON merge
   skill        ─► npx skills  ·  local copy (core/skills.ts)
   plugin       ─► claude marketplace + install (core/plugins.ts)
   template     ─► copy + .gitignore merge (core/templates.ts)
                       │ every change is an Action, applied atomically (core/actions.ts)
                       ▼ --dry-run previews and writes nothing · re-runs are idempotent
   Claude Code              Codex                  OpenCode
   ~/.claude.json (MCP)     ~/.codex/config.toml   ~/.config/opencode/opencode.json
   ~/.claude/skills         ~/.agents/skills       ~/.config/opencode/skills
                       │
                       ▼
              prints the manual login block (auth is never automated)
```

---

## Install & run

**Run straight from GitHub (no install, no clone) — from any machine with Node ≥ 20:**

```bash
# npm / npx (npx ships with Node)
npx github:reiquileut/agent-harness            # opens the installer (init)
npx github:reiquileut/agent-harness scaffold

# pnpm
pnpm dlx github:reiquileut/agent-harness       # opens the installer (init)
pnpm dlx github:reiquileut/agent-harness scaffold
```

`init` is the **default command**, so the bare command opens the interactive menu.
The repo ships a **committed, prebuilt `dist/`**, so nothing builds at install time —
it works regardless of your npm/pnpm version.

**Or clone and develop:**

```bash
pnpm install
pnpm build          # tsup → dist/cli.js   (also: pnpm typecheck)
node dist/cli.js init
```

> Future: a scoped npm package `@r2t/agent-harness` (`pnpm dlx @r2t/agent-harness`).

---

## The two commands

### `agent-harness init` — machine level

Configures agents globally: user-scope MCP servers, skills, and plugins, then
prints the auth block.

Interactive (default): detects installed agents, lets you multiselect agents +
catalog items, confirms, installs.

Non-interactive (CI / scripted):

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

### `agent-harness scaffold` — repo level

Run inside a project. Drops `CLAUDE.md`, `AGENTS.md`, a skill memory file, a
project `.mcp.json` (and optionally `opencode.json`), and merges `.gitignore`.

```bash
agent-harness scaffold                                          # interactive
agent-harness scaffold --with-claude-md --with-agents-md --mcp figma -y
agent-harness scaffold --all -y                                 # all docs + all catalog MCPs
agent-harness scaffold --all --dry-run
```

Flags: `--with-claude-md`, `--with-agents-md`, `--with-memory`, `--with-opencode`,
repeatable `--mcp`, `--memory-dest <path>`, `--no-gitignore`, `--all`, `-y`,
`--dry-run`, `--force`.

Existing files are never clobbered (skipped unless `--force`); `.gitignore`
entries merge under a managed block without duplicating. Claude-only MCPs (see
`agents` below) land in `.mcp.json` but not `opencode.json`.

---

## What goes where (per agent)

| | Claude Code | Codex | OpenCode |
|---|---|---|---|
| **User MCP** | `claude mcp add … --scope user` | merge `~/.codex/config.toml` `[mcp_servers]` | merge `~/.config/opencode/opencode.json` `mcp` |
| **Project MCP** | `./.mcp.json` (`mcpServers`) | — | `./opencode.json` (`mcp`) |
| **Skills** | via `npx skills` → `~/.claude/skills/` | `~/.agents/skills/` | `~/.config/opencode/skills/` |
| **Plugins** | `claude plugin …` | — | — |
| **Instructions** | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` |
| **Login** | `claude` (or `/login`) | `codex login` | `opencode auth login` |

Skills are delegated to the [`skills`](https://github.com/vercel-labs/skills) CLI
(`npx skills add`), which maps each agent's path; `"local"` skills are copied
directly from `assets/skills/`. MCP definitions are stored once in a **neutral**
shape and translated to each agent's format.

**Secret-free:** the catalog stores env var *names* only. Secret values are never
written — each format gets a passthrough reference to the same-named env var
(Claude `${VAR}`, Codex `env_vars`, OpenCode `{env:VAR}`). Set those vars in your
shell/`.env`.

---

## The catalog (`assets/catalog.json`)

Everything the menus offer lives in one data-driven file you edit without
touching code. MCP entries are transport-neutral. Annotated excerpt:

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
    "claude_md": "templates/clean-code-for-agents.md",   // both CLAUDE.md and AGENTS.md
    "agents_md": "templates/clean-code-for-agents.md",   // write the SAME "Clean Code for Agents" doc
    "memory":    "templates/memory.md"
  },
  "gitignore": [".claude/settings.local.json", ".opencode/cache/", ".agent-harness/"]
}
```

Field notes:
- **MCP** `env` — names of env vars to remind you about; values are never written.
- **MCP / Skill** `agents` — optional allowlist (e.g. `["claude-code"]`); omit for all agents.
- **Skill** `source` — `owner/repo`, a URL, or `"local"` (bundled under `assets/skills/<id>/`).
- **Plugin** `name` — the marketplace's declared name used in `<plugin>@<name>` (defaults to the repo's last path segment).
- **templates** — point both docs at one file (DRY); they're written as separate `CLAUDE.md`/`AGENTS.md` you can then edit independently.

Override the whole catalog with `AGENT_HARNESS_CATALOG=/path/to/catalog.json`
(handy for an internal/team catalog without forking). The CLI warns when a value
still looks like a `<placeholder>`.

### What the shipped catalog contains

It mirrors a real Claude Code setup, so a fresh machine reproduces it:

- **MCPs** — `figma`, `chrome-devtools` (cross-agent) · `pencil`, `stitch` (Claude only).
- **Skills** — `anti-ai-slop`, `prd` (cross-agent) · `impeccable` (Claude only; **Apache-2.0**; bundled).
- **Plugins** — 6 Claude marketplaces: `claude-plugins-official`, `n8n-skills`, `openai-codex`, `taskmaster`, `obsidian-skills`, `claude-code-warp`.
- **Docs** — `CLAUDE.md` and `AGENTS.md` both write the **Clean Code for Agents** standard (`assets/templates/clean-code-for-agents.md`).

---

## Auth (printed, not automated)

At the end of `init` you get a copy-pasteable block listing only the agents/items
you installed, e.g.:

```
✅ Installed. Run these logins once:
  Claude Code  →  claude            (OAuth on first run, or /login)
  Codex        →  codex login
  OpenCode     →  opencode auth login

  MCPs with OAuth (Notion, Google…) authenticate on first tool use.
  MCPs needing API keys — export in your shell/.env: STITCH_API_KEY
```

---

## Distribution

1. **GitHub (primary):** `npx github:reiquileut/agent-harness` /
   `pnpm dlx github:reiquileut/agent-harness`. `dist/` is committed and the build
   runs via `prepack` (publish only), so **nothing builds at install time**.
2. **npm (future):** publish `@r2t/agent-harness` (`publishConfig.access: public`).
3. **`curl | bash` (optional):** `install.sh` forwards to the same entrypoint; a
   CDN/redirect (`vercel.json`) can serve it from a nice URL.

## License

MIT — see [`LICENSE`](./LICENSE). Bundled skills under `assets/skills/` keep their
own licenses; `impeccable` is Apache-2.0 (declared in its `SKILL.md`).
