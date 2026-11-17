# KeepMind OS — skills de inteligência

Pacotes locais v1, compatíveis com `importSkillsFromFolder`. Importar a pasta de cada skill em Skills → importar pasta e associar ao agente que executará a tarefa. A importação não cria cron, não conecta canais e não concede ferramentas: o agente usa apenas ferramentas configuradas e permitidas.

- `keepmind-crm-intelligence`: perfis profissionais e ações sustentados por conversas e memória canônica.
- `keepmind-post-reverse-engineering`: módulo opcional; importar/associar somente quando desejado. Hipóteses sobre desempenho, adaptação original e experimento pré-definido.
- `keepmind-software-reconstruction`: especificação comportamental, arquitetura e testes de paridade. Referência REA: https://github.com/morluto/rea; o prompt não instala nem substitui o servidor REA.

Os prompts são autocontidos porque o importador do OS registra anexos mas não os injeta automaticamente no prompt. Nenhum nome de ferramenta é imposto: os conectores disponíveis variam por agente. Sem ferramenta necessária, o resultado deve ser marcado como proposto ou bloqueado, nunca como aplicado.

Validação comportamental antes de habilitar rotinas: homônimos e promessa não cumprida no CRM; post popular sem baseline na análise social; backend desconhecido e falha no teste de paridade em software. Importação válida não comprova eficácia dos prompts em modelos reais.
