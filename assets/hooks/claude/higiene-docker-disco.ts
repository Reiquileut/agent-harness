// Hook GLOBAL de higiene de disco (~/.claude/settings.json). Pedido do usuário em 2026-10-16, depois
// que o C: perdeu dezenas de GB de novo: um `pnpm dev` redirecionado para
// um log em %TEMP% chegou a 19 GB em 11 h (workers em loop sem backoff com o Docker
// parado), e os testes de um projeto deixaram 120 volumes anônimos órfãos (`docker rm -f` sem `-v`).
// Dois eventos:
//  - SessionStart/SubagentStart: injeta a regra curta (texto fixo, NÃO lê a memória) no contexto (fonte:
//    ai-memory profile/workflow/higiene-docker-disco.md e seção "Docker hygiene" do ~/.codex/AGENTS.md).
//  - PreToolUse (Bash|PowerShell): nega os comandos que causaram os incidentes, com o motivo e o
//    comando esperado, para o agente refazer. Vale também para subagentes.
// `docker compose down` sem -v NÃO é negado de propósito: com -v ele apaga volumes NOMEADOS (bancos reais).
// Falha aberto: stdin vazio, JSON inválido ou erro interno liberam o comando.
// Testes: node --test ~/.claude/hooks/higiene-docker-disco.test.ts
import { readFileSync } from "node:fs";

interface EntradaHookHigieneDisco {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: { command?: unknown };
}

interface RegraComandoProibidoDisco { violada: (trecho: string) => boolean; motivo: string; }

const FERRAMENTAS_SHELL_HIGIENE_DISCO: ReadonlySet<string> = new Set(["Bash", "PowerShell"]);
const SEPARADOR_DE_COMANDOS_SHELL = /&&|\|\||;|\n/;

const LEMBRETE_SESSAO_HIGIENE_DISCO = [
  "Higiene de disco (regra do usuário, incidentes de 11/10 e 16/10/2026; detalhes na memória profile/workflow/higiene-docker-disco.md):",
  "- Container de teste: sempre `docker rm -f -v <nome>` (Postgres/Redis/MinIO/LocalStack declaram VOLUME; sem -v sobra volume anônimo).",
  "- Nunca `docker volume prune -a` nem `docker system prune --volumes` (volumes nomeados guardam bancos reais).",
  "- Imagens descartáveis com tag fixa (`<projeto>-validacao:candidato`) ou `docker rmi -f` ao terminar.",
  "- Dev server/workers/watch: nunca redirecione a saída para arquivo sem limite; use run_in_background e ENCERRE o processo ao terminar e antes de parar o Docker.",
  "- Laço de fila/polling precisa de pausa com backoff no catch.",
].join("\n");

/** Ex.: temFlagCurtaOuLonga("docker rm -fv x", "v", "volumes") → true */
function temFlagCurtaOuLonga(trecho: string, letra: string, nomeLongo: string): boolean {
  const curta = new RegExp(`(?:^|\\s)-[a-zA-Z]*${letra}[a-zA-Z]*(?=\\s|$)`);
  return curta.test(trecho) || new RegExp(`(?:^|\\s)--${nomeLongo}(?=[\\s=]|$)`).test(trecho);
}

/** O trecho começa por `docker` (não é texto citado em echo/grep). */
function iniciaComDocker(trecho: string, subcomando: RegExp): boolean {
  return new RegExp(`^\\s*(?:sudo\\s+)?docker(?:\\.exe)?\\s+${subcomando.source}`).test(trecho);
}

// Redirecionamento para /dev/null ou $null não grava nada em disco.
const REGEX_REDIRECIONA_PARA_ARQUIVO = /(?:\d?\*?>{1,2}(?!\s*(?:&\d|\/dev\/null|\$null))|\|\s*(?:Out-File|Tee-Object|tee)\b)/i;
const REGEX_PROCESSO_LONGO_DEV = /^\s*(?:pnpm|npm|yarn|bun|npx|turbo)\b[^|>]*\b(?:dev|start|watch|serve)\b/i;

const REGRAS_COMANDOS_PROIBIDOS_DISCO: readonly RegraComandoProibidoDisco[] = [
  {
    violada: (t) => iniciaComDocker(t, /(?:container\s+)?rm\b/) && !temFlagCurtaOuLonga(t, "v", "volumes"),
    motivo: "`docker rm` sem `-v` deixa o volume anônimo do container órfão (um projeto acumulou 120 / 4,2 GB em 3 dias). Refaça com `docker rm -f -v <nome>`.",
  },
  {
    violada: (t) => iniciaComDocker(t, /volume\s+prune\b/) && temFlagCurtaOuLonga(t, "a", "all"),
    motivo: "`docker volume prune -a` apaga volumes nomeados (bancos reais). Para órfãos use `docker volume prune -f` (só anônimos).",
  },
  {
    violada: (t) => iniciaComDocker(t, /system\s+prune\b/) && /--volumes\b/.test(t),
    motivo: "`docker system prune --volumes` apaga volumes nomeados (bancos reais). Rode sem `--volumes`.",
  },
  {
    violada: (t) => REGEX_PROCESSO_LONGO_DEV.test(t) && REGEX_REDIRECIONA_PARA_ARQUIVO.test(t.replace(/\s2>&1/g, "")),
    motivo: "Processo longo (dev/start/watch/serve) com saída redirecionada para arquivo sem limite: um `pnpm dev` assim gerou um log de 19 GB em 11 h. Rode sem redirecionar (run_in_background) e encerre o processo ao terminar.",
  },
];

/** Separa `a && b; c` em trechos. Ex.: trechosDoComandoShell("cd x && docker rm y") → ["cd x", "docker rm y"] */
function trechosDoComandoShell(comando: string): string[] {
  return comando.split(SEPARADOR_DE_COMANDOS_SHELL).map((trecho) => trecho.trim()).filter(Boolean);
}

/** Motivos das regras violadas (sem repetição). Ex.: motivosDeViolacaoDisco("docker rm x") → ["`docker rm` sem `-v`..."] */
function motivosDeViolacaoDisco(comando: string): string[] {
  const motivos = trechosDoComandoShell(comando).flatMap((trecho) =>
    REGRAS_COMANDOS_PROIBIDOS_DISCO.filter((regra) => regra.violada(trecho)).map((regra) => regra.motivo));
  return [...new Set(motivos)];
}

function respostaNegandoComandoDisco(motivos: string[]): string {
  const motivo = `Bloqueado pelo hook ~/.claude/hooks/higiene-docker-disco.ts (regra do usuário, memória profile/workflow/higiene-docker-disco.md): ${motivos.join(" ")}`;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: motivo } });
}

// Texto fixo, sem ler a memória: o usuário pediu que o agente saiba a regra ao nascer, sem custo por chamada.
const EVENTOS_QUE_RECEBEM_LEMBRETE_DISCO: ReadonlySet<string> = new Set(["SessionStart", "SubagentStart"]);

function respostaLembreteSessaoDisco(nomeEvento: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: nomeEvento, additionalContext: LEMBRETE_SESSAO_HIGIENE_DISCO } });
}

function interpretarEntradaHigieneDisco(textoStdin: string): EntradaHookHigieneDisco | null {
  try {
    return JSON.parse(textoStdin) as EntradaHookHigieneDisco;
  } catch {
    return null;
  }
}

/** "" libera; JSON nega ou injeta contexto. Ex.: decidirHigieneDisco('{"tool_name":"Edit"}') → "" */
function decidirHigieneDisco(textoStdin: string): string {
  const entrada = interpretarEntradaHigieneDisco(textoStdin);
  const nomeEvento = entrada?.hook_event_name ?? "";
  if (EVENTOS_QUE_RECEBEM_LEMBRETE_DISCO.has(nomeEvento)) return respostaLembreteSessaoDisco(nomeEvento);
  if (!entrada || !FERRAMENTAS_SHELL_HIGIENE_DISCO.has(entrada.tool_name ?? "")) return "";
  const comando = entrada.tool_input?.command;
  if (typeof comando !== "string") return "";
  const motivos = motivosDeViolacaoDisco(comando);
  return motivos.length > 0 ? respostaNegandoComandoDisco(motivos) : "";
}

try {
  const respostaDoHook = decidirHigieneDisco(readFileSync(0, "utf8"));
  if (respostaDoHook) process.stdout.write(respostaDoHook);
} catch {
  // falha aberto: um bug aqui nunca pode travar todo comando de shell de todas as sessões
}
