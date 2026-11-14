# Migração do KeepMind OS legado

Esta etapa prepara uma cópia isolada para conferir dados e permissões. Não faz a troca do banco do app nem publica dados no servidor compartilhado.

## Executar sem login ou serviços externos

```sh
python3 apps/server/scripts/keepmind-legacy-snapshot.py '/caminho/keepmind-os.db' '/diretorio/novo/backup' America/Sao_Paulo
bun apps/server/scripts/keepmind-legacy-stage.ts '/diretorio/novo/backup/legacy.json' '/diretorio/novo/validacao'
```

Os dois destinos devem ser novos. O snapshot usa a API de backup SQLite (incluindo WAL confirmado), verifica integridade e abre a origem somente para leitura. Arquivos são privados ao usuário do sistema. O backup completo pode conter segredos: não enviar ao Git, chat ou armazenamento público.

A segunda etapa cria um PostgreSQL local via PGlite, sem servidor HTTP, workers, modelo ou conectores. Importa, fecha e reabre o banco e repete a operação para verificar persistência e ausência de duplicatas. `report.json` guarda IDs de origem/destino e pendências; `source.json` preserva os registros originais. O SQLite completo preserva também configurações e dados fora do escopo.

## O que chega à nova estrutura

- Agentes: instruções e vínculos com skills e gestores; parados por bloqueio operacional, acesso somente ao proprietário, sem credenciais ou permissões de ferramentas.
- Times: salas privadas com a mesma composição, sem respostas automáticas. O workflow antigo é preservado no snapshot e convertido em draft no relatório privado; sala não equivale ao executor de workflow.
- Skills: conteúdo e metadados de categoria/tags; pessoais ao proprietário, sem atualização automática. Vincular uma skill não autoriza suas ferramentas.
- Rotinas diárias: horário, dias e fuso explícito, sempre inativas. Intervalos relativos e webhooks ficam pendentes com os originais preservados, pois converter para cron mudaria a semântica ou reutilizaria tokens.
- Memórias: conteúdo, relações e supersessões em registros arquivados, não verificados e restritos a uma sala privada sem agentes. Validade, tipo e evidência originais permanecem no snapshot; nada entra no contexto ativo automaticamente.

Referências inexistentes, dados truncados ou itens rejeitados cancelam a transação do banco. Objetos de arquivos escritos durante uma tentativa podem permanecer no diretório isolado; não são publicados. O destino precisa ter somente o proprietário e nenhum agente alheio à importação. Este serviço não é exposto como endpoint ou ferramenta de chat.

## Antes da troca definitiva

Ainda é necessário mapear usuários/compartilhamento, limites de execução e gastos, permissões de ferramentas, workflows, intervalos/webhooks, modelos e evidências das memórias. Os valores originais são preservados, mas permissões sem equivalente não são concedidas. Conectores e tokens não são reutilizados automaticamente. Nenhum script libera o bloqueio operacional ou ativa rotinas.

## Preparação de permissões e workflows

O relatório privado inclui `preparation`: IDs de origem e destino, digest do snapshot, controles antigos, equivalências e bloqueios. Ele é comparado novamente após fechar/reabrir a base. `readyForCutover` permanece falso; o relatório não é uma autorização e não existe endpoint de execução desses drafts.

| Controle legado | Tratamento nesta etapa |
| --- | --- |
| Teto mensal em USD | Conversão conservadora para nano-USD e gravação no campo nativo; zero permanece zero, valores negativos/fora da faixa são recusados. Ausência não inventa um teto. |
| Rede, arquivos e código | Flags preservadas no relatório. Nenhum escopo amplo é concedido: o computador e conectores novos podem reunir capacidades diferentes. |
| Ferramentas atribuídas | Nomes inventariados; configurações/segredos não entram no plano de permissões. Recurso e identidade ainda precisam ser mapeados. |
| Compartilhamento | Restrito ao proprietário na cópia. Usuários/roles antigos são capturados no snapshot privado, sem criar contas ou conceder acesso. |
| Tempo e quantidade de execuções | Ambos os campos de tempo são registrados: o executor legado usa `config.executionTimeoutSeconds` (padrão 300), não `permissions.maxExecutionTime`. O prazo persistente e a cota transacional do executor estão detalhados abaixo. |
| Governança | Snapshot inclui `governance_rules`; quantidade/estado de captura constam do relatório. Zero regras não significa ausência de políticas embutidas no executor. |

Workflows são convertidos em drafts estruturados, com modo, ordem, entradas, condições, dependências e IDs nativos dos agentes/salas. A composição do time é validada; referências ausentes, IDs duplicados, ciclos e condições fora da gramática são recusados antes da importação. Um workflow vazio permanece vazio.

O simulador não chama IA, ferramentas ou callbacks: recebe saídas fictícias explícitas. Valida os lotes paralelos, o merge de contexto na ordem de origem, a precedência das entradas da etapa, a interrupção sequencial e o bloqueio de dependentes quando uma condição não passa. Uma etapa ignorada aparece como `skipped`, sem simular uma execução bem-sucedida. O relatório real inclui esse trace, sem afirmar que tarefas foram executadas.

A etapa descrita acima preparou os drafts; o executor e os controles de tempo/quantidade implementados depois estão detalhados abaixo. Ainda faltam equivalência dos recursos externos e vínculo das identidades reais. Agentes permanecem sob bloqueio operacional durante toda esta preparação.

## Executor nativo e limites persistentes

A migração agora grava drafts em `legacy_workflows` e políticas desabilitadas em `legacy_agent_policies`. O serviço interno `startLegacyWorkflow` exige permissão de gerenciamento, a identidade proprietária e um draft explicitamente habilitado; não há liberação automática pelo importador. O worker `keepmind_workflow.advance` cria os runs na fila nativa, guarda os IDs das etapas na mesma transação e lê os resultados novamente do banco a cada avanço. A repetição de um pedido com o mesmo identificador não duplica a execução; entradas diferentes com esse identificador são recusadas.

Etapas sequenciais, lotes paralelos e condições usam os mesmos agentes e salas privados. Um lote só fornece contexto ao próximo depois que seus membros terminarem. A saída precisa ser um objeto JSON válido no resultado do run: erro ou texto livre não é convertido em sucesso. Falhas e etapas bloqueadas permanecem no histórico. Os gatilhos do workflow não passam novamente pelo roteador de chat; respostas dos agentes migrados não iniciam delegações por menção.

O primeiro adaptador executável é **somente texto pelo provedor nativo de modelos**. Não habilita ferramentas, conexões, arquivos, execução de código ou planos por conector de computador. O bloqueio alcança a lista de ferramentas, chamadas diretas, chamadas por diretório e aprovações antigas. Esse é um subconjunto conservador para validação, não equivalência funcional com todas as ferramentas antigas.

Os controles se aplicam também a runs desses agentes iniciados por outras entradas:

- Reserva transacional de execuções por agente/mês UTC; retries do mesmo run não consomem a cota outra vez. O padrão legado de **1.000 execuções/mês** é preservado quando omitido. Valores inválidos são recusados.
- Prazo persistente por run, com sinal de cancelamento do executor/provedor. Retomar ou reiniciar o worker não renova o prazo. Uma verificação periódica aborta runs quando a política ou o workflow são revogados; a interrupção de streams depende do mecanismo nativo de cancelamento.
- Validação de proprietário, organização, associação ao time, sala privada e bloqueio operacional. Um agente com brain de computador é recusado antes da chamada.
- Histórico de uso capturado do SQLite: contagens anteriores entram na cota; gastos anteriores entram uma única vez nos períodos de orçamento nativos. A fonte alterada exige uma cópia nova, para não somar o mesmo histórico duas vezes. Snapshots sem histórico não podem ser liberados.

O relatório inclui a conferência dos drafts, políticas e saldos após fechar/reabrir o banco. A cópia real continua sem nenhum workflow ou política habilitados. O executor foi validado com o pipeline nativo e provedor simulado, sem acesso às contas reais de IA.

Para a troca definitiva ainda faltam os adaptadores de ferramentas/recursos com equivalência de permissões, a vinculação das identidades e credenciais reais, validação com o provedor real e a decisão de corte sobre um snapshot atualizado. A interface de ativação não foi publicada. O app antigo permanece disponível e o backup completo mantém os dados fora do escopo.
