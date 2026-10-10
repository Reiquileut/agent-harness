// Testes E2E do hook global que barra menção ao Claude em commits e PRs (pedido do usuário em
// 2026-10-07: "o hook que remove a menção ao Claude Code em commits por padrão").
// Roda o script de verdade (subprocesso `node`), com o payload do PreToolUse no stdin, como o
// Claude Code faz. Escritos ANTES do hook: a lista abaixo é a lista de jeitos de ele falhar.
// Rodar: node --test ~/.claude/hooks/bloquear-mencao-claude-commit.test.ts (no repo: assets/hooks/claude/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CAMINHO_HOOK_MENCAO_CLAUDE = join(dirname(fileURLToPath(import.meta.url)), "bloquear-mencao-claude-commit.ts");
const TRAILER_COAUTOR_CLAUDE = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>";
const TRAILER_SESSAO_CLAUDE = "Claude-Session: https://claude.ai/code/session_01HA7RYV2rKSXfXcY2Zg8e7r";
const RODAPE_PR_CLAUDE = "🤖 Generated with [Claude Code](https://claude.com/claude-code)";

interface SaidaHookMencaoClaude { codigo: number | null; stdout: string; }

function rodarHookMencaoClaude(entradaStdin: string): SaidaHookMencaoClaude {
  const execucao = spawnSync(process.execPath, [CAMINHO_HOOK_MENCAO_CLAUDE], { input: entradaStdin, encoding: "utf8", timeout: 10_000 });
  return { codigo: execucao.status, stdout: execucao.stdout.trim() };
}

function payloadDeFerramenta(nomeFerramenta: string, comando: string, pastaAtual: string = tmpdir()): string {
  return JSON.stringify({ hook_event_name: "PreToolUse", tool_name: nomeFerramenta, tool_input: { command: comando }, cwd: pastaAtual });
}

function assertNegado(saida: SaidaHookMencaoClaude, trechoEsperadoNoMotivo: string): void {
  assert.equal(saida.codigo, 0, `hook saiu com código ${saida.codigo}, stdout=${JSON.stringify(saida.stdout)}`);
  const decisao = JSON.parse(saida.stdout).hookSpecificOutput;
  assert.equal(decisao.hookEventName, "PreToolUse");
  assert.equal(decisao.permissionDecision, "deny", `esperava deny, veio ${JSON.stringify(decisao)}`);
  assert.ok(decisao.permissionDecisionReason.includes(trechoEsperadoNoMotivo), `motivo sem "${trechoEsperadoNoMotivo}": ${decisao.permissionDecisionReason}`);
}

function assertLiberado(saida: SaidaHookMencaoClaude): void {
  assert.equal(saida.codigo, 0, `hook saiu com código ${saida.codigo}`);
  assert.equal(saida.stdout, "", `esperava stdout vazio (liberado), veio ${JSON.stringify(saida.stdout)}`);
}

function pastaComArquivoDeMensagem(conteudoMensagem: string): string {
  const pasta = mkdtempSync(join(tmpdir(), "hook-mencao-claude-"));
  writeFileSync(join(pasta, "mensagem.txt"), conteudoMensagem);
  return pasta;
}

test("nega git commit -m com Co-Authored-By: Claude", () => {
  assertNegado(rodarHookMencaoClaude(payloadDeFerramenta("Bash", `git commit -m "feat: x\n\n${TRAILER_COAUTOR_CLAUDE}"`)), "Co-Authored-By");
});

test("nega commit por heredoc com Claude-Session", () => {
  assertNegado(rodarHookMencaoClaude(payloadDeFerramenta("Bash", `git commit -F - <<'EOF'\nfeat: x\n\n${TRAILER_SESSAO_CLAUDE}\nEOF`)), "Claude-Session");
});

test("nega gh pr create com o rodapé 'Generated with Claude Code'", () => {
  assertNegado(rodarHookMencaoClaude(payloadDeFerramenta("Bash", `gh pr create --title x --body "resumo\n\n${RODAPE_PR_CLAUDE}"`)), "Generated with");
});

test("nega commit pela ferramenta PowerShell (here-string)", () => {
  assertNegado(rodarHookMencaoClaude(payloadDeFerramenta("PowerShell", `git commit -m @'\nfeat: x\n\n${TRAILER_COAUTOR_CLAUDE}\n'@`)), "Co-Authored-By");
});

test("nega git commit -F <arquivo relativo> cujo conteúdo menciona o Claude", () => {
  const pasta = pastaComArquivoDeMensagem(`feat: x\n\n${TRAILER_COAUTOR_CLAUDE}\n`);
  assertNegado(rodarHookMencaoClaude(payloadDeFerramenta("Bash", "git commit -F mensagem.txt", pasta)), "Co-Authored-By");
});

test("nega git commit --file=<arquivo absoluto> com Claude-Session", () => {
  const pasta = pastaComArquivoDeMensagem(`feat: x\n\n${TRAILER_SESSAO_CLAUDE}\n`);
  assertNegado(rodarHookMencaoClaude(payloadDeFerramenta("Bash", `git commit --file="${join(pasta, "mensagem.txt")}"`)), "Claude-Session");
});

test("nega git -C <pasta> commit e trailer em minúsculas", () => {
  assertNegado(rodarHookMencaoClaude(payloadDeFerramenta("Bash", 'git -C "C:/repo" commit -m "x\n\nco-authored-by: claude <noreply@anthropic.com>"')), "co-authored-by");
});

test("nega commit encadeado depois de cd &&", () => {
  assertNegado(rodarHookMencaoClaude(payloadDeFerramenta("Bash", `cd /c/repo && git add . && git commit -m "x\n\n${TRAILER_COAUTOR_CLAUDE}"`)), "Co-Authored-By");
});

test("libera git commit -F <arquivo inexistente> (sem quebrar)", () => {
  assertLiberado(rodarHookMencaoClaude(payloadDeFerramenta("Bash", "git commit -F nao-existe.txt")));
});

test("libera commit limpo", () => {
  assertLiberado(rodarHookMencaoClaude(payloadDeFerramenta("Bash", 'git commit -m "feat(cmep-experience): endereço do Be Next"')));
});

test("libera commit cujo assunto fala do Claude sem ser atribuição", () => {
  assertLiberado(rodarHookMencaoClaude(payloadDeFerramenta("Bash", 'git commit -m "feat: integra a API do Claude no classificador"')));
});

test("libera coautor humano", () => {
  assertLiberado(rodarHookMencaoClaude(payloadDeFerramenta("Bash", 'git commit -m "x\n\nCo-Authored-By: Maria Silva <maria@exemplo.com>"')));
});

test("libera comando que não é commit, mesmo citando o trailer", () => {
  assertLiberado(rodarHookMencaoClaude(payloadDeFerramenta("Bash", `git log --grep "${TRAILER_COAUTOR_CLAUDE}"`)));
  assertLiberado(rodarHookMencaoClaude(payloadDeFerramenta("Bash", `echo "${TRAILER_COAUTOR_CLAUDE}" > nota.txt`)));
});

test("libera outras ferramentas (Edit) com o trailer no conteúdo", () => {
  const payloadEdit = JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "x.md", new_string: TRAILER_COAUTOR_CLAUDE } });
  assertLiberado(rodarHookMencaoClaude(payloadEdit));
});

test("falha aberto: stdin vazio, JSON inválido e tool_input sem command", () => {
  assertLiberado(rodarHookMencaoClaude(""));
  assertLiberado(rodarHookMencaoClaude("{não é json"));
  assertLiberado(rodarHookMencaoClaude(JSON.stringify({ tool_name: "Bash", tool_input: {} })));
});
