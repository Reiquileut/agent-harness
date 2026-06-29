# agent-harness

> **Dotfiles for AI agents + bootstrapper.** One command on a fresh machine:
> pick which agents to configure (Claude Code, Codex, OpenCode) and which catalog
> items to install (MCPs, skills, plugins), and `agent-harness` writes each one
> into the right place for each agent — then prints the login commands you run
> yourself.

Auth is **not** automated. Logins are OAuth/browser flows that differ per agent,
so the tool prepares everything and **prints the exact login block** at the end.

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

**Or clone and build:**

```bash
pnpm install
pnpm build
node dist/cli.js init
```

> Future: a scoped npm package `@r2t/agent-harness` (`pnpm dlx @r2t/agent-harness init`).

Requires **Node ≥ 20**.

---

## The two commands

### `agent-harness init` — machine level

Configures agents globally: user-scope MCP servers, skills, and plugins.

Interactive (default): detects installed agents, lets you multiselect agents +
catalog items, confirms, installs, then prints the auth block.

Non-interactive (CI / scripted):

```bash
agent-harness init \
  --agent claude-code --agent codex \
  --mcp context7 --mcp playwright \
  --skill obsidian-cli \
  --plugin r2t-marketplace \
  -y

agent-harness init --all --agent claude-code   # everything, one agent
agent-harness init --dry-run --all             # show every action, write nothing
```

Flags: repeatable `--agent/-a`, `--mcp`, `--skill`, `--plugin`; plus `--all`,
`-y/--yes`, `--dry-run`, `--force`.

### `agent-harness scaffold` — repo level

Run inside a project. Drops `CLAUDE.md`, `AGENTS.md`, a skill memory file, a
project `.mcp.json` (and optionally `opencode.json`), and merges `.gitignore`.

```bash
agent-harness scaffold                                   # interactive
agent-harness scaffold --with-claude-md --with-agents-md --mcp context7 -y
agent-harness scaffold --all -y                          # all docs + all catalog MCPs
agent-harness scaffold --all --dry-run
```

Flags: `--with-claude-md`, `--with-agents-md`, `--with-memory`, `--with-opencode`,
repeatable `--mcp`, `--memory-dest <path>`, `--no-gitignore`, `--all`, `-y`,
`--dry-run`, `--force`.

Existing files are never clobbered (skipped unless `--force`); `.gitignore`
entries are merged under a managed block without duplicating.

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
(`npx skills add`), which already maps each agent's path. MCP definitions are
stored once in a **neutral** shape and translated to each agent's format.

**Secret-free:** the catalog stores env var *names* only. We never write secret
values — each format gets a passthrough reference to the same-named env var
(Claude `${VAR}`, Codex `env_vars`, OpenCode `{env:VAR}`). Set those vars in your
shell/`.env`.

---

## The catalog (`assets/catalog.json`)

Everything the menus offer lives in one data-driven file you edit without
touching code. MCP entries are transport-neutral:

```jsonc
{
  "agents": ["claude-code", "codex", "opencode"],
  "mcps": [
    { "id": "context7", "label": "Context7", "transport": "http",
      "url": "https://mcp.context7.com/mcp", "headers": {}, "env": [] },
    { "id": "playwright", "label": "Playwright", "transport": "stdio",
      "command": "npx", "args": ["-y", "@playwright/mcp"], "env": [] }
  ],
  "skills":  [ { "id": "obsidian-cli", "source": "kepano/obsidian-skills", "skill": "obsidian-cli" } ],
  "plugins": [ { "id": "r2t-marketplace", "agent": "claude-code",
                 "marketplace": "reiquileut/r2t-marketplace", "name": "r2t-marketplace",
                 "install": ["plugin-a"] } ],
  "templates": { "claude_md": "templates/CLAUDE.md", "agents_md": "templates/AGENTS.md", "memory": "templates/memory.md" },
  "gitignore": [".claude/settings.local.json"]
}
```

- **MCP** `env`: names of env vars to remind you about (values never written).
- **Skill** `source`: `owner/repo`, a URL, or a local dir; `skill` is the name inside it.
- **Plugin** `name`: the marketplace's declared name used in `<plugin>@<name>` (defaults to the repo's last path segment).

The shipped catalog uses obvious placeholders like `<obsidian-mcp-package>` and
`<skills-repo>` — replace them with your real values. The CLI warns when it sees
a placeholder.

Point at a different catalog with `AGENT_HARNESS_CATALOG=/path/to/catalog.json`.

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
  MCPs needing API keys — export in your shell/.env: OBSIDIAN_VAULT_PATH
```

---

## Distribution notes

1. **GitHub (primary):** `pnpm dlx github:reiquileut/agent-harness init`. `dist/`
   is committed so no build runs at install time.
2. **npm (future):** publish `@r2t/agent-harness` (`publishConfig.access: public`).
3. **`curl | bash` (optional):** `install.sh` is a stub; a CDN/redirect
   (`vercel.json`) can serve it from a nice URL.

## License

MIT
