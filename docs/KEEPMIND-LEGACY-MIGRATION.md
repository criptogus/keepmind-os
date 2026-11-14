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
- Times: salas privadas com a mesma composição, sem respostas automáticas. O workflow antigo permanece no snapshot para conversão; sala não equivale ao executor de workflow.
- Skills: conteúdo e metadados de categoria/tags; pessoais ao proprietário, sem atualização automática. Vincular uma skill não autoriza suas ferramentas.
- Rotinas diárias: horário, dias e fuso explícito, sempre inativas. Intervalos relativos e webhooks ficam pendentes com os originais preservados, pois converter para cron mudaria a semântica ou reutilizaria tokens.
- Memórias: conteúdo, relações e supersessões em registros arquivados, não verificados e restritos a uma sala privada sem agentes. Validade, tipo e evidência originais permanecem no snapshot; nada entra no contexto ativo automaticamente.

Referências inexistentes, dados truncados ou itens rejeitados cancelam a transação do banco. Objetos de arquivos escritos durante uma tentativa podem permanecer no diretório isolado; não são publicados. O destino precisa ter somente o proprietário e nenhum agente alheio à importação. Este serviço não é exposto como endpoint ou ferramenta de chat.

## Antes da troca definitiva

Ainda é necessário mapear usuários/compartilhamento, limites de execução e gastos, permissões de ferramentas, workflows, intervalos/webhooks, modelos e evidências das memórias. Os valores originais são preservados, mas permissões sem equivalente não são concedidas. Conectores e tokens não são reutilizados automaticamente. Nenhum script libera o bloqueio operacional ou ativa rotinas.
