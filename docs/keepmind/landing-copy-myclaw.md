# Landing page — benchmark MyClaw e copy proposta

Fonte: https://myclaw.ai/pt-BR (capturado 2026-11). Produto mais próximo do nosso
posicionamento ("equipe de IA que trabalha enquanto você dorme"). Este doc registra
o que copiar, o que não copiar, e a copy proposta para keepmind.io.

## O que o MyClaw faz bem

1. **Taxonomia em uma frase**: agente (teammate com papel) → runtime (motor:
   OpenClaw, Hermes, Claude Code, Codex, DeepSeek Harness) → modelo. Nós temos a
   mesma estrutura (agent → brain `claude_code`/`model` → modelo/endpoint) mas a
   copy não explica. Explicar isso no onboarding elimina a confusão "por que meu
   agente falhou no brain auto".
2. **Multi-runtime vendido como headline**, não como detalhe: "escolha o runtime
   que combina com o trabalho". Para nós: "roda no Claude Code ou no modelo que
   você escolher" — Claude Code é nome que o público dev já confia.
3. **Memória demonstrada em 3 passos** (primeira conversa → um pouco depois → na
   próxima vez): vende valor sem falar de arquitetura. Nosso wiki/memória existe;
   falta essa demo.
4. **Números concretos de infra** ("50+ modelos", "sempre ligada") geram confiança.
5. **Templates nomeados por papel** visíveis antes do cadastro.

## Onde somos melhores (nosso ângulo)

- **Aprovações granulares**: eles dizem "review the work"; nós temos aprovação por
  ação, propostas de agente e audit trail. Mais forte pra confiança.
- **Self-host**: eles são cloud-only ("your agent's computer, always on"). Nosso
  keepmind.io self-hostável é diferencial que eles não têm.
- **WhatsApp nativo**: bridge próprio funcionando, não só "canal suportado".
- **Agentes criando agentes pelo chat**: magic moment que eles não mostram
  ("pede pro Kivo criar o Vetor" é literalmente nossa demo).
- **Conectores OAuth prontos**: Granola, Linear, Notion etc. com um clique.

## Onde eles são mais fracos

- FAQ genérica ("What can I put my agents to work on?") vs. nossas perguntas reais.
- Sem self-host, sem auditoria, sem permissão por ação.
- Sem prova do fluxo de delegação agente→agente.

## Estrutura proposta da página

1. Hero — headline + sub + CTA + prova visual (print do chat com proposta aprovada)
2. "O que seu time faz" — 3-4 cards de caso de uso reais (pesquisa, código, SEO, rotina)
3. Como funciona — agente → runtime → modelo em uma frase + diagrama simples
4. Templates — grid dos roles prontos (os ~50 que já existem)
5. Ferramentas — conectores OAuth (logos), WhatsApp, Slack/Teams
6. Memória — demo em 3 passos (copiar o formato deles)
7. Confiança — aprovações, permissões, audit, self-host
8. FAQ — perguntas reais de usuário, não genéricas
9. CTA final

## Copy proposta

### Hero

**pt-BR**
> **Monte sua equipe de IA.**
> **Ela trabalha enquanto você não está.**
>
> Agentes com papel próprio — pesquisa, código, conteúdo, SEO — rodando no Claude
> Code ou no modelo que você escolher, conectados às suas ferramentas via OAuth,
> disponíveis no Slack, Teams e WhatsApp. Cada ação importante espera a sua
> aprovação. Tudo auditado.

**en**
> **Build your AI team.**
> **It works while you don't.**
>
> Agents with real roles — research, code, content, SEO — running on Claude Code
> or the model you pick, connected to your tools over OAuth, reachable on Slack,
> Teams and WhatsApp. Every important action waits for your approval. Fully
> audited.

### Seção "agente → runtime → modelo"

**pt-BR**
> Cada agente é um colega com nome, papel e ferramentas. Você escolhe como ele
> pensa: no Claude Code instalado no seu computador, ou direto no modelo — com
> roteamento automático entre os endpoints que você conectou.

**en**
> Each agent is a teammate with a name, a role and its own tools. You choose how
> it thinks: on Claude Code running on your machine, or straight on a model —
> with automatic routing across the endpoints you connect.

### Seção memória

**pt-BR**
> **Uma memória para todo o time.**
> Na primeira conversa o agente aprende o que importa. Na próxima, ele já sabe.
> A wiki do time cresce sozinha — e cada agente pode consultar o que os outros
> aprenderam.

### Seção confiança (diferencial)

**pt-BR**
> **Nada acontece sem você saber.**
> Agentes propõem, pessoas aprovam. Você define o que cada um pode fazer sozinho,
> o que precisa de aprovação e o que é proibido. Cada ação fica registrada —
> e se precisar, seu time inteiro roda no seu próprio servidor.

**en**
> **Nothing happens without you knowing.**
> Agents propose, people approve. You set what each one can do alone, what needs
> sign-off and what is off-limits. Every action is logged — and if you need to,
> the whole team runs on your own server.

### FAQ (perguntas reais)

1. **"Meu agente não responde. O que faço?"** — status do run visível no chat;
   falhas de provider aparecem com o motivo.
2. **"Posso usar minha conta do Claude / ChatGPT / Ollama?"** — sim: conecte como
   endpoint ou rode Claude Code na sua máquina.
3. **"E se o agente fizer algo errado?"** — ações sensíveis passam por aprovação;
   permissões são por agente; tudo é auditado.
4. **"Funciona no WhatsApp?"** — sim, pareamento por QR; conversas novas passam
   por aprovação do admin.
5. **"Meus dados ficam onde?"** — na sua instância. Self-host ou keepmind.io.
6. **"Quanto custa?"** — o software é AGPL; você paga só o que usar de modelos
   e infraestrutura.

### CTA final

**pt-BR**: `Comece com um template — ou peça pro primeiro agente montar o time.`
**en**: `Start from a template — or ask your first agent to build the team.`

## Notas de implementação

- A landing não existe no repo ainda; keepmind.io serve o app. Decidir se a
  página é rota pública do apps/web ou site separado.
- Prova visual ideal: screenshot real do fluxo "Kivo propõe → usuário aprova →
  Vetor executa" — é o magic moment que nenhum concorrente mostra.
- Manter pt-BR como locale primário (público atual) e en como fallback.
- Cuidado com claims: "auditado" é verdade (audit log existe); "cada ação
  importante espera aprovação" é configurável — formular como capacidade, não
  garantia.
- Referência de estilo MyClaw: headline curta + sub concreta + demo visual antes
  de pedir cadastro. Evitar jargão interno (brain, engine, gateway) na copy.

## Pendências de benchmark

- [ ] Abrir myclaw.ai renderizado para capturar animações, screenshots e a
      seção "Data Router" (eles vendem dados integrados — nosso equivalente
      seria connectors + wiki; vale estudar o formato de pricing "pay per use").
- [ ] Verificar se há página de pricing deles para comparar modelo de cobrança.
- [ ] Screenshot do nosso fluxo de proposta aprovado para usar como prova.

Generated with [Devin](https://devin.ai)
