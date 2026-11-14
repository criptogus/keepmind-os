# Criação de times e aprovações

## Problema observado na 0.1.20

O teste real no Mac usou botões e texto livre para solicitar um time de marketing de palestras. Houve quatro aprovações separadas (status, lista de agentes e dois agentes). Os dois especialistas concluíram tarefas, mas nenhum registro de time foi criado. O assistente falhou com `Tool iteration limit reached` antes da síntese. Habilidades automáticas introduziram gravação de planilha e memória compartilhada; esta última foi recusada.

## Contrato preservado

| Capacidade | Novo acesso | Evidência |
| --- | --- | --- |
| Criar time com coordenação e especialistas | Uma operação no chat; formulário único fora do chat | Testes de persistência, atomicidade e idempotência |
| Escrever livremente ou usar alternativas | Mesmo compositor e botões | Fluxo real da 0.1.20 observado |
| Personalizar nomes, responsabilidades e conexão | Detalhes “Personalizar time e conexão de IA” | Campos preservados |
| Montar time vazio com agentes existentes | “Montar manualmente com agentes existentes” | Mesmo serviço e editor existentes |
| Templates e workflows especializados | Catálogo de templates e editor existentes | Caminhos mantidos |
| Primeira entrega completa e histórico | Execução real registrada no WorkManager, estado de revisão e conteúdo integral | Testes de entrega e falha do provedor |
| Aprovar criação/execução e ações externas | Um card de criação com objetivo, entrega e aviso de consumo | Política mantém criação, alterações e ferramentas desconhecidas protegidas |
| Configurar modelo, concorrência e retenção | Seção avançada identificada | Controles mantidos |
| Compreender aprovações antigas | Nomes legíveis derivados do tipo da ação | Teste de texto sem Markdown ou nomes internos |

## Mudanças

- O chat pergunta somente as lacunas essenciais e usa uma operação para criar coordenação, dois especialistas, time e primeiro pedido.
- Se o usuário pediu para começar, a mesma operação executa e retorna a entrega real; falhas ficam explícitas e não duplicam agentes.
- Novos times herdam o modelo do assistente no chat. Os especialistas de texto não recebem ferramentas extras por roteamento automático.
- Status e listas locais de agentes/times não interrompem o usuário; alterações continuam passando pelo mecanismo de aprovação.
- A criação manual e configurações avançadas continuam disponíveis, com menos campos simultâneos.

## Validação automatizada

256 testes unitários, 1 teste de integração, typecheck, build e smoke do Electron passaram. O smoke percorre o formulário único, confirma que só cria após a ação do usuário, verifica três agentes e primeiro pedido em rascunho, além dos cenários existentes de trabalho, recuperação, exportação e workspace compartilhado.

## Validação real do build corrigido no Mac

Depois da autorização das Chaves do macOS, o canal `marketing-simplificado` foi percorrido usando um botão para escolher empresas e resposta livre para detalhar oferta, público, prazo e primeira tarefa. Houve duas perguntas e uma aprovação de criação/execução. O time `Palestras IA — Marketing` foi persistido com coordenação, estrategista e criador de conteúdo.

As quatro execuções (assistente, coordenação e dois especialistas) terminaram como `completed`, sem erro. O pedido `6d1bdfd6-efaf-4bc0-98de-43c9016e9adf` ficou em `review`, com 7.898 caracteres de entrega integral. O chat exibiu plano de sete dias, post, métricas e direção para 30 dias, com Markdown formatado. As únicas ferramentas chamadas nessa execução foram criação de time e duas delegações; os especialistas não chamaram ferramentas externas. Nenhuma publicação ou mensagem externa foi realizada.

A tela única e a abertura da personalização por teclado foram inspecionadas no app. A build local mantém o número 0.1.20 e não é uma nova release oficial. A autorização de acesso às Chaves pode ser solicitada pelo macOS ao trocar o binário.
