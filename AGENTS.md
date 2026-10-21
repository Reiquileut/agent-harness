# agent-harness — instruções do projeto

Arquivo canônico para todo agente neste repositório (o Claude Code o lê pelo `CLAUDE.md`).
As regras gerais (Clean Code for Agents, roteamento de modelos, higiene de Docker) vêm do
`~/.codex/AGENTS.md` global, que este próprio harness instala. O escopo do ai-memory deste
repositório está em `.ai-memory.toml`.

## Comandos
- Instalar dependências: `pnpm install --frozen-lockfile`
- E2E (escritas reais em HOMEs temporários, offline): `npm test` · uma suíte só:
  `bash scripts/ci-e2e.sh 82-mods`
- Hooks e status line (`node --test`): `npm run test:hooks`
- Guarda de privacidade: `npm run guard`
- Typecheck: `npm run typecheck` · Build (gera `dist/cli.js`, que é versionado): `npm run build`
- Bootstraps (`bootstrap/ubuntu.sh`, `bootstrap/macos.sh`): são GERADOS de `bootstrap/src/`
  (o `common.sh` vai inlinado em cada um, porque `curl | bash` baixa um arquivo só). Edite
  `bootstrap/src/` e rode `npm run build:bootstrap`; a suíte `71-bootstrap-build` reprova saída velha.
  O do macOS precisa rodar no bash 3.2: nada de `mapfile`, `declare -A`, `${v,,}`.
- Smoke sem escrever nada: `node dist/cli.js init --dry-run -y --defaults -a claude-code -a codex -a opencode`

## Artefatos de teste
- `artifacts/e2e/report.json`: cada checagem do E2E com pass/fail; passa ou falha pelo campo
  `failed`. Gerado a cada execução (ignorado pelo git) e enviado pelo CI.

## Restrições
- O repositório é PÚBLICO. Nunca commite token, chave, URL de servidor privado, ID de conta,
  nome de cliente ou de projeto privado, nem caminho pessoal (`C:\Users\<nome>`, `/Users/<nome>`).
  O catálogo guarda só NOMES de variáveis. O `npm run guard` (primeiro passo do CI) reprova os
  termos da denylist.
- O que é ligado a contas ou clientes (skills privadas, MCPs de cliente, URLs) vai para o overlay
  privado, nunca para o catálogo público nem para `assets/`.
- `dist/` é versionado: rode `npm run build` antes de commitar mudança em `src/`.
- Skills TWG são licenciadas pela Atlassian: instale com `twg skills install`, nunca copie para
  `assets/`.
- Os testes usam os CLIs falsos de `test/fixtures/bin/` (claude, ai-memory, twg): nunca rode os
  binários reais nem instaladores de rede dentro dos testes.
- Hooks, mods e a status line são `.ts` rodados direto pelo Node (>= 22.18): um arquivo por
  script, sintaxe apagável (sem enum, namespace nem parameter properties), só módulos `node:`.
