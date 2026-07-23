---
name: gestao-crise-atalaia
description: "Metodologia coringa de gestão de crise reputacional (política, corporativa ou pessoal) via social listening — serve para QUALQUER monitorado, adversário, tema ou região. Use quando o usuário reportar uma crise em curso (narrativa de ataque, vídeo viral negativo, acusação, fake news, operação/escândalo), pedir panorama de alcance de um assunto nas redes, análise de estrago/dano, mapa de vetores de ataque, ou relatório de crise em PDF. A skill começa coletando os dados do caso (intake) e adapta coleta, análise e entregáveis ao contexto. Gatilhos: 'crise', 'panorama', 'alcance', 'social listening', 'narrativa', 'estrago', 'atalaia', 'ataque', 'viralizou', 'fake news'."
---

# Gestão de Crise — Skill Coringa de Social Listening e Panorama de Dano

Metodologia universal: funciona para qualquer monitorado (político, empresa, marca, pessoa pública), qualquer tipo de crise e qualquer praça. Validada no caso-referência "greve dos rodoviários de Manaus" (jul/2026) — citado abaixo apenas como EXEMPLO de aplicação, nunca como contexto assumido.

Produz: diagnóstico com dano medido → mapa de vetores → plano de ação → 2 PDFs pareados (Panorama + Anexo de Evidências).

## FASE 0 — INTAKE (obrigatória: a skill PERGUNTA antes de agir)

Cada crise tem atores e contexto próprios. NUNCA reaproveitar atores, partidos, veículos ou conclusões de casos anteriores. Abrir a fase perguntando (em bloco único, via AskUserQuestion ou chat) o que faltar:

**Essenciais (sem isso não começa):**
1. **Monitorado principal** — quem defendemos? (nome, cargo/condição, handles oficiais)
2. **Evento-gatilho e narrativa de ataque** — o que aconteceu e qual versão está circulando?
3. **Links dos conteúdos de ataque** (posts, vídeos, matérias) — se o usuário não tiver, a skill localiza por busca, mas pedir primeiro
4. **Credencial de coleta** — token de API de scraping (Apify ou equivalente) já fornecido na sessão/memória? Se não houver, pedir; se o usuário não tiver, operar em modo degradado (ver Adaptações)

**Importantes (perguntar; se não houver resposta, inferir e sinalizar como inferido):**
5. Adversários e aliados relevantes (com handles) — AVISAR que o mapa será verificado e pode ser corrigido
6. Datas críticas próximas (eleição, convenção, julgamento, assembleia, lançamento)
7. Praça/idioma e veículos de imprensa que importam no território
8. Playbook do cliente: gatilhos de crise já definidos (ex.: vídeo 50k+ views), canal de reporte, codinome da operação (default do cabeçalho dos PDFs: "ATALAIA" — trocar se o cliente tiver outro)
9. Restrições de forma nos entregáveis (default validado: sem emojis, sem citar ferramenta de coleta, sem seção de metodologia, salvar no Desktop)

**Só então** executar Fases 1-6 abaixo, adaptando conforme a seção "Adaptações por contexto".

## Princípios inegociáveis (valem para qualquer caso)

1. **Medir antes de reagir.** Nunca aceitar o tamanho da crise pelo relato do cliente — coletar números.
2. **Separar ASSUNTO de NARRATIVA.** O assunto (o fato: greve, operação, recall, escândalo) sempre tem alcance maior que a narrativa de ataque (a versão que culpa o monitorado). Reportar os dois e a proporção.
3. **Velocidade > total.** Medir os posts-chave 2x com ~25-30 min de intervalo. Post grande desacelerando está morrendo; post pequeno acelerando está nascendo. A vigilância segue a derivada, não o acumulado.
4. **Procurar a falha factual fatal da narrativa.** Toda narrativa de ataque apressada contém um erro verificável (no caso-referência: o "aliado do monitorado" era filiado ao partido do adversário). Esse fato vira o eixo do fact-sheet de blindagem.
5. **Verificar quem NÃO amplificou.** Adversários de grande alcance em silêncio definem o patamar da crise e o risco de escalada.
6. **Nunca recomendar atacar causa popular.** Se o fato-base tem lastro popular (salário atrasado, tragédia, consumidor lesado), quem o ataca colhe backlash — os comentários provam. O monitorado se solidariza com a causa e cobra solução.
7. **Arquivar tudo com timestamp.** Posts somem. Os datasets coletados são prova jurídica.

## FASE 1 — Enquadramento

Consolidar o intake num quadro: monitorado, narrativa, vetores conhecidos, datas, nível de alerta do playbook. Definir as queries de busca do caso (tema + praça, nos idiomas locais).

## FASE 2 — Coleta multiplataforma (paralela, em background)

Padrão Apify: disparar runs **assíncronas em paralelo** (POST `/v2/acts/{actor}/runs`), poll de status, baixar datasets com `?clean=true&fields=...`. Runs síncronas (`run-sync-get-dataset-items`, timeout≤280s) só para coletas pequenas. Pesquisar imprensa ENQUANTO coleta. Custo típico da varredura completa: US$ 1,50-2,50.

| Coleta | Actor | Input essencial |
|---|---|---|
| Posts de ataque (métricas) | `apify~instagram-scraper` | `{"directUrls":[urls],"resultsType":"posts"}` — normalizar `/reels/`→`/reel/` |
| Comentários (sentimento) | `apify~instagram-comment-scraper` | `{"directUrls":[urls],"resultsLimit":250}` |
| Perfis (seguidores=alcance) | `apify~instagram-profile-scraper` | `{"usernames":[...]}` — retorna `latestPosts` e resiste mais a bloqueio |
| Varredura de contas | `apify~instagram-scraper` | `{"directUrls":[perfis],"resultsType":"posts","onlyPostsNewerThan":"AAAA-MM-DD","resultsLimit":12}` — portais da praça + vetores + TODOS os adversários/candidatos + o próprio monitorado |
| TikTok | `clockworks~tiktok-scraper` | `{"searchQueries":["tema praça"],"resultsPerPage":25}` |
| X/Twitter | `apidojo~tweet-scraper` | `{"searchTerms":["tema praça"],"maxItems":150,"sort":"Latest"}` |
| YouTube | `streamers~youtube-scraper` | `{"searchKeywords":"tema praça","maxResults":25}` — **searchKeywords é STRING, não array** |

**Tratamento de falhas (obrigatório re-tentar):**
- `error: "not_found"` → handle errado. Descobrir o certo via web search (`"nome" instagram perfil @`).
- `error: "no_items"` + "Request got blocked" → perfil existe, scraper bloqueado. Re-tentar com `instagram-profile-scraper`.
- Conexão caiu (curl exit 56) → a run continua no servidor: `/v2/acts/{actor}/runs/last` → `defaultDatasetId` → baixar dataset direto.
- Reportar lacunas de coleta no relatório — nunca silenciar.

**Duas medições** dos posts-chave (~25-30 min de intervalo) para velocidade — a varredura de contas geralmente re-captura os posts de ataque; aproveitar.

**Disciplina de custo (a cobrança só acontece quando um actor raspa itens — nunca ao reler dados):**
- Antes de qualquer run: consultar o que já existe — banco do cliente (Dagster/SQL, se houver) e datasets de runs antigas da Apify (`GET /v2/acts/{actor}/runs` → `GET /v2/datasets/{id}/items`, releitura é grátis dentro da retenção do plano).
- **O filtro anti-redundância vai no INPUT do actor, nunca só na pós-filtragem**: `onlyPostsNewerThan=<watermark>` (IG), `resultsLimit = total_atual − já_armazenado` (comentários), operador `since:` na query (Twitter). Filtrar depois do download limpa o banco mas NÃO evita a cobrança.
- Teto duro por run: `maxItems` e `maxTotalChargeUsd` nas opções da run.
- Persistir datasets no armazenamento durável do cliente antes da retenção da Apify expirar (7-31 dias conforme plano); manter watermark e IDs únicos por fonte para dedup.
- Remedição de métricas dos mesmos posts NÃO é redundância — é observação nova (série temporal para velocidade), custo ~US$ 0,002/item.

## FASE 3 — Verificação de imprensa (paralela à coleta)

1. **Linha do tempo verificada** do fato-base (decisões judiciais com processo/juiz/tribunal; números oficiais com fonte).
2. **Checar cada alegação da narrativa** — é aqui que a falha factual fatal aparece (filiações, quem moveu ações, vínculos societários, números).
3. **Bolha vs. mainstream:** quem publicou a versão de ataque? Só blogs/influencers = bolha; imprensa de referência/TV = outro patamar. Fronteira mais importante do diagnóstico.
4. **Guerra de atribuição de culpa:** mapear quem culpa quem, com fonte.
5. **Contexto institucional atualizado** (quem governa/preside, alianças, cargos) — NUNCA confiar no mapa de atores do cliente sem verificar; no caso-referência o cliente listava como "aliado" um adversário ativo.

## FASE 4 — Análise

1. **Alcance do assunto** por plataforma (views; onde ocultas, estimar por taxa de curtida ~3% e SINALIZAR como estimativa).
2. **Alcance da narrativa** (subconjunto) e proporção sobre o assunto.
3. **Sentimento nos comentários** por buckets de regex adaptados ao caso (tema-base, nome do monitorado, adversários, acusação típica). Ler na íntegra: todos os comentários que citam o monitorado + os 10-15 mais curtidos. Likes = tração real; comentário hostil com 0 likes é ruído, não dano.
4. **Mapa de vetores**: conta, seguidores, alcance do ataque, conteúdo, status (ativo/estagnado/acelerando/a-verificar). "A verificar" = enquadre hostil sem citar o monitorado explicitamente — confirmar alvo antes de classificar.
5. **Indícios de coordenação** (indício, nunca prova): sequência temporal curta entre peças com mesmo enquadre; mesmo autor em veículos distintos; viralização >3x acima da base orgânica do autor.
6. **Nível de alerta:** VERDE (bolha, sem tração) / AMARELO (gatilho do playbook disparado mas contido, vetor de escalada identificado) / VERMELHO (mainstream ou figura de alto alcance amplificou).

## FASE 5 — Entregáveis (2 PDFs pareados)

HTML → PDF via Chrome headless:
`& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="saida.pdf" "file:///caminho/arquivo.html"`
Template em `report-template.html` (mesma pasta) — trocar o placeholder de marca pelo codinome do cliente. Nome dos arquivos: `Panorama_[Operacao]_[Tema]_[data].pdf` e `Anexo_Evidencias_Fontes_[Operacao]_[data].pdf`.

**PDF 1 — Panorama de Crise** (decisão executiva). Seções: 1-Sumário executivo com 4 KPIs + nível de alerta; 2-Linha do tempo + guerra de culpa; 3-Alcance por plataforma + ranking de contas; 4-Mapa de vetores + indícios de coordenação; 5-Sentimento; 6-Fatos de blindagem; 7-Riscos & gatilhos com ação-se-disparar; 8-Recomendações.
**Regras default (confirmadas no intake):** SEM emojis (setas tipográficas ok) · SEM citar ferramentas de coleta · SEM seção de metodologia/operação/custos · SEM listar canais fora de medição · rodapé: "Documento interno e confidencial · Evidências brutas arquivadas com timestamps, disponíveis para uso jurídico".

**PDF 2 — Anexo de Evidências e Fontes** (verificação/jurídico/imprensa). Blocos: conteúdos de ataque com links e métricas · derivados/ecos · cobertura factual linkada · plataformas secundárias · **matérias organizadas POR AFIRMAÇÃO do Panorama** (cada afirmação-chave com 3-7 fontes linkadas) · histórico do conflito. Cada bloco referencia a seção do Panorama que sustenta. Avisar: posts podem ser apagados — para uso jurídico valem as capturas arquivadas.

## FASE 6 — Recomendações (doutrina)

- **Silêncio estratégico enquanto a narrativa está na bolha:** responder a blog é promovê-lo. Resposta oficial só se: mainstream publicar, adversário de alto alcance amplificar, ou autoridade citar o monitorado nominalmente — então UMA resposta, no mesmo dia, com o fact-sheet.
- **Fact-sheet via terceiros** (jornalistas de confiança, aliados): deixar outros desmontarem a narrativa; se o desmentido já circula organicamente, abastecê-lo.
- **Tabela de gatilhos com ação pré-definida** para 48-96h.
- **Jurídico:** listar o que está arquivado; notificação/direito de resposta é decisão dos advogados, sempre pesando efeito Streisand. Autor que admite "boatos"/"rumores" no próprio conteúdo fortalece a tese.
- **Contra-programação positiva** na data crítica seguinte.
- Corrigir o mapa de atores do cliente quando a verificação revelar erros — com franqueza.

## Adaptações por contexto (o que muda entre crises)

- **Tipo de crise:** narrativa de ataque/conspiração (fluxo completo) · fake news factual (peso maior na Fase 3 + fact-check por afirmação) · vídeo viral único (peso em velocidade e comentários) · operação policial/judicial (linha do tempo institucional + processos) · crise corporativa/consumidor (trocar "adversários eleitorais" por concorrentes/órgãos de defesa; Reclame Aqui e Google Reviews entram na coleta).
- **Setor:** política (candidatos, partidos, calendário eleitoral, TSE) · empresa/marca (acionistas, reguladores, sindicatos, imprensa de negócios) · pessoa pública (fãs/haters, colunismo).
- **Praça e plataformas:** o mix padrão (IG+TikTok+X+YouTube) é para o Brasil; adaptar ao território e ao público (adicionar Facebook via scraping de páginas se for praça de interior; Kwai para público popular; LinkedIn para crise corporativa). Buscar sempre no idioma local com termos da praça.
- **Sem token de scraping (modo degradado):** operar só com WebSearch/WebFetch + leitura manual de posts públicos; ser explícito no relatório de que métricas de engajamento são parciais/estimadas e o sentimento é qualitativo.
- **Escala do pedido:** "quero um snapshot rápido" → só Fases 2 (posts de ataque + comentários) e 4, resposta em chat sem PDF. "Panorama completo" → fluxo inteiro. Perguntar no intake se houver dúvida.
- **Recorrência:** se o caso já tem relatório anterior (verificar memória do projeto), abrir com comparativo de evolução (views, novos vetores, mudança de nível de alerta) em vez de repetir o panorama do zero.

## Armadilhas conhecidas

- Comentário raivoso ≠ dano: sem likes é ruído. Medir tração, não existência.
- `videoPlayCount` null em muitos posts de IG — usar likes como proxy (taxa ~3%) e SINALIZAR.
- Datasets grandes: nunca ler o JSON inteiro no contexto — extrair com PowerShell/`ConvertFrom-Json` (agregados) ou `fields=` na API.
- Posts fixados furam `onlyPostsNewerThan` — filtrar por timestamp na análise também.
- O cliente chega com enquadre emocional ("greve criminosa", "é tudo mentira") — validar contra os dados antes de adotar; se os dados contradizem, dizer com franqueza e explicar o custo do enquadre errado.
- Handles de contas mudam entre praças — nunca chutar handle de veículo/político sem confirmar (web search primeiro, coleta depois).
