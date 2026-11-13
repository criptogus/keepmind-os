# Conversa, versões e integrações — verificação de 13/11/2026

## Resultado do teste real

Na instância isolada KeepMind-PR11-Test, o time de marketing tem três agentes persistidos: coordenação, estrategista e criador de conteúdo. Os três concluíram a primeira entrega e a revisão anterior. No novo teste, um único clique em **Enviar ajuste** iniciou a versão 3, sem clicar em Iniciar. A interface mostrou **Preparando a versão 3**, preservou a versão 2 e apresentou **Entrega · Versão 3**, com aprovação na conversa. O pedido tornou o conteúdo genérico para produtos e serviços. Não foi feita publicação, envio de mensagem, aprovação da entrega ou merge.

O chat mantém mensagens do cliente e versões do time, identifica o agente, oferece resposta recolhível, aprovação ao lado da entrega e compositor fixo. Notas durante a execução são registradas e incluídas na próxima revisão; não são mensagens transmitidas instantaneamente a uma execução já em andamento.

## Materiais

A entrega ou um artefato de texto pode ser visualizado como documento ou apresentação e exportado como PDF real ou PowerPoint editável. O PDF é renderizado em uma janela isolada, sem scripts, preload ou recursos remotos. O PowerPoint usa um modelo simples com texto editável e paginação em slides; não é uma ferramenta de design generativo de slides. A prévia indica que a paginação final do PDF pode variar. O conteúdo original permanece no chat.

Verificações: assinatura PDF na integração Electron; pacote PPTX aberto como ZIP e texto/quantidade de slides conferidos em teste; acentos em português; HTML ativo escapado; limite de 30 mil caracteres por exportação. Revisão visual das telas de conversa e prévia. Os arquivos não são enviados a um serviço externo para exportação.

## Criação automática de agentes e skills

- **Guia de criação:** cria agentes, time e primeiro pedido em uma transação local, somente após confirmação. Falha reverte banco e estado em memória; repetição usa a mesma identidade e não duplica. Quatro prioridades e o rollback estão cobertos por testes.
- **Criação por outro agente:** a ferramenta `create_agent` existe, cria um especialista com vínculo ao agente responsável e registra auditoria. A política exige aprovação humana. O encaminhamento dos argumentos é testado; não foi autorizada uma criação adicional por LLM no teste real.
- **Skills:** o guia não cria skills nem atribui IDs de skills; a inspeção da instância confirmou zero skills atribuídas aos três agentes e zero skills novas desde a criação do time. Há skills pré-instaladas, criação/edição manual, importação por GitHub e melhoria assistida de um prompt existente. `create_agent` associa skills existentes por nome; não gera novas skills.
- **Roteamento automático:** pode ativar até duas skills existentes por coincidência de palavras. Isso não é análise semântica nem treinamento. Skills podem acrescentar ferramentas à execução, mesmo que não apareçam em `config.tools`; portanto, não se deve tratar a lista inicial de ferramentas do agente como limite absoluto.

Fontes locais: `src/main/work/BusinessTeamSetup.ts`, `src/shared/businessTeams.ts`, `src/main/main.ts` (createAgent e setAutoSkillSelector), `src/main/agent/AgentManager.ts` (resolveSkills e enabledToolNames), `src/renderer/components/skills/SkillsPanel.tsx`.

## Guardrails: o que existe e seus limites

- Escrita de arquivos, shell, mensagens externas, criação de agentes, escrita no cérebro corporativo e ferramentas externas desconhecidas pedem aprovação. Delegação e leituras consideradas rotineiras podem executar automaticamente. Aprovação está vinculada aos argumentos e à execução; o novo chat mantém esses controles.
- Permissões por função, limites de acesso ao computador e filtros de ferramentas são aplicados durante a execução. Restrições escritas no prompt não equivalem a controles de acesso.
- O limite mensal bloqueia chamadas quando configurado. **Os times criados pelo guia não recebem um teto financeiro por padrão.** Há registro de consumo e aviso antes de iniciar/revisar; isso não equivale a orçamento limitado.
- MCP só recebe leitura automática quando o proprietário autoriza uma ferramenta específica e o servidor declara leitura sem efeito destrutivo; anotações do servidor sozinhas não concedem acesso.
- Checkpoints evitam repetir efeitos incertos, e cancelamento/expiração encerram aprovações pendentes. A revisão começa nova execução e mantém os controles existentes.
- Proteção de dados pessoais no Second Brain: bloqueia padrões como CPF/telefone/cartão; a avaliação semântica exige chave de API. Em configuração somente OAuth, fica apenas a checagem por padrões. A avaliação semântica falha de modo permissivo quando indisponível. **Não é garantia de bloqueio de todos os dados pessoais.**

Fontes: `ActionPolicy.ts`, `main.ts` (constraints, approval gate, budget checker), `McpManager.ts`, `PiiJudge.ts`, testes `autonomy`, `tools`, `agent-manager`, `checkpoint`, `second-brain` e `pii-judge`.

## Second Brain

Conexão em **Mais ferramentas → Avançado → Segundo Cérebro**: URL do servidor KeepMind Corp, token, modo de leitura/escrita, proteção de dados pessoais e **Salvar e testar**. Usa POST em `/api/mcp/call` com bearer token e ferramentas `sb_search`/`sb_append`; não é o OAuth do provedor de IA. O token persistido usa o armazenamento de credenciais.

Sem configuração, o time continua gerando entregas com o pedido e o contexto disponível; não recebe memória corporativa. A memória pessoal local é separada. A configuração desta instância não tem Second Brain ativo, e as entregas reais foram concluídas assim.

Se o servidor estiver configurado mas indisponível, a busca devolve vazio; o teste de conexão retorna erro. Esse fallback evita travar a geração, mas hoje **não mostra na conversa que a busca corporativa falhou**. Com conexão ativa, a busca de contexto é aplicada globalmente pelo provedor de contexto, não apenas a agentes com uma skill selecionada. Leituras/escritas explícitas têm suas próprias ferramentas e guardrails.

Os testes cobrem ausência de credenciais, servidor indisponível, escrita em modo somente leitura, bloqueio de PII e envio autorizado por `sb_append`. **Não houve conexão real a um servidor corporativo**, pois não foi fornecido um servidor/token para este teste.

## Super Agent Skill e OAuth

**Não há conector OAuth do superagentskill.com na área de skills do KeepMind OS nesta branch.** Essa área oferece criação manual e importação GitHub; o editor de agentes permite selecionar skills. O MCP genérico suporta stdio ou HTTP com bearer lido de variável de ambiente, sem provedor OAuth, descoberta, login ou renovação OAuth.

A [documentação oficial do serviço](https://superagentskill.com/docs/mcp) publica o endpoint `https://superagentskill.com/api/public/mcp` e configuração OAuth. A [página de conexão](https://superagentskill.com/connect/codex) diferencia leituras anônimas e ferramentas de escrita autenticadas por OAuth/token. Isso prova disponibilidade do lado do serviço, não integração pronta no KeepMind OS. Não instalamos nem concedemos acesso ao serviço durante a auditoria.

Para implementar essa integração, faltam uma conexão visível, autorização OAuth/PKCE, armazenamento e renovação de credenciais, cancelamento/desconexão, e escolha explícita das permissões de leitura e escrita. Não foi adicionado um botão de login que não funciona.

## Validação desta atualização

`npm run verify:ux` passou: 169 testes unitários, 1 teste de integração HTTP, typecheck, build, runner, 16 verificações Electron e varredura de segredos sem achados. Regressões incluem início automático local/compartilhado, duplicação concorrente, histórico de versões, falha e retomada de revisão, ausência/falha do Second Brain, PDF e PPTX. O script e a skill existentes foram ampliados.

Jev foi usado como checagem semântica das conclusões: modelo jev-1.14.0, 649 tokens de entrada e 91 de saída. Classificou como não sustentadas as alegações de criação automática de skills, OAuth SAK já integrado e proteção completa de custo/PII (probabilidade 1.0 para cada uma). Isso é uma revisão auxiliar, não substitui as evidências do código e dos testes. Payload e resultado em `evidence/semantic/integration-audit-*.json`.

Exportação manual da entrega real pela UI validada: PDF com 1 página e texto extraído corretamente; PPTX com 2 slides e texto editável presente no pacote. Arquivos locais `Downloads/entrega.pdf` e `Downloads/entrega.pptx`. Resultado sanitizado em `evidence/live-chat-test.json`.
