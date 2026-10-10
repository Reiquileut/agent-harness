// Hook PreToolUse GLOBAL (~/.claude/settings.json, matcher Bash|PowerShell): nega `git commit` e
// `gh pr create|edit` que levem atribuição ao Claude — trailer Co-Authored-By: Claude, trailer
// Claude-Session, rodapé "Generated with Claude Code". Pedido do usuário em 2026-10-07.
// Primeira camada: `"attribution": {"commit": "", "pr": "", "sessionUrl": false}` no mesmo
// settings.json faz o Claude Code parar de pedir essas linhas. Este hook é a rede de segurança
// para quando elas vierem por outro caminho (instrução no prompt, mensagem copiada, outro agente).
// Nega em vez de reescrever o comando: arrancar uma linha de dentro de -m "..." ou de um heredoc
// pode quebrar as aspas do shell; com o motivo do deny, o Claude refaz a mensagem sem as linhas.
// Falha aberto: stdin vazio, JSON inválido ou arquivo -F ilegível liberam o comando.
// Testes: node --test ~/.claude/hooks/bloquear-mencao-claude-commit.test.ts (Node >= 22.18: type stripping nativo)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface EntradaPreToolUseMencaoClaude {
  tool_name?: string;
  tool_input?: { command?: unknown };
  cwd?: string;
}

const FERRAMENTAS_DE_SHELL_VIGIADAS: ReadonlySet<string> = new Set(["Bash", "PowerShell"]);
// `git [-C pasta] [-c chave=valor] [--opcao] commit` — exige que "commit" seja o subcomando, para
// `git log --grep "...commit..."` não contar.
const REGEX_SUBCOMANDO_GIT_COMMIT = /\bgit(?:\s+(?:-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)|--[\w-]+(?:=\S+)?))*\s+commit\b/;
const REGEX_GH_PR_COM_CORPO = /\bgh\s+pr\s+(?:create|edit)\b/;
const REGEX_ARQUIVO_DA_MENSAGEM = /(?:^|\s)(?:-F|--file|--body-file)(?:\s+|=)(?:"([^"]+)"|'([^']+)'|(\S+))/g;
// [^\n"'] para o trecho reportado parar antes da aspa que fecha o -m "...".
const PADROES_ATRIBUICAO_CLAUDE: readonly RegExp[] = [
  /co-authored-by:[^\n"']*?\b(?:claude|anthropic)\b[^\n"']*/i,
  /claude-session:[^\n"']*/i,
  /generated with \[?claude code\]?(?:\([^)\n]*\))?/i,
  /noreply@anthropic\.com/i,
  /claude\.ai\/code\/session_\w+/i,
];

/** Lê o stdin inteiro do hook. Ex.: lerStdinDoHookMencaoClaude() → '{"tool_name":"Bash",...}' */
function lerStdinDoHookMencaoClaude(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** JSON do PreToolUse, ou null se inválido. Ex.: interpretarEntradaMencaoClaude("{") → null */
function interpretarEntradaMencaoClaude(textoStdin: string): EntradaPreToolUseMencaoClaude | null {
  try {
    return JSON.parse(textoStdin) as EntradaPreToolUseMencaoClaude;
  } catch {
    return null;
  }
}

/** O comando de shell da chamada, ou null se não for Bash/PowerShell. */
function comandoDeShellVigiado(entrada: EntradaPreToolUseMencaoClaude | null): string | null {
  if (!entrada || !FERRAMENTAS_DE_SHELL_VIGIADAS.has(entrada.tool_name ?? "")) return null;
  const comando = entrada.tool_input?.command;
  return typeof comando === "string" ? comando : null;
}

/** Ex.: ehCommitOuPullRequest('git -C x commit -m "a"') → true; ehCommitOuPullRequest("git log") → false */
function ehCommitOuPullRequest(comando: string): boolean {
  return REGEX_SUBCOMANDO_GIT_COMMIT.test(comando) || REGEX_GH_PR_COM_CORPO.test(comando);
}

function lerArquivoDaMensagemOuVazio(caminhoAbsoluto: string): string {
  try {
    return readFileSync(caminhoAbsoluto, "utf8");
  } catch {
    return "";
  }
}

/** Conteúdo dos arquivos de mensagem (-F/--file/--body-file), relativos ao cwd da sessão. */
function textoDosArquivosDeMensagem(comando: string, pastaDaSessao: string): string {
  const conteudos: string[] = [];
  for (const achado of comando.matchAll(REGEX_ARQUIVO_DA_MENSAGEM)) {
    const caminho = achado[1] ?? achado[2] ?? achado[3] ?? "";
    conteudos.push(lerArquivoDaMensagemOuVazio(resolve(pastaDaSessao, caminho)));
  }
  return conteudos.join("\n");
}

/** Trechos de atribuição achados. Ex.: atribuicoesAoClaude("x\nClaude-Session: y") → ["Claude-Session: y"] */
function atribuicoesAoClaude(texto: string): string[] {
  const achados = PADROES_ATRIBUICAO_CLAUDE.map((padrao) => texto.match(padrao)?.[0]?.trim() ?? "");
  return [...new Set(achados.filter((trecho) => trecho !== ""))];
}

/** JSON de deny do PreToolUse, com as linhas ofensoras e o formato esperado no motivo. */
function respostaNegandoAtribuicao(atribuicoes: string[]): string {
  const motivo = `Commit/PR com atribuição ao Claude, proibida por padrão (hook ~/.claude/hooks/bloquear-mencao-claude-commit.ts). `
    + `Refaça a mensagem SEM estes trechos: ${atribuicoes.map((t) => JSON.stringify(t)).join(", ")}. `
    + `Esperado: nenhum trailer Co-Authored-By/Claude-Session do Claude e nenhum rodapé "Generated with Claude Code".`;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: motivo } });
}

/** "" libera; JSON nega. Ex.: decidirSobreAtribuicaoClaude('{"tool_name":"Edit"}') → "" */
function decidirSobreAtribuicaoClaude(textoStdin: string): string {
  const entrada = interpretarEntradaMencaoClaude(textoStdin);
  const comando = comandoDeShellVigiado(entrada);
  if (!comando || !ehCommitOuPullRequest(comando)) return "";
  const pastaDaSessao = entrada?.cwd ?? process.cwd();
  const atribuicoes = atribuicoesAoClaude(`${comando}\n${textoDosArquivosDeMensagem(comando, pastaDaSessao)}`);
  return atribuicoes.length > 0 ? respostaNegandoAtribuicao(atribuicoes) : "";
}

try {
  const respostaDoHook = decidirSobreAtribuicaoClaude(lerStdinDoHookMencaoClaude());
  if (respostaDoHook) process.stdout.write(respostaDoHook);
} catch {
  // falha aberto: um bug aqui nunca pode travar todo comando de shell de todas as sessões
}
