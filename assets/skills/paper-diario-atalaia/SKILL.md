---
name: paper-diario-atalaia
description: "Produz o Paper Diário (e as variantes semanal/mensal) de inteligência política do gabinete — operação ATALAIA, monitorado principal Omar Aziz (PSD, pré-candidato ao Governo do AM 2026). Ciclo completo: memória → inventário de runs na conta de scraping (releitura grátis SEMPRE antes de coletar) → coleta incremental multiplataforma com teto de custo → análise assunto×narrativa com dois públicos → painel do playbook (gatilhos/atores/termos) → radar de tendências para marketing → PDF via template + Chrome headless no Desktop. Gatilhos: 'paper diário', 'edição diária', 'relatório diário', 'diário ATALAIA', 'paper semanal', 'paper mensal', 'edição de hoje', 'monitoramento do Omar'."
---

# Paper Diário ATALAIA — Inteligência Política do Gabinete

Skill nascida da edição-piloto de 22/07/2026 (7 revisões até a versão final). Codifica o processo
completo E as lições aprendidas — inclusive os erros que exigiram correção. Para crise aguda ou
panorama completo com Anexo de Evidências, invocar também a skill `gestao-crise-atalaia` (mesma
doutrina; esta skill é o produto recorrente, aquela é o aprofundamento).

## Identidade do caso

- **Monitorado principal:** Omar Aziz (PSD) — senador, pré-candidato ao Governo do Amazonas 2026.
- **Praça:** Amazonas, epicentro Manaus. Idioma: pt-BR. Codinome dos relatórios: **ATALAIA**.
- **Entregável:** `Diario_ATALAIA_OmarAziz_<AAAA-MM-DD>.pdf` no Desktop + envio no chat (SendUserFile).
- **Variantes:** semanal (agrega 7 diários: curvas, vetores que nasceram/morreram, evolução do alerta,
  comparativo de adversários) e mensal (evolução de narrativas, série histórica de KPIs, taxa de acerto
  dos gatilhos, recomendações estruturais).

## FASE 0 — Memória primeiro (nunca redescobrir)

Ler SEMPRE, antes de qualquer coisa, os arquivos de memória do projeto:
- `playbook-monitoramento-omar-aziz.md` — playbook do cliente (atores, tags, gatilhos, fontes,
  roteamento). É lá — e SÓ lá — que vivem os contatos nominais de alerta. **Nomes, telefones e
  e-mails da distribuição NUNCA entram no PDF nem nesta skill** (documento circula; confidencial).
- `caso-omar-aziz-estado.md` — estado vivo: frentes, handles verificados, marca-d'água de coleta,
  posts-chave a remedir, pendências, custo acumulado. Atualizar no fim de CADA edição.

Handles verificados (não redescobrir, não chutar): monitorado — X @OmarAzizSenador (245 mil),
**IG @omaraziz.am (145 mil, verificado — o perfil ATIVO do monitorado)** e TikTok @omaraziz.am.
CUIDADO: @omaraziz.senador é "ID reserva do Senador", conta PRIVADA (coleta retorna vazio — não é
lacuna, é conta reserva); @omarazizsenador é conta morta de 2014; @omarazizoficial/@omaraziz são
vazias. Wilson Lima IG @wilsonlimaam (468 mil). Eduardo Braga IG @eduardobraga_am. Maria do Carmo
TikTok @mariadocarmoseffair. YouTube: TV A Crítica `@tvacrítica`, TV Norte Amazonas
`channel/UC4WNZYa1d0HVzdVWlfJEGjw`.

## FASE 1 — INVENTÁRIO DA CONTA ANTES DE COLETAR (lição mais cara da edição-piloto)

Outras sessões e membros do time rodam coletas NA MESMA conta de scraping. Releitura de dataset é
grátis; re-raspagem é paga e — pior — **analisar só a própria amostra produz conclusão errada**.
Na edição-piloto: a varredura própria deu "assunto greve = 650 mil, 0/236 comentários citam o
monitorado"; o histórico da conta continha uma operação dedicada do dia anterior (IG incluso) que
corrigiu para **~2,1 milhões e 48/987 comentários citando o monitorado** — o diagnóstico INVERTEU.

Procedimento (token Apify: fornecido na sessão ou registrado na memória do projeto):
1. `GET /v2/actor-runs?token=...&limit=100&desc=true` — todas as runs desde a última edição.
2. Para cada run nova: `GET /v2/key-value-stores/{kvStoreId}/records/INPUT` — o que foi coletado.
3. Baixar datasets relevantes: `GET /v2/datasets/{id}/items?clean=true&format=json` (grátis).
4. Só depois decidir o que AINDA falta coletar (delta).

## FASE 2 — Coleta incremental (custo típico US$ 0,30-0,60/edição)

Sempre com filtro anti-redundância NO INPUT (não só na pós-filtragem) e teto por run
(`&maxTotalChargeUsd=` na URL). Actors e formatos que funcionam:

| Coleta | Actor | Input essencial / armadilha |
|---|---|---|
| X do dia | `apidojo~tweet-scraper` | `searchTerms` com `since:<watermark> lang:pt`; queries fixas: "Omar Aziz", "Wilson Lima Aziz", termos negativos, slogans, adversários. `sort:"Latest"` |
| X viral da praça | `apidojo~tweet-scraper` | `"manaus min_faves:300 since:<d-7>"`, `"amazonas min_faves:500"` — `sort:"Top"` (alimenta a seção 10) |
| TikTok busca | `clockworks~tiktok-scraper` | `searchQueries` + `videoSearchDateFilter:"PAST_WEEK"` (valores válidos: ALL_TIME, PAST_24_HOURS, PAST_WEEK, PAST_MONTH...; "WEEK" sozinho FALHA). Actors clockworks exigem teto mínimo US$ 0,50 |
| TikTok trends | `clockworks~tiktok-scraper` | `hashtags:["manaus"]` — mais confiável que busca para tendências |
| TikTok remedição | `clockworks~tiktok-scraper` | `postURLs` dos posts-chave da edição anterior (velocidade; ~US$ 0,01) |
| Comentários TikTok | `clockworks~tiktok-comments-scraper` | `postURLs` + `commentsPerPost` (~60) nos 3-4 maiores vídeos do dia |
| IG posts | `apify~instagram-scraper` | `directUrls` de perfis + `resultsType:"posts"` + `onlyPostsNewerThan:<watermark>`; posts fixados furam o filtro — refiltrar por timestamp |
| IG perfis | `apify~instagram-profile-scraper` | `usernames` — barato (US$ 0,002/perfil), traz latestPosts |
| Comentários IG | `apify~instagram-comment-scraper` | `directUrls` dos reels-chave; é a coleta mais cara (US$ 0,5-2/lote) — usar `resultsLimit = total_atual − já_coletado` |
| YouTube | `streamers~youtube-scraper` | `searchKeywords` é STRING (não array). Canais do playbook via `startUrls:[{url:".../videos"}]` |

Padrão de execução: runs assíncronas em paralelo (`POST /v2/acts/{actor}/runs`), poll de status em
background, download com `clean=true`. Runs síncronas (`run-sync-get-dataset-items`, timeout≤280s)
só para coletas pequenas.

**O que coletar todo dia:** (1) X desde a marca-d'água; (2) remedição dos posts-chave listados na
memória (a velocidade é a métrica de decisão — série temporal); (3) comentários do conteúdo mais
quente do dia (1 lote); (4) trends da praça (X min_faves + #manaus); (5) o que o inventário da
Fase 1 mostrar que falta. Canais de TV do playbook e varredura de portais: 2-3x/semana ou quando
gatilho armado.

### Armadilhas técnicas descobertas (todas custaram tempo real)

- **CRLF do Windows:** IDs gravados em arquivo via `python | tee` carregam `\r` invisível que quebra
  as URLs de download (curl erro 3, arquivo não criado). SEMPRE `tr -d '\r'` ao reler arquivos de IDs.
- **Console cp1252:** rodar análise Python com `PYTHONIOENCODING=utf-8` ou UnicodeEncodeError em emoji.
- **Homônimos:** "Omar Aziz" retorna anarquista sírio, música Oromo, influencer de moda, "Omar
  Abdul Aziz" árabe; "Omar" em tweet de Copa = Omar Larrosa (jogador). SEMPRE validar praça/idioma
  antes de somar alcance — um falso positivo virou "vídeo da greve citando Aziz" na edição-piloto.
- **`videoPlayCount` null no IG:** usar proxy likes/3% e SINALIZAR como estimativa no paper.
- **IG do monitorado bloqueado:** registrar como lacuna na memória do caso e reportar no chat ao
  gabinete (não no PDF — dados operacionais ficam fora do paper), não silenciar.
- **Datasets grandes:** nunca ler JSON bruto no contexto — sempre script Python com agregados.

## FASE 3 — Imprensa e fatos (grátis, paralela à coleta)

WebSearch/WebFetch: status das frentes ativas nas 24h, decisões judiciais COM órgão/data, agenda dos
atores, datas do calendário (convenções, festivais). Datar TODA matéria antes de usar (manchete de
"greve cancelada" da edição-piloto era da greve anterior). Fatos verificados alimentam a linha do
tempo da seção 2 e o painel de gatilhos.

## FASE 4 — Análise (o coração do método)

1. **ASSUNTO × NARRATIVA, sempre.** O assunto (a greve, a operação, o escândalo) tem alcance maior
   que a narrativa que atinge o monitorado. Reportar os dois e a proporção (ex.: 2,1 mi × 304 mil = 14%).
2. **DOIS PÚBLICOS, obrigatório.** Medir comentários na audiência de MASSA (vídeos de humor/serviço)
   E no conteúdo POLITIZADO separadamente. A edição-piloto provou que são universos distintos
   (0/236 na massa vs 48/987 = 5% nos reels politizados). Uma amostra única mente.
3. **Velocidade decide, não acumulado.** Remedir posts-chave (Δ views/hora). Duas curvas podem ir em
   sentidos opostos: assunto esfriando + recorte político esquentando = risco subindo, não caindo.
4. **Sentimento por buckets de regex** adaptados ao dia (culpa-prefeitura, culpa-governo, cita-monitorado,
   atores da tese, humor). Likes = tração real; comentário hostil com 0 likes é ruído. Ler na íntegra
   todos os que citam o monitorado + os 10-15 mais curtidos.
5. **Painel do playbook com dado direto, não inferência:** cada gatilho checado contra números
   (ex.: "vídeo negativo 50k+" = conferir de fato os vídeos do dia); cada ator com movimento nas 24h;
   cada termo/slogan com contagem. Gatilho disparado = marcar DISPAROU em vermelho + ação do playbook.
6. **Quem NÃO amplificou** define o patamar (adversários de alto alcance em silêncio = contido).
7. **Honestidade estrutural:** correções entre revisões viram nota de transparência ("rev. N corrigiu
   X"); lacunas de coleta são reportadas, nunca silenciadas; amostra é rotulada como amostra.

## FASE 5 — Montagem do PDF

Template estrutural: `template-diario.html` nesta pasta (edição-piloto completa — clonar estrutura e
estilos, substituir conteúdo). Base visual: template ATALAIA (mesma da skill de crise).

**Estrutura das 10 seções:**
1. **Sumário executivo** — 4 KPIs (kpi-row) + bullets do que mudou nas 24h. Capa com badge de alerta
   (VERDE/AMARELO/VERMELHO + uma linha), corte temporal, data crítica (D-x), "Consolidado diário: 18h00".
2. **Fato dominante das 24h** — linha do tempo verificada + guerra de atribuição de culpa + tabela de
   alcance por plataforma + parágrafo de velocidade.
3. **Exposição do monitorado** — frentes ativas (3.1 principal, 3.2 dormentes, 3.3 presença própria).
   Vulnerabilidades estruturais em box.danger (ex.: lastro documental do arquivamento da Maus Caminhos).
4. **Sentimento** — 4.1 público politizado / 4.2 audiência de massa + box.good de leitura estratégica.
5. **Radar de vetores** — tabela conta/alcance/posição/status com tags (HOSTIL, ACELERANDO, ESTAGNADO,
   INATIVO, A VERIFICAR).
6. **Riscos e gatilhos próximas 24h** — tabela gatilho/probabilidade/ação pré-definida.
7. **Agenda crítica** — datas com D-x.
8. **Recomendações do dia** — 3-4, acionáveis, doutrinárias.
9. **Painel de monitoração (playbook)** — 9.1 status dos 6 gatilhos; 9.2 atores (taxonomia do
   gabinete + conduta verificada); 9.3 termos e slogans com contagem. SEM seção de roteamento/
   distribuição — dados operacionais não entram no paper (regra do cliente, edição 23/07).
10. **Radar de tendências e oportunidades de presença digital** (página própria, via .pagebreak) —
    10.1 o que está em alta (tema/alcance medido/leitura, inclui trends nacionais tipo pós-Copa e
    calendário cultural tipo Cirandas de Manacapuru); 10.2 oportunidades acionáveis
    (oportunidade/execução/cuidado) para o time de marketing; fecho com regra de método (janela
    48-72h; tragédia só como pauta de cobrança; conteúdo nativo da plataforma). NUNCA chamar de
    "bônus" — é seção integrada.
    SEM box de "Notas desta edição/transparência de coleta" no PDF (regra do cliente, edição
    23/07): lacunas e notas técnicas de coleta vão para a memória do caso e para o chat com o
    gabinete, nunca para o paper.

**Regras de forma (invioláveis):** SEM emojis (setas tipográficas ok) · SEM citar ferramentas de
coleta · SEM seção de metodologia/custos · SEM dados operacionais (roteamento, distribuição,
notas de coleta — ficam na memória e no chat) · **SEM nomes, telefones ou e-mails da distribuição
em qualquer hipótese** · SEM mencionar arquivamento de evidências/timestamps no PDF (regra do
cliente, edição 23/07 — o arquivamento continua sendo FEITO, só não é citado no documento) ·
rodapé: "ATALAIA — Paper Diário de inteligência política e social listening · Edição <data> ·
Documento interno e confidencial." · Links para posts-evidência são permitidos e úteis (poucos, sóbrios).

**Render:** salvar HTML no scratchpad e:
`& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="C:\Users\<user>\Desktop\Diario_ATALAIA_OmarAziz_<data>.pdf" "file:///<caminho-html>"`
Depois SendUserFile. Antes de entregar: grep no HTML por nomes/telefones/e-mails da distribuição
(atenção a falso positivo: "irritação" contém "rita").

## FASE 6 — Pós-edição (fecha o ciclo)

1. Atualizar `caso-omar-aziz-estado.md`: nova marca-d'água, posts-chave a remedir amanhã, vetores
   novos, mudança de alerta, medições dos termos/slogans, pendências, custo acumulado.
2. Listar pendências do GABINETE no chat (não no PDF): verificações abertas, confirmações de playbook.
3. Dispatch das 18h via WhatsApp é do TIME (ou automação n8n se pedirem) — o gabinete gera o PDF.

## Playbook do cliente (referência — versão sem dados pessoais)

- **Atores:** Governo (aliados/referência): Roberto Cidade (governador, UB — consta TAMBÉM em
  adversários), Wilson Lima (UB, pré-cand. Senado). Adversários: Maria do Carmo Seffair, David
  Almeida (Avante, licenciado da prefeitura; prefeito atual: Renato Júnior). Outros: Eduardo Braga (MDB).
- **LEITURA ACORDADA DA TAXONOMIA (não relitigar, não rebaixar vigilância):** "Governo
  (aliados/referência)" = bloco do governo estadual, aliados ENTRE SI, monitorado como campo de
  referência — NÃO significa aliados do monitorado. Conduta registrada: Wilson Lima é autor do
  único ataque direto ao monitorado em jul/2026 (vídeo "maus caminhos", 07/07) e concorre ao Senado —
  classificação do playbook mantida nos relatórios + nota de conduta + vigilância de vetor de ataque.
  Pendências permanentes com o time: campo "chapa" para Eduardo Braga (convenção conjunta 25/07);
  filiação de Maria do Carmo diverge entre fontes (PT em cartelas de pesquisa vs PL em coberturas) — A VERIFICAR.
- **Slogans (termômetro positivo):** "Volta Omar", "Amazonas Forte De Novo".
- **Termos negativos:** Operação Maus Caminhos, Cidade Universitária, "Muito tempo no poder",
  desvio, Arena da Amazônia.
- **Fontes:** 13 perfis (BNC Amazonas, Portal do Holanda, A Crítica, Manaus Alerta, Cenarium, etc. —
  lista completa PENDENTE com o cliente) + YouTube TV A Crítica e TV Norte Amazonas.
- **Temas críticos:** segurança pública, corrupção/desvio, denúncia pessoal, fake news, obras
  públicas/contratos.
- **Gatilhos de crise (painel 9.1, checar um a um):** menção a investigação/inquérito; vídeo viral
  negativo (+50 mil views); ataque em horário nobre; hashtag negativa em tendência; figura de alto
  alcance atacando; fake news acelerada. Disparo → ação do playbook: reporte imediato ao contato de
  crise designado, com o paper.
- **Roteamento (papéis apenas):** 2 destinatários WhatsApp com todos os alertas (1 = contato de
  crise) + 1 destinatário e-mail para semanais. Consolidado diário 18h00. Nominal: só na memória.
- **Período crítico:** 25/07/2026 — convenções partidárias. **Narrativa em curso declarada:**
  ataques de candidatos concorrentes / Operação Maus Caminhos.

## Doutrina (herdada da skill de crise, vale aqui)

Medir antes de reagir · separar assunto de narrativa · velocidade > total · procurar a falha
factual fatal da narrativa · verificar quem NÃO amplificou · NUNCA recomendar atacar causa popular
(salário atrasado, tragédia) — solidarizar e cobrar solução · silêncio estratégico enquanto está na
bolha; resposta única no mesmo dia só em salto de patamar · fact-sheet via terceiros (abastecer o
desmentido orgânico que já circula nos comentários) · arquivar tudo com timestamp · corrigir o
cliente com franqueza quando os dados contradizem o enquadre dele — e corrigir A SI MESMO com nota
de transparência quando dados novos invertem a própria leitura anterior.
