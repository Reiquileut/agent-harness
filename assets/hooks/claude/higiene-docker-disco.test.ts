// Testes E2E do hook global de higiene de disco/Docker (pedido do usuário em 2026-10-16, depois de
// um log de 19 GB de um `pnpm dev` e 120 volumes anônimos órfãos de testes encherem o C:).
// Roda o script de verdade (subprocesso `node`) com o payload do hook no stdin, como o Claude Code faz.
// Escritos ANTES do hook: a lista abaixo é a lista de jeitos de ele falhar.
// Rodar: node --test ~/.claude/hooks/higiene-docker-disco.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CAMINHO_HOOK_HIGIENE_DISCO = join(dirname(fileURLToPath(import.meta.url)), "higiene-docker-disco.ts");

interface SaidaHookHigieneDisco { codigo: number | null; stdout: string; }

function rodarHookHigieneDisco(entradaStdin: string): SaidaHookHigieneDisco {
  const execucao = spawnSync(process.execPath, [CAMINHO_HOOK_HIGIENE_DISCO], { input: entradaStdin, encoding: "utf8", timeout: 10_000 });
  return { codigo: execucao.status, stdout: execucao.stdout.trim() };
}

function payloadDeShell(comando: string, nomeFerramenta: string = "Bash"): string {
  return JSON.stringify({ hook_event_name: "PreToolUse", tool_name: nomeFerramenta, tool_input: { command: comando } });
}

function assertNegadoHigiene(comando: string, trechoEsperadoNoMotivo: string, nomeFerramenta: string = "Bash"): void {
  const saida = rodarHookHigieneDisco(payloadDeShell(comando, nomeFerramenta));
  assert.equal(saida.codigo, 0, `hook saiu com código ${saida.codigo}, stdout=${JSON.stringify(saida.stdout)}`);
  assert.notEqual(saida.stdout, "", `esperava deny para ${JSON.stringify(comando)}, veio liberado`);
  const decisao = JSON.parse(saida.stdout).hookSpecificOutput;
  assert.equal(decisao.permissionDecision, "deny", `esperava deny, veio ${JSON.stringify(decisao)}`);
  assert.ok(decisao.permissionDecisionReason.includes(trechoEsperadoNoMotivo), `motivo sem "${trechoEsperadoNoMotivo}": ${decisao.permissionDecisionReason}`);
}

function assertLiberadoHigiene(comando: string): void {
  const saida = rodarHookHigieneDisco(payloadDeShell(comando));
  assert.equal(saida.codigo, 0);
  assert.equal(saida.stdout, "", `esperava liberado para ${JSON.stringify(comando)}, veio ${saida.stdout}`);
}

// --- docker rm sem -v (vazamento real: volume anônimo órfão por execução) ---
test("nega docker rm -f sem -v", () => assertNegadoHigiene("docker rm -f app-validacao-pg", "-v"));
test("nega docker container rm --force sem -v", () => assertNegadoHigiene("docker container rm --force x", "-v"));
test("nega docker rm sem -f e sem -v", () => assertNegadoHigiene("docker rm x y", "-v"));
test("nega docker rm encadeado depois de &&", () => assertNegadoHigiene("cd /c/repo && docker rm -f pg", "-v"));
test("nega docker rm pela ferramenta PowerShell", () => assertNegadoHigiene("docker rm -f pg; docker ps", "-v", "PowerShell"));
test("libera docker rm -f -v, -fv, -vf e --volumes", () => {
  assertLiberadoHigiene("docker rm -f -v pg");
  assertLiberadoHigiene("docker rm -fv pg");
  assertLiberadoHigiene("docker rm -vf pg");
  assertLiberadoHigiene("docker container rm --force --volumes pg");
});
test("libera docker rmi (imagem, não container)", () => assertLiberadoHigiene("docker rmi -f app:candidato"));
test("libera docker volume rm de volume anônimo", () => assertLiberadoHigiene("docker volume rm abc123"));

// --- prune que apaga volumes NOMEADOS (bancos reais) ---
test("nega docker volume prune -a / --all", () => {
  assertNegadoHigiene("docker volume prune -a -f", "nomeados");
  assertNegadoHigiene("docker volume prune --all", "nomeados");
});
test("nega docker system prune --volumes", () => assertNegadoHigiene("docker system prune -af --volumes", "nomeados"));
test("libera docker volume prune sem -a (só anônimos) e system prune sem --volumes", () => {
  assertLiberadoHigiene("docker volume prune -f");
  assertLiberadoHigiene("docker system prune -f");
  assertLiberadoHigiene("docker image prune -af --filter until=48h");
});

// --- processo longo com saída redirecionada para arquivo sem limite (log real de 19 GB) ---
test("nega pnpm dev redirecionado para arquivo", () => assertNegadoHigiene("pnpm dev > $env:TEMP\\app-backend-dev.log 2>&1", "arquivo"));
test("nega npm run dev com *> e Out-File no PowerShell", () => {
  assertNegadoHigiene("npm run dev *> dev.log", "arquivo", "PowerShell");
  assertNegadoHigiene("pnpm --filter api dev | Out-File api.log", "arquivo", "PowerShell");
});
test("nega turbo/yarn watch|start com >> ou tee", () => {
  assertNegadoHigiene("turbo run dev >> /tmp/turbo.log &", "arquivo");
  assertNegadoHigiene("yarn start | tee server.log", "arquivo");
});
test("libera dev sem redirecionar e build/test com redirecionamento", () => {
  assertLiberadoHigiene("pnpm dev");
  assertLiberadoHigiene("pnpm build > build.log 2>&1");
  assertLiberadoHigiene("npm test > artifacts/test.log");
  assertLiberadoHigiene("pnpm dev > /dev/null 2>&1");
  assertLiberadoHigiene("pnpm dev *> $null");
});

// --- SessionStart: injeta a regra no contexto de toda sessão ---
test("SessionStart devolve additionalContext com a regra de disco", () => {
  const saida = rodarHookHigieneDisco(JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }));
  assert.equal(saida.codigo, 0);
  const contexto = JSON.parse(saida.stdout).hookSpecificOutput;
  assert.equal(contexto.hookEventName, "SessionStart");
  assert.ok(contexto.additionalContext.includes("docker rm -f -v"), contexto.additionalContext);
  assert.ok(contexto.additionalContext.includes("higiene-docker-disco"), "deve apontar a página da memória");
});

test("SubagentStart também recebe a regra (subagente nasce sabendo, sem ler memória)", () => {
  const saida = rodarHookHigieneDisco(JSON.stringify({ hook_event_name: "SubagentStart", agent_type: "Explore" }));
  const contexto = JSON.parse(saida.stdout).hookSpecificOutput;
  assert.equal(contexto.hookEventName, "SubagentStart");
  assert.ok(contexto.additionalContext.includes("docker rm -f -v"));
});

// --- falha aberto ---
test("falha aberto: stdin vazio, JSON inválido, ferramenta não-shell, comando ausente", () => {
  for (const entrada of ["", "{não é json", JSON.stringify({ tool_name: "Edit", tool_input: { new_string: "docker rm -f x" } }), JSON.stringify({ tool_name: "Bash", tool_input: {} })]) {
    const saida = rodarHookHigieneDisco(entrada);
    assert.equal(saida.codigo, 0);
    assert.equal(saida.stdout, "", `entrada ${JSON.stringify(entrada)} deveria liberar`);
  }
});
test("libera comando que só cita docker rm dentro de echo/grep", () => {
  assertLiberadoHigiene('grep -rn "docker rm -f" tests/');
  assertLiberadoHigiene("echo 'use docker rm -f -v'");
});
