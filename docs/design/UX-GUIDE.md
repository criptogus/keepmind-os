# Guia de UX: extrema facilidade

Regra norte: **a pessoa nunca deve pensar**. Se ela precisa de manual, de adivinhar o que um botão faz, ou de caçar uma opção, o design falhou. Este guia é obrigatório para qualquer mudança de interface em `apps/web`, `apps/mobile`, `apps/desktop` e `packages/ui`. O design system (cores, tipo, espaçamento, componentes) está em `DESIGN-SYSTEM.md`; a rotina de verificação está na skill `ui-polish` (`.claude/skills/ui-polish/SKILL.md`).

## Os 10 princípios

### 1. Uma ação primária por tela

Cada tela, diálogo e card tem **no máximo um** botão primário (o `primary` do kit). Tudo o mais é `default`, `ghost` ou link. Se dois botões parecem igualmente importantes, um deles está errado. A ação primária é sempre a que a maioria das pessoas quer naquela tela.

- Errado: card de meta com "Ativar", "Pausar" e "Arquivar" todos com o mesmo peso visual.
- Certo: o estado atual dita a ação. Meta `proposed` mostra "Ativar" como primária e as demais como ghost.

### 2. Verbos que dizem o que acontece

Botão, menu e diálogo nomeiam a ação e o alvo. Nunca "OK", "Confirmar", "Sim" ou "Continuar" sozinhos.

| Errado | Certo |
| --- | --- |
| OK | Aprovar merge |
| Confirmar | Criar canal |
| Excluir? Sim/Não | "Remover canal #geral" / "Manter canal" |
| Salvar | Salvar alterações |

Diálogos de confirmação nomeiam o objeto: "Remover o agente Ada?" não "Tem certeza?".

### 3. Feedback em menos de 100 ms

Toda ação do usuário produz resposta visual imediata: o botão entra em `loading`, a linha mostra estado otimista, o menu fecha. Se a operação é lenta, mostre progresso ou skeleton — nunca deixe a tela parada. Um spinner sem contexto é o último recurso; prefira mostrar o que está acontecendo ("Conectando ao servidor…").

### 4. Perdoar é melhor que confirmar

- Ação reversível (arquivar, pausar, editar) **não pede confirmação** — oferece Desfazer depois.
- Ação irreversível ou cara (excluir workspace, revogar acesso, gastar orçamento) pede confirmação **uma vez**, com o nome do objeto e a consequência.
- "Aprovar sempre" existe para ações sensíveis repetidas (ADR 0173). Não peça o mesmo OK 10 vezes.

### 5. Estado vazio ensina

Uma tela sem dados não mostra só "Nada aqui". Mostra o que vai aparecer ali e o próximo passo:

- Título do vazio + uma frase do que a seção faz + a ação que cria o primeiro item.
- Exemplo real da página Goals: "Metas são alvos mensuráveis que os agentes perseguem. Crie a primeira para começar." + botão "Nova meta".
- Nunca um vazio sem ação quando a tela existe para criar coisas.

### 6. Erro diz o que houve e como resolver

Formato: **o que aconteceu** + **o que a pessoa pode fazer**. Nunca código cru, nunca "Erro 500", nunca pedir desculpa sem saída.

| Errado | Certo |
| --- | --- |
| Erro ao salvar | Não foi possível salvar. Verifique sua conexão e tente de novo. |
| Token inválido | A chave do GitHub expirou. Gere uma nova em Configurações → Conectores. |
| 403 | Você não tem permissão para editar metas. Peça a um administrador. |

Todo erro que a pessoa pode resolver tem o caminho na própria mensagem ou um link/botão para ele.

### 7. Permissão se explica antes de bloquear

Se a pessoa não pode fazer algo, a interface diz **por quê e quem pode** — não esconde o botão nem mostra erro depois do clique.

- Botão desabilitado sempre tem motivo visível (hint, tooltip `Tip` do kit, ou texto ao lado).
- Read-only não é "tela quebrada": mostre os dados normalmente, sem ações de escrita.
- Exemplo: GoalsPage calcula `writer = can(org, "assign_work")` e simplesmente não renderiza as ações para quem não pode — mas a página continua útil (listar e acompanhar).

### 8. Complexidade atrás de Progressive Disclosure

O caminho feliz fica à vista; o resto mora a um clique:

- Ajuda e contexto atrás de ⓘ (`InfoHint`, `Field`/`SettingRow` `hint`) — nunca um parágrafo solto embaixo de cada campo.
- Configurações avançadas em seção "Avançado" ou diálogo, não no formulário principal.
- Detalhes (steps de um run, traces, IDs) no "Ver detalhes" ou no inspetor — não inline na conversa.
- Regra de texto: título + no máximo uma frase curta + controles. Se está explicando demais, provavelmente é dois controles ou um ⓘ.

### 9. Consistência é um superpoder

A pessoa aprende uma tela e sabe usar todas. Por isso:

- Mesma posição para busca, abas, filtros e ações primárias em toda página (regra de layout do ui-polish).
- Mesmo componente para o mesmo conceito: `Dialog` para confirmar, `Menu` para opções, `Select`/`SearchSelect` para escolher, `Tip` para hover, `GroupHeading` para agrupar listas.
- Mesmos estados na mesma ordem: loading → vazio → erro → dados.
- Se um padrão novo é realmente necessário, ele entra no kit (`packages/ui`) e varre todos os usos — nunca uma solução local que só existe numa tela.

### 10. Pensado para o polegar e para pressa

- Alvos de toque ≥ 44px no mobile; controles de 32px ganham alvo estendido sem engordar o visual.
- No celular, a ação primária de um card é full-width.
- Atalhos de teclado para o que se repete (⌘K, Enter para enviar). Todo fluxo principal é completável sem mouse.
- Nada essencial depende de hover: o que o hover revela existe também por toque (menu, long-press ou botão "…").

## Anti-padrões proibidos

- Botão ghost "Cancelar" no rodapé de diálogo — use o botão plain/default (regra do design system).
- `window.confirm`, `alert`, `prompt` nativos — sempre o Dialog do kit.
- Select, checkbox, radio ou menu com visual nativo do sistema.
- Emoji como ícone; bolinha colorida como status (sempre chip com ícone + palavra).
- Azul em qualquer coisa que não seja identidade de agente.
- Card inteiro tingido de cor de estado.
- Texto cortado com reticências onde a informação importa — envolva ou dê `Tip`.
- Spinner solto sem dizer o que está carregando.
- Parágrafo de ajuda permanente embaixo de formulário.
- Confirmação para ação reversível.
- Duas ações primárias na mesma região.
- Tela sem saída: todo fluxo longo tem cancelar/voltar; toda falha oferece retry.

## Copy: regras duras

- Português do Brasil por padrão; frases curtas, voz ativa, sem exclamações, sem emoji na interface.
- **Sem ponto e vírgula. Sem travessão** (exceção: cabeçalhos de grupo tipo "DONO — 1").
- Botões com verbo + objeto. Títulos dizem o que a tela é. Vazio diz o que vai aparecer.
- Números de máquina precisos e por extenso: "sonnet 5.5 · 1.240 tokens · US$ 0,004".
- Erros: o que houve + como resolver. Nunca pedir desculpas sem ação.
- Todo texto novo passa por i18n: `packages/i18n` (web) e `apps/mobile/src/features/i18n` (mobile). Adicionar chave em `en`/`pt-BR` e revisar `identical.json`/locales.

## Templates que resolvem 80% dos casos

**Vazio:**
> {Título do que vai aparecer aqui}. {Uma frase: o que isso faz ou por que importa}. [Botão: verbo + objeto]

**Loading:** skeleton da forma final da lista/card (nunca spinner no lugar da página inteira). Dentro de botão: `loading` do kit.

**Erro:**
> Não foi possível {ação}. {Causa provável, se souber}. [Tentar de novo] [Caminho alternativo, se houver]

**Confirmação destrutiva:**
> {Verbo} {objeto pelo nome}? {Consequência em uma frase, irreversível se for}. [Ação destrutiva] [Cancelar como botão plain]

**Sem permissão:**
> Você não pode {ação}. {O que veria se pudesse, ou quem pode fazer}.

## Checklist antes de chamar uma tela de pronta

1. Qual é a ação primária? É a única com peso?
2. A pessoa consegue completar a tarefa sem ler texto de ajuda?
3. Todo botão diz o que faz? Todo erro diz como resolver?
4. Existe estado vazio com próxima ação? Loading? Erro com retry?
5. Quem não tem permissão entende por quê?
6. Funciona a 390px e 1280px, claro e escuro, com texto longo e lista vazia/grande?
7. Nada depende de hover para informação essencial?
8. i18n: a tela lê chaves, não strings soltas?

Se qualquer resposta for não, a tela não está pronta.
