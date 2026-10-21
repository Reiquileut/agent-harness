# Como trabalhamos

Convenções que o `agent-harness` instala e assume. Tudo aqui é genérico; o que é
ligado às suas contas ou clientes fica num overlay privado (ver o fim).

## Instruções: AGENTS.md é o canônico

- Claude Code **não lê `AGENTS.md` quando existe `CLAUDE.md`**. Por isso o arquivo
  real é sempre `AGENTS.md` e o `CLAUDE.md` é um stub com `@AGENTS.md` mais um
  comentário HTML explicando por quê.
- **Global:** o preset `codex-global-instructions` grava o template em
  `~/.codex/AGENTS.md` dentro de um bloco gerenciado
  (`<!-- BEGIN/END agent-harness:codex-global-instructions -->`, op `managed-block`):
  rodar de novo atualiza só o bloco e preserva o resto do arquivo (o manifesto e o
  bloco do ai-memory convivem com ele). Um arquivo que já tem uma cópia sem marcação
  é pulado com aviso; apague a cópia para o harness passar a gerenciá-la. Também
  garante `@~/.codex/AGENTS.md` em `~/.claude/CLAUDE.md` (op `ensure-prefix`: só
  prepende o import se faltar).
- **Por repositório:** `agent-harness scaffold` escreve o template completo em
  `AGENTS.md` e o stub em `CLAUDE.md`. `--with-claude-md` implica `AGENTS.md`.
- Edite sempre o `AGENTS.md`; o `CLAUDE.md` não precisa de manutenção.

## Padrão Clean Code for Agents

O template carrega o padrão. Destaques:

- **Funções pequenas** (4–20 linhas), arquivos < 500 linhas, uma responsabilidade
  por módulo, nomes únicos e fáceis de dar grep, tipos explícitos, no máximo 2
  níveis de indentação, erros com o valor ofensor.
- **E2E primeiro.** Liste como a unidade pode falhar *antes* de escrever o código;
  nunca escreva o teste depois do código que ele cobre. Todo E2E termina num
  artefato repetível (JUnit/JSON em caminho fixo) e passa ou falha pelo artefato,
  não por leitura humana. Um único comando roda tudo.
- **Context7 antes de qualquer API de terceiros:** instalar/atualizar dependência,
  chamada não trivial, função de que você não tem certeza. Citar a versão no código.
- **Comentários explicam o porquê** e a procedência (issue, commit); nunca apague
  comentário de iteração anterior.

## Roteamento de modelos e cache

- O orquestrador (Opus 5.5 no dia a dia; Fable 5.1 só para jobs longos,
  assíncronos ou de alto risco) planeja, decide, integra e revisa.
- Execução vai para subagentes mais baratos via `Agent` com `model`:
  **Sonnet 5.5** para tarefas bem definidas com critério claro; **Haiku 5.5**
  para volume, mecânico e latência. Escale um nível se a revisão reprovar.
- Dinheiro, auth, segurança e exclusão de dados ficam no orquestrador.
- **Cache discipline:** o cache do subagente dura 5 min. Subagente é de um tiro só
  (um briefing completo, um resultado). Nunca retome com `SendMessage` um agente
  ocioso há mais de 4 min; abra um novo com briefing compacto. Comandos longos
  (> 3 min) rodam no orquestrador, em background.

## Máquina nova, mesmo setup

- Cada entrada do catálogo (e do overlay) tem `default`. As marcadas formam o setup
  do dia a dia: o menu já abre com elas marcadas (Enter instala) e
  `init -y --defaults` instala só elas, mais o que as flags de item somarem.
- `-y` sem `--defaults` continua instalando só o que as flags pedem (como na v1.6).
- Ao adotar algo novo numa máquina, traga para o catálogo com `default: true`; o que
  for arriscado (MCP que escreve numa conta paga) fica sem a marca.

## Hooks globais, mods e status line

- **Higiene de disco/Docker** (preset `docker-disk-hygiene`, Claude Code): no
  SessionStart/SubagentStart injeta a regra curta; no PreToolUse nega `docker rm`
  sem `-v`, `docker volume prune -a`, `docker system prune --volumes` e processo
  longo com saída redirecionada para arquivo sem limite. Falha aberto.
- **Leitura inicial do ai-memory no Codex** (vem com a integração `ai-memory`): hook
  SessionStart em `~/.codex/hooks.json` que injeta as instruções de
  `~/.codex/hooks/ai-memory-startup.txt`. No Claude Code o mesmo papel é do mod
  `ai-memory-first-read`.
- **Mods do Claude Code** (`mod-*`): marketplace local `agent-harness-mods`, copiado
  para `~/.claude/mods` e registrado pelo caminho. Um arquivo editado lá é mantido
  numa nova execução; `--force` restaura o original do repositório.
- **Status line:** `~/.claude/statusline.ts`, rodada com `node` (sem bash nem
  python, então funciona igual no macOS, no Linux e no Windows).
- Hooks, mods e status line são TypeScript rodado direto pelo Node: precisam de
  Node >= 22.18.

## ai-memory por repositório

- `agent-harness scaffold --with-ai-memory --ai-memory-workspace <ws>
  [--ai-memory-project <p>]` grava `.ai-memory.toml` com workspace/projeto e
  `[capture] ignore_paths`.
- **Cada glob aparece duas vezes: sem prefixo e com `**/`.** O `**/` do ai-memory
  não casa zero diretórios, então `node_modules/**` sozinho não pega a raiz e
  `**/node_modules/**` sozinho não pega o nível zero.
- As memórias nativas ficam **desligadas** (`autoMemoryEnabled:false`,
  `autoDreamEnabled:false` no Claude) para existir uma só fonte de memória.
- Instalação por máquina: integração `ai-memory` (ver [docs/linux.md](linux.md)).
  O token vem do ambiente (`AI_MEMORY_AUTH_TOKEN`); o harness nunca o guarda.

## Git

- **Conventional Commits com escopo em PT-BR:** `feat(auth): valida token expirado`.
- **Sem atribuição de IA.** Preset `no-ai-attribution`: zera `attribution` do
  Claude (commit/PR/sessionUrl) e instala um hook PreToolUse
  (`~/.claude/hooks/bloquear-mencao-claude-commit.ts`, roda com `node` >= 22.18)
  que nega `git commit` e `gh pr create|edit` com menção ao Claude. Falha aberto.
- **Nunca `push` sem ser pedido.** Commit e push são ações explícitas.
- **Sem squash merge.** Preserve o histórico.
- **Branch primeiro:** nada de commit direto na branch principal.

## .gitignore por repositório

O `scaffold` mescla um bloco gerenciado (sem duplicar) com: `.claude/settings.local.json`,
`.claude/launch.json`, `.claude/scheduled_tasks.lock`, `.claude/worktrees/`,
`.codex/hooks.json`, `.env`, `.env.*` (com `!.env.example`), `test-results/`,
`.impeccable/config.local.json`, `.impeccable/review/`, `.impeccable/mocks/`,
`.opencode/cache/`, `.agent-harness/`. Use `--no-gitignore` para pular.

## Ferramentas opcionais

- **Taskmaster** (`task-master-ai`): MCP e plugin do catálogo para planejar tarefas.
- **Orca / Maestri:** apps desktop. As skills e hooks deles vêm **dos apps**, não
  do harness; o catálogo só traz as skills que exigem o app (`computer-use`,
  `orca-cli`, `orchestration`) e registra isso como pré-requisito no manifesto.
- **Impeccable:** instalado pelo próprio CLI (`npx impeccable install`); depois
  rode `/impeccable init` no chat do agente.

## Público vs. overlay privado

| Fica no repositório público | Fica no overlay privado |
|---|---|
| Ferramentas genéricas (MCPs, skills, plugins, presets) | Skills privadas (ex.: geradores de relatório) |
| Templates e convenções | MCPs específicos de cliente, URLs de servidor |
| Nomes de variáveis de ambiente | Qualquer coisa ligada às suas contas ou clientes |

Regra: **público = ferramenta genérica; overlay = o que depende das suas contas ou
clientes.** Tokens e valores de segredo não entram em nenhum repositório; vêm do
gerenciador de senhas para o ambiente. O `pnpm guard` (primeiro passo do CI) falha
se um token da denylist aparecer em qualquer arquivo rastreável.
