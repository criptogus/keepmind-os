---
name: keepmind-crm-intelligence
description: Analisa conversas autorizadas para atualizar perfis profissionais, compromissos e contexto de relacionamento com evidências; use ao preparar reuniões, revisar interações ou organizar o CRM.
---
# Inteligência de relacionamentos

Transforme conversas em contexto útil para os agentes e em decisões concretas para a pessoa. Um perfil é memória factual e revisável, não um diagnóstico de personalidade.

## Contrato de execução no KeepMind OS
Use os conectores e ferramentas MCP disponíveis na execução, sem presumir nomes ou acesso. Descubra o CRM e a memória canônica antes de criar registros. No second brain existente, procure `People/`, `Companies/`, aliases e o ledger `00-Hermes/crm/interactions.jsonl`; não crie um CRM paralelo em `crm/people`. Esses caminhos são referências de descoberta, não autorização de escrita direta. Use a API de atualização disponível, respeitando revisões e permissões; se só houver leitura, entregue o patch proposto com alvo e evidência, marcado como não aplicado. Não altere criptografia ou configuração de acesso.

## Conversa → perfil → ação
1. Delimite pessoas, canais e período autorizado. Leia somente o contexto necessário e o estado anterior. Registre cobertura e última sincronização: dados ausentes ou antigos não significam ausência de contato.
2. Resolva identidade por identificador estável, telefone/e-mail normalizado e aliases existentes. Nome isolado, homônimo, menção no corpo ou nome de arquivo não bastam para criar/fundir pessoas. Preserve ambiguidades para revisão.
3. Extraia eventos com fonte, autor e data: contexto profissional, empresa/papel declarado, projetos, interesses explicitamente mencionados, compromissos meus/deles, prazo expresso, resposta e resultado observado. Distingua promessa, intenção e conclusão. Não invente prazo ou oportunidade comercial.
4. Atualize o perfil por diferenças: cada afirmação traz fonte, trecho curto, data de observação e estado (declarado, observado, hipótese ou contradito). Preferências de canal/tom só entram quando declaradas ou sustentadas por exemplos; marque inferências como provisórias. Não infira saúde, religião, política, sexualidade, vulnerabilidades ou traços psicológicos. Não use informações pessoais para pressionar ou manipular.
5. Preserve contradições e histórico, arquive versões substituídas e vincule evidências sem replicar conversas completas. Deduplicate por canal + ID do evento + pessoa. Reprocessar o mesmo lote não cria novos eventos. Não promova nem rebaixe prioridade estratégica manual sem autorização.
6. Prepare ações por compromisso explícito, prazo, projeto ativo e contexto recente. Uma ação traz pessoa, motivo verificável agora, próximo passo e rascunho contextual quando útil. Se o ledger estiver velho, recomende atualizar a fonte, não cobrar alguém. Resposta nova, resolução ou dispensa invalida a recomendação anterior.

## Entrega e aprendizado
Resumo inicial: resultado em uma frase; contagem de perfis realmente atualizados, compromissos extraídos e ambiguidades. Para cada alteração disponibilize antes/depois, fontes e como desfazer. Separe preparado/aplicado/verificado. Para cada proposta use um ID estável ligado à pessoa e ao compromisso, permitindo resolver, dispensar ou adiar sem reaparecer sem fato novo.

Registre feedback apenas na memória autorizada: motivo de dispensa, edição aceita e resultado observado. Atualize preferências explícitas; uma dispensa não significa antipatia ou falha da pessoa. Avalie precisão de identidade, compromissos confirmados e correções solicitadas. Não conte mensagens preparadas como relações fortalecidas ou receita gerada.

Enviar mensagens não faz parte da análise: entregue rascunhos e use apenas políticas de envio já configuradas quando houver uma tarefa de envio autorizada. Falta de conector, rotina ou permissão deve ser explícita. Este skill não instala cron nem mantém execução em segundo plano por si só.
