# Mac novo (ou desatualizado)

Runbook para deixar um Mac (Apple Silicon ou Intel) com Claude Code, Codex e OpenCode no
mesmo setup das outras máquinas. São duas fases: a primeira instala **tudo sem pedir nenhum
segredo**; a segunda, quando você quiser, faz os logins e liga o que depende de token.
O script é idempotente: rodar de novo só completa o que falta.

## Pré-requisito: Homebrew

O bootstrap usa o Homebrew e não o instala sozinho, porque o instalador pede a senha do Mac
e pode abrir a janela das ferramentas do Xcode. Se ainda não tiver:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Siga as linhas que ele imprime no fim (o `brew shellenv` no `~/.zprofile`) e abra um
terminal novo. Se o Homebrew já existe mas não está no PATH, o bootstrap o encontra em
`/opt/homebrew` ou `/usr/local` sozinho.

## Fase 1: um comando, sem segredos

Com o menu interativo no fim, já com o seu setup marcado (espaço alterna, Enter instala):

```bash
curl -fsSL https://raw.githubusercontent.com/Reiquileut/agent-harness/main/bootstrap/macos.sh | bash
```

Ou sem perguntar nada, instalando direto o seu setup padrão:

```bash
curl -fsSL https://raw.githubusercontent.com/Reiquileut/agent-harness/main/bootstrap/macos.sh | bash -s -- --yes
```

Ele instala o que faltar:
- pelo Homebrew: git, jq, Node (>= 22.18), gh e uv;
- pelo npm global, sem sudo: pnpm 10, Codex, OpenCode e task-master;
- Claude Code pelo instalador nativo;
- ai-memory pelo release oficial, com sha256 conferido pelo `shasum`;
- o CLI do TWG pelo pacote silencioso da Atlassian, sem login.

Depois roda o `agent-harness init`: sem `--yes`, abre o menu; com `--yes`, instala direto
(`init -y --defaults` nos três agentes). Os dois dão o seu setup padrão: MCPs, skills, agentes,
plugins, os mods do Claude Code, presets, hooks, status line e as skills TWG. O menu aparece
mesmo pelo `curl | bash`, porque o bootstrap entrega o terminal para ele; sem terminal (CI,
cron), ele avisa e você usa o `--yes`.

O ai-memory é pulado com aviso enquanto faltar `AI_MEMORY_SERVER_URL`. Os MCPs que precisam
de token entram com o nome da variável e passam a funcionar quando você exportar o valor.

Flags: `--dry-run`, `--yes`, `--overlay <spec>`, `--skip-harness`, `--harness-src <dir>`,
`--report <file>`. Argumentos extras para o `init` vão depois de `--`. Roda no bash 3.2 que
vem com o macOS.

## Fase 2: logins e segredos

Os valores vêm do **seu gerenciador de senhas**, nunca de um repositório. Ponha os `export`
no `~/.zprofile` (ou exporte no shell atual):

```bash
claude                                  # login do Claude Code
codex login
opencode auth login
gh auth login && gh auth setup-git      # também deixa o --overlay clonar o repo privado
twg setup                               # login da Atlassian (o CLI e as skills já estão lá)
export AI_MEMORY_SERVER_URL="..."       # o servidor ai-memory certo
export AI_MEMORY_AUTH_TOKEN="..."       # o token dele
# + os tokens que o overlay nomeia (o manifesto e o bloco de login listam)
```

Então o mesmo `init`, agora com o overlay. Ele é idempotente: só acrescenta o overlay e as
integrações que esperavam um segredo.

```bash
npx -y github:reiquileut/agent-harness init -y --defaults \
  -a claude-code -a codex -a opencode --overlay github:OWNER/REPO-PRIVADO
ai-memory doctor
```

## Checklist de verificação

- [ ] `claude --version`, `codex --version`, `opencode --version`, `twg --version` respondem.
- [ ] `~/.codex/AGENTS.md` tem o bloco `agent-harness:codex-global-instructions` (as regras).
- [ ] `~/.claude/CLAUDE.md` começa com `@~/.codex/AGENTS.md`.
- [ ] `~/.claude/mods/.claude-plugin/marketplace.json` existe e `claude plugin list` mostra os
      mods `@agent-harness-mods`.
- [ ] `echo '{}' | node ~/.claude/statusline.ts` imprime a linha de status.
- [ ] `~/.claude/hooks/higiene-docker-disco.ts` e `bloquear-mencao-claude-commit.ts` existem.
- [ ] Depois da fase 2: `ai-memory doctor` sem erros e `~/.codex/hooks.json` com o
      `ai-memory-startup.ts`.

## Dry-run

```bash
curl -fsSL https://raw.githubusercontent.com/Reiquileut/agent-harness/main/bootstrap/macos.sh | bash -s -- --dry-run --yes
```

Mostra cada passo e o `init` que rodaria, sem instalar nada.

## Problemas comuns

- **`Homebrew not found`:** instale o Homebrew (acima), abra um terminal novo e rode de novo.
- **Node antigo no PATH (nvm, versão velha):** o passo `nodejs` falha mesmo depois do
  `brew install node`, porque o node antigo vem antes no PATH. Ajuste o PATH (ou `nvm use 22`)
  e rode de novo.
- **`~/.local/bin` fora do PATH:** Claude Code, ai-memory e twg ficam lá. Adicione
  `export PATH="$HOME/.local/bin:$PATH"` ao `~/.zprofile` e abra um terminal novo.
- **Pencil ignorado:** de propósito. O MCP e as tabelas `[windows]` do Codex são só Windows.

Teste de ponta a ponta: o CI roda este script de verdade num runner macOS (job
`bootstrap-macos`, artefato `artifacts/e2e/bootstrap-macos.json`). A suíte
`scripts/e2e/72-bootstrap-macos.sh` cobre o dry-run e as recusas em qualquer SO.
