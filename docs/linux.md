# Máquina nova no Ubuntu

Runbook para deixar uma máquina Ubuntu pronta com Claude Code, Codex e OpenCode.
O script é idempotente: rodar de novo só completa o que falta.

## Pré-requisitos

- Ubuntu com `sudo`, `curl` e internet (o resto o script instala).
- Para um **overlay privado em git**: acesso ao repositório (ver abaixo).

O `bootstrap/ubuntu.sh` instala: git, curl, jq, python3, make (apt), Node 22
(NodeSource; precisa de >= 22.18), pnpm, gh (repositório apt oficial), uv,
Claude Code (instalador nativo), Codex (`@openai/codex`), OpenCode (`opencode-ai`),
task-master-ai e ai-memory (tarball de release do GitHub + sha256 em
`~/.local/bin`). No fim roda `agent-harness init`; com `--yes` isso significa
`init -y --defaults` nos três agentes, ou seja, o setup marcado como padrão nos
catálogos (a integração ai-memory é pulada com aviso se faltar
`AI_MEMORY_SERVER_URL`, e a do TWG se faltar o CLI `twg`).

## O comando

Sem overlay, direto de uma máquina limpa:

```bash
curl -fsSL https://raw.githubusercontent.com/Reiquileut/agent-harness/main/bootstrap/ubuntu.sh | bash -s -- --yes
```

Clonando antes:

```bash
git clone https://github.com/Reiquileut/agent-harness.git
cd agent-harness && bash bootstrap/ubuntu.sh --yes
```

Com overlay privado em git, a ordem importa: o clone usa as credenciais do `gh`,
que o próprio bootstrap instala. Então, numa máquina zerada:

```bash
bash bootstrap/ubuntu.sh --yes --skip-harness          # 1) só pré-requisitos
gh auth login && gh auth setup-git                     # 2) credenciais git
bash bootstrap/ubuntu.sh --yes --overlay git@github.com:OWNER/REPO-PRIVADO.git   # 3) harness + overlay
```

(O passo 3 pula tudo que já foi instalado. Overlay em pasta local dispensa o passo 2.)

Flags: `--dry-run`, `--yes`, `--overlay <spec>`, `--skip-harness`,
`--harness-src <dir>`, `--report <file>`. Argumentos extras para o `init` vão
depois de `--`, por exemplo `-- --agent claude-code --preset claude-settings`.

## Antes de usar um overlay git privado

O harness faz clone raso com as **suas** credenciais git, numa pasta temporária
sempre apagada. Numa máquina nova, autentique antes:

```bash
gh auth login && gh auth setup-git
```

Specs aceitas: `git@…`, `https://…`, `ssh://`, `file://`, `github:owner/repo` ou
um diretório local. Também dá para usar a variável `AGENT_HARNESS_OVERLAY`
(vários overlays separados por `;`).

## Variáveis de ambiente

Os valores vêm do **seu gerenciador de senhas**; nunca de um repositório. Exporte
no shell (por exemplo em `~/.bashrc`) antes do passo de ai-memory e dos MCPs:

```bash
export AI_MEMORY_SERVER_URL="..."     # obrigatória para a integração ai-memory
export AI_MEMORY_AUTH_TOKEN="..."     # lida pelo próprio ai-memory
export STITCH_API_KEY="..."           # MCP Stitch (Claude)
# + as variáveis listadas pelo overlay (o manifesto e o bloco de login as mostram)
```

Sem `AI_MEMORY_SERVER_URL` a integração avisa e é pulada; exporte e rode de novo.

## Logins

O harness nunca automatiza login. Rode uma vez cada:

- [ ] `claude` (OAuth no primeiro uso, ou `/login`)
- [ ] `codex login`
- [ ] `opencode auth login`
- [ ] `gh auth login`

MCPs com OAuth autenticam no primeiro uso.

## Fase 2: segredos, overlay e ai-memory

O bootstrap instala tudo sem pedir nenhum segredo. Depois, quando quiser, exporte as
variáveis e rode o `init` de novo: ele é idempotente e só acrescenta o que faltava
(o overlay privado e as integrações que esperavam um segredo).

```bash
npx -y github:reiquileut/agent-harness init -y --defaults \
  -a claude-code -a codex -a opencode --overlay github:OWNER/REPO-PRIVADO
ai-memory doctor
```

Sem overlay, tire o `--overlay`. Só o ai-memory:
`init -y --integration ai-memory -a claude-code -a codex -a opencode`.

A integração roda `install-mcp` e `install-hooks` por agente, e uma vez
`install-instructions --target ~/.codex/AGENTS.md`. Também mescla
`autoMemoryEnabled:false` e `autoDreamEnabled:false` nas configurações do Claude e,
no Codex, instala o hook SessionStart da leitura inicial do ai-memory
(`~/.codex/hooks/ai-memory-startup.ts` + entrada em `~/.codex/hooks.json`).

As skills TWG (Atlassian) dependem do CLI `twg`. No Linux o instalador da Atlassian já
faz o login enquanto instala, por isso ele fica para a fase 2:
`curl -fsSL --retry 2 https://teamwork-graph.atlassian.com/cli/install | bash` e depois
`init -y --integration twg-skills -a claude-code -a codex`. No macOS o bootstrap instala o
CLI sem login (ver [docs/macos.md](macos.md)).

## Checklist de verificação

- [ ] `~/.codex/AGENTS.md` existe (padrão Clean Code for Agents).
- [ ] `~/.claude/CLAUDE.md` contém a linha `@~/.codex/AGENTS.md`.
- [ ] `~/.codex/config.toml` existe **sem** as tabelas `[windows]`.
- [ ] `~/.claude/hooks/bloquear-mencao-claude-commit.ts` existe (preset
      `no-ai-attribution`) e o `~/.claude/settings.json` o referencia.
- [ ] `~/.claude/hooks/higiene-docker-disco.ts` existe (preset `docker-disk-hygiene`).
- [ ] `~/.claude/statusline.ts` existe e `node ~/.claude/statusline.ts < /dev/null` não quebra.
- [ ] `~/.claude/mods/.claude-plugin/marketplace.json` existe e `claude plugin list`
      mostra os mods `@agent-harness-mods`.
- [ ] `~/.codex/hooks.json` tem a entrada SessionStart do `ai-memory-startup.ts`.
- [ ] `~/.claude/skills/` e `~/.agents/skills/` têm as skills escolhidas.
- [ ] O bloco `agent-harness` aparece no fim do `AGENTS.md` global (manifesto).
- [ ] `claude --version`, `codex --version`, `opencode --version` respondem.
- [ ] `ai-memory doctor` sem erros.

## Dry-run

```bash
bash bootstrap/ubuntu.sh --dry-run          # mostra os passos do bootstrap
npx -y github:reiquileut/agent-harness init --dry-run --all   # mostra cada ação do init, sem escrever
```

## Problemas comuns

- **Node < 22.18:** os hooks, os mods e a status line rodam TypeScript nativo e
  precisam de >= 22.18. Rode o bootstrap de novo (ele instala Node 22 via NodeSource) e
  confira com `node -v`.
- **`~/.local/bin` fora do PATH:** o ai-memory e o Claude Code ficam lá. Adicione
  `export PATH="$HOME/.local/bin:$PATH"` ao `~/.bashrc` e abra um novo shell.
- **Clone do overlay falha:** rode `gh auth login && gh auth setup-git`, teste o
  acesso com `git ls-remote <url>`. Specs que começam com `-` são rejeitadas, e
  caminhos de asset com `..` ou absolutos também.
- **Pencil ignorado no Linux:** de propósito. O MCP e as tabelas `[windows]` do
  Codex são só `win32` (campo `platforms` do catálogo).
- **Colisão de IDs no overlay:** a entrada do overlay vence, com aviso.
- **Credenciais na saída:** URLs com credenciais são redigidas; mesmo assim, não
  cole logs com tokens em lugar público.

Teste de ponta a ponta: o CI roda este script num contêiner `ubuntu:24.04` limpo
(job `bootstrap-ubuntu`, artefato `artifacts/e2e/bootstrap-ubuntu.json`).
