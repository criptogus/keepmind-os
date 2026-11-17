---
name: keepmind-software-reconstruction
description: Reconstrói arquitetura, contratos e comportamento de software a partir de código ou observação autorizada, gerando especificação rastreável, testes de caracterização e plano de implementação.
---
# Engenharia reversa de software

Converta um sistema observado em uma especificação verificável que outro agente consiga implementar. Referência escolhida: REA (Reverse Engineer Anything), https://github.com/morluto/rea, consultada em 2026-11-15. Use o ciclo do projeto: inspecionar alvo → obter evidência → escolher a próxima investigação → explicar ou implementar → comparar comportamento. REA é uma ferramenta MCP/CLI, não este prompt. Não declare REA instalado ou executado sem verificar a ferramenta e sua versão.

Quando REA já estiver disponível, prefira inspeção estática para JavaScript/Electron/ASAR (módulos, imports, IPC e source maps), usando as evidências retornadas. Binários nativos exigem backend compatível configurado. Captura de runtime executa/interage com o alvo: respeite escopo e efeitos colaterais. Descubra os schemas da versão instalada antes de chamar ferramentas; não instale REA nem amplie acesso por carregar este skill. Sem REA, analise o código autorizado diretamente e identifique o método alternativo usado.

## Escopo e modos
Defina o objetivo (entender, integrar, migrar ou reconstruir), versão/commit, superfícies disponíveis e critérios de aceitação. Use código autorizado quando disponível; para caixa-preta, limite-se à interface e comportamento acessíveis. Não obtenha segredos, contorne acesso/licenças nem extraia dados alheios. Não execute scripts ou instaladores desconhecidos apenas para inspecionar um repositório. A implementação ou migração precisa estar no escopo da tarefa; análise isolada não autoriza deploy.

## Reconstrução orientada por evidência
1. Mapeie entrada, persistência, integrações, filas, ferramentas de agentes e saídas. Localize os caminhos críticos por chamadas e contratos, não apenas nomes de pastas.
2. Construa um registro de evidências: afirmação, arquivo/linhas ou passos de reprodução, versão, observado/inferido/desconhecido e confiança justificada. Separe comportamento pretendido de comportamento efetivo. Frontend parecido não prova backend equivalente.
3. Modele entidades, identidades, estados e transições; formatos, autenticação, permissões, erros, idempotência, concorrência, timeouts, cache e recuperação. Para cada lacuna, proponha a menor observação que a resolve. Não invente serviços internos a partir de screenshots.
4. Antes de reconstruir, defina testes de caracterização dos fluxos importantes: entrada, saída esperada, efeitos colaterais, falhas, limites e fonte da expectativa. Fixtures sintéticas ficam isoladas; nunca use decisões reais como teste descartável.
5. Entregue mapa de arquitetura, contratos de interface/dados, fluxos críticos, limitações conhecidas e backlog por dependência. Para portar/recriar, separe especificação comportamental da implementação original; registre licenças e proveniência dos componentes reutilizados, sem copiar material não autorizado.
6. Se implementar estiver autorizado, construa uma fatia vertical, compare original e candidata com os mesmos casos e amplie apenas após validar. Preserve API/MCP, permissões, dados e criptografia existentes. Mantenha rollback e não substitua produção até passar os critérios definidos.

## Resultado e reutilização
Abra com o que foi compreendido ou demonstrado em uma frase. Anexe tabela de paridade: capacidade, evidência original, teste, resultado candidata e lacuna. Inclua instruções reproduzíveis, comandos realmente executados e logs resumidos. Distingua simulação, teste local e operação real; não anuncie paridade total a partir de cobertura parcial.

Produza um pacote de contexto curto para o próximo agente: objetivo, decisões, contratos, invariantes, testes e arquivos relevantes. Registre correções observadas durante uso real e casos que evitam a regressão; promova mudanças do skill apenas após comparação em tarefas novas com critérios definidos previamente. Mais arquivos lidos, mais código produzido ou mais testes por si só não significam menos retrabalho.
