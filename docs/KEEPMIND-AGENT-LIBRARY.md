# Biblioteca de agentes KeepMind

## Entrega

O fluxo de criar agentes mantém os pontos de partida existentes e adiciona Cybersec, Consultoria, Estratégia e Tendências. Marketing, Vendas, Desenvolvimento e Finanças receberam instruções mais completas de diagnóstico, execução e verificação. Os perfis inspirados são Elon Musk, Bill Gates, Warren Buffett, Jack Welch, Steve Jobs, Jack Ma, Guy Kawasaki, Jeff Bezos, Satya Nadella e Peter Drucker.

São adaptações editoriais independentes, com nomes e companheiros KeepMind próprios, não réplicas de pessoas reais, endossos, citações ou simulações de opiniões atuais. Cada perfil define raciocínio, ação, comunicação, entregas, limites e três tarefas iniciais. As referências públicas ficam nas instruções editáveis do perfil; não são instruções externas a obedecer.

## Preservação

| Capacidade | Acesso | Verificação |
| --- | --- | --- |
| Criar do zero e importar | Mantidos no fluxo existente | Suite de criação |
| Starters pessoais | Mantidos; biblioteca de áreas também disponível | Teste de workspace pessoal |
| Ajustar nome, instruções, skills, aparência, modelo e acessos | Mesmo cartão/formulário existente | Teste de alternância de perfil e persistência do payload |
| Buscar perfis | Busca por área, nome e referência no diálogo | Filtro, vazio e Enter sem criação involuntária |
| Permissões | Novos especialistas/perfis começam sem conectores implícitos, inclusive no modo pessoal | Matriz de níveis por template/modo |
| Mobile | Mesmos dados e grupos no formulário nativo; web mantém cartão em segunda etapa | Typecheck mobile; inspeção responsiva web |

## Limites

A escolha de template preenche o agente; não ativa ferramentas inexistentes, não instala skills automaticamente nem concede um plano Liquid. O perfil Cybersec pode preparar uma análise com os dados fornecidos; uso da Liquid requer assinatura verificada e autorização de escopo. Modelos, ferramentas e skills dependem da configuração e das permissões reais.

Português e inglês têm conteúdo próprio. Novas chaves usam fallback inglês explícito nos demais idiomas. Instruções antigas dos quatro perfis aprimorados continuam localizadas nesses idiomas até tradução da nova extensão.

A validação usa testes com API simulada e inspeção visual de um workspace sintético. Não demonstra fidelidade psicológica nem execução com IA real. Nenhum agente foi criado na conta do usuário durante esses testes.

## Evidências

- Suite de criação, templates, níveis e idiomas: 90 testes passaram, sem falhas (968 asserções).
- Verificação após ajustes finais de texto e aliases: 36 testes passaram, sem falhas (379 asserções), incluindo CSS existente e remoção de acesso aos conectores na requisição final de criação.
- Typechecks de web, client e mobile passaram.
- Inspeção independente de quatro capturas desktop/mobile: `ship`, sem regressões materiais na extensão. Não equivale a teste de IA ou de usabilidade com participantes.
- JEV revisou a mudança de seleção/permissões: pontuações de baixa confiança, sem achado concreto; não foi tratado como aprovação. Uso: 5.149 tokens de entrada / 79 de saída.
- Ajuste final de teclado: quando a busca esconde a seleção, Do zero permanece alcançável por Tab; as setas partem da opção focada. Teste específico: 3 passaram, 0 falhas, 100 verificações. Revisor independente confirmou resolução, mantendo válida a revisão visual anterior.
- Reconciliação de design: DESIGN.md e .impeccable/design.json preservados; não surgiram novos tokens globais.
- JEV conferiu três afirmações de entrega e limites contra código, testes e relatório: três sustentadas, nenhuma contradita (3.595 tokens de entrada / 132 de saída).
- Build de produção final concluído, incluindo a correção de teclado e as apresentações finais dos perfis. Frontend copiado para o runtime local existente; banco de dados e configurações não foram alterados. Não foi publicada uma release nem substituído o instalador nativo.
