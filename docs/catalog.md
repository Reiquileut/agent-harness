# The catalog

Reference for `assets/catalog.json`: the format, every field, and what ships in it.
Overview and commands: [README](../README.md).

Everything the menus offer lives in `assets/catalog.json`. Annotated excerpt:

```jsonc
{
  "agents": ["claude-code", "codex", "opencode"],
  "mcps": [
    // cross-agent (no `agents` field); `default` = pre-checked in the menu and installed by --defaults
    // { "id": "chrome-devtools", "transport": "stdio", "command": "npx", ..., "default": true }
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
      "name": "claude-plugins-official", "install": ["context7", "github", "frontend-design", "playwright"] },
    // a mod: a marketplace bundled in assets/plugins/, staged into `installPath`, registered by path
    { "id": "mod-savvy", "agents": ["claude-code"], "marketplace": "plugins/agent-harness-mods",
      "name": "agent-harness-mods", "bundled": true, "installPath": "~/.claude/mods", "install": ["savvy"],
      "default": true }
  ],
  "presets": [
    { "id": "claude-settings", "agents": ["claude-code"], "files": [
        { "op": "merge-json", "asset": "presets/claude/settings.json", "dest": "~/.claude/settings.json" },
        { "op": "copy", "asset": "presets/claude/statusline.ts", "dest": "~/.claude/statusline.ts" } ] },
    { "id": "codex-global-instructions", "files": [
        { "op": "managed-block", "asset": "templates/clean-code-for-agents.md", "dest": "~/.codex/AGENTS.md" },
        { "op": "ensure-prefix", "asset": "templates/CLAUDE.global-stub.md", "dest": "~/.claude/CLAUDE.md" } ] }
  ],
  "integrations": [
    { "id": "ai-memory", "bin": "ai-memory", "env": ["AI_MEMORY_SERVER_URL", "AI_MEMORY_AUTH_TOKEN"],
      "requiredEnv": ["AI_MEMORY_SERVER_URL"],
      "perAgent": [{ "cmd": "ai-memory", "args": ["install-mcp", "--client", "{agent}", "--apply"] }],
      "once":     [{ "cmd": "ai-memory", "args": ["install-instructions", "--target", "{{HOME}}/.codex/AGENTS.md"] }] },
    { "id": "twg-skills", "bin": "twg",                 // Atlassian-licensed skills: never bundled
      "once": [{ "cmd": "twg", "args": ["skills", "install", "-y", "--agent", "claude", "--agent", "opencode"] }] }
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
| `default` (every section) | `true` = part of the owner's setup: pre-checked in the menu and installed by `init --defaults`. Omitted = `false`. |
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
| Plugin `bundled` + `installPath` | `marketplace` is a dir under `assets/` (or the overlay's); its files are staged into `installPath` and that path is registered (`claude plugin marketplace add <path>`, or a `directory` source in `settings.json` without the CLI). A staged file you edited is kept unless `--force`. |
| Preset `files[].op` | `merge-json` / `merge-toml` deep-merge (arrays union, asset scalars win); `copy` writes verbatim (`keep` = never overwrite unless `--force`); `ensure-prefix` prepends a line (e.g. an `@import`) only if the file lacks it; `managed-block` keeps the asset between `<!-- BEGIN/END agent-harness:<preset> -->` markers, replacing it in place and leaving the rest of the file alone (a file already holding an unmarked copy is skipped with a note). `{{HOME}}` expands. |
| `templates` | `agents_md` is the full standard; `claude_md` is the stub that imports it. |

Override the whole catalog with `AGENT_HARNESS_CATALOG=/path/to/catalog.json`
(handy for an internal/team catalog without forking). The CLI warns when a value
still looks like a `<placeholder>`.

**The shipped catalog** mirrors a real Claude Code + Codex + OpenCode setup, so a
fresh machine reproduces it. Entries marked ★ are flagged `default` (the setup in daily use,
2026-10-20); everything else is one checkbox away:

- **MCPs** — `chrome-devtools` ★, `figma`, `lottiefiles-creator` (all agents) · `pencil` ★
  (all agents, **Windows only**; `--agent` flag varies per agent) · `playwright` ★, `context7` ★
  (Codex/OpenCode — Claude gets both via the official plugin) · `taskmaster` ★,
  `upstash-context-7-mcp` ★ (Codex) · `stitch` (Claude)
- **Skills** ★ (all) — bundled: `anti-ai-slop`, `prd`, `find-skills`, `shadcn`, `grill-me`,
  `grill-with-docs`, `paperclip-create-agent`, `computer-use`, `orca-cli`, `orchestration` ·
  fetched with a bundled fallback: `archify` · from `mattpocock/skills` (MIT): `grilling`,
  `domain-modeling` (`grill-me` delegates to `grilling`) · via its own installer:
  `impeccable` (`npx impeccable install`, which also wires its design-detector hooks and
  Claude subagents)
- **Agents** ★ (all) — `documentation-auditor` and the Impeccable roles `impeccable-manual-edit-applier`,
  `impeccable-asset-producer`, `impeccable-documenter`, `impeccable-finish-reviewer`
  (Claude `.md` + Codex `.toml`)
- **Plugins** ★ (all) — `claude-official`, `openai-codex`, `taskmaster`, `obsidian-skills`, `typesafe-ai`
  (Claude Code + Codex) · `claude-code-warp` (Claude) · Codex app marketplaces
  `codex-openai-curated`, `codex-openai-bundled` (incl. `code-review`,
  `unified-computer-use`), `codex-openai-primary-runtime` (enable-only)
- **Mods** ★ (Claude Code, bundled marketplace `agent-harness-mods` in `assets/plugins/`) —
  `mod-tool-skins` (per-tool icons and colours, three themes via `/skin`) · `mod-cache-tax` (holds a
  prompt when the cache has expired and shows what re-reading it costs) · `mod-ai-memory-first-read`
  (reads ai-memory on the first message of each session) · `mod-savvy` (`/savvy-flow` splits a
  request into helpers plus a reviewer, with a progress panel)
- **Presets** ★ (all) — `claude-settings` (no pinned model; `effortLevel` xhigh; `modelSettings`:
  opus-5-5 and sonnet-5-5 medium, haiku-5-5 low, opus-5 / fable-5-1 / sonnet-5 high; agent teams,
  auto mode, permissions, voice; status line `statusline.ts` run by Node; a `win32`-only extra adds
  `Bash(powershell:*)`) · `codex-config` (gpt-6.1-sol, `model_reasoning_effort = "low"`,
  `service_tier = "default"`, `features.memories = false`, workspace-write + network; the `[windows]`
  tables are `win32`-only) · `codex-global-instructions` (`~/.codex/AGENTS.md` in a managed block +
  the `~/.claude/CLAUDE.md` import) · `no-ai-attribution` (blanks Claude `attribution`; PreToolUse hook
  that denies `git commit` / `gh pr create|edit` carrying Claude attribution; fails open) ·
  `docker-disk-hygiene` (SessionStart/SubagentStart reminder plus a PreToolUse hook that denies
  `docker rm` without `-v`, `docker volume prune -a`, `docker system prune --volumes` and dev servers
  logging to an unbounded file; fails open)
- **Integrations** ★ (all) — `ai-memory` (plus Codex's SessionStart hook that injects the start-up
  read) · `twg-skills` (Atlassian Teamwork Graph skills through your own `twg` CLI)
- **Docs** — `AGENTS.md` (the **Clean Code for Agents** standard, incl. model routing, cache
  discipline, Docker hygiene and Git workflow) and a `CLAUDE.md` stub that imports it

`computer-use`, `orca-cli`, and `orchestration` need the Orca desktop app on PATH; `requires`
surfaces that in the post-install manifest (see the README).
