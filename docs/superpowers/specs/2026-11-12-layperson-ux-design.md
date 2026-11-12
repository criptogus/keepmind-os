# KeepMind para leigos — design de usabilidade

**Data**: 2026-11-12 · **Status**: aprovado pelo usuário (escopo "Tudo", público "todos incluindo admin")

## Intent

O app hoje é powerful mas denso: nav em jargão (Governance, Logs, Skills), aprovações exibem `JSON.stringify(context)` cru, e não existe nenhuma camada de explicação. O objetivo é que uma pessoa sem conhecimento técnico (mestre de obras, encarregado, admin de empresa) consiga **usar, integrar e entender** agentes e governança sem manual.

## Goals / non-goals

- **Goals**: linguagem simples em toda a UI (PT-BR primeiro), aprovações que se explicam sozinhas, dashboard orientado a "o que fazer agora", criação de agente em 3 passos, tour guiado replayável, ajuda contextual ("?").
- **Non-goals**: não muda lógica de main process, permissões, governança ou tools — só a camada de apresentação. Não remove o modo avançado: quem sabe usa.
- **Anti-goal**: esconder funcionalidade de admins — a complexidade certa aparece por papel, não some.

## Abordagens consideradas

1. **Só renomear + tooltips** — barato mas insuficiente: aprovações continuariam crípticas.
2. **Reescrever telas do zero** — risco alto, quebra fluxos existentes.
3. **Camada de linguagem + fluxos guiados + tour** ✅ — mantém tudo que funciona, adiciona a camada didática por cima.

## Design

### 1. Linguagem simples
- Nav (valores i18n, chaves iguais): Início · Agentes · Equipes · Habilidades · Aprovações · Histórico · Configurações · Avançado.
- `PageHeader` compartilhado: título + subtítulo de 1 linha dizendo o que a página faz. Aplicado em Agents, Teams, Skills, Governance, Logs, Settings.
- `HelpTip`: ícone "?" com Mantine Tooltip explicando termos (tool, skill, second brain, approval).

### 2. Aprovações autoexplicativas
- `src/renderer/lib/plainLanguage.ts`: `describeApproval(approval, t)` → `{ headline, detail, isSensitive }`.
  - `whatsapp_send_message` → "enviar uma mensagem de WhatsApp para {to}" + texto citado
  - `file_write` → "criar/alterar o arquivo {path}"
  - `shell_exec` → "executar o comando `{command}`"
  - `open_url` → "abrir o link {url}"
  - `delegate_to_agent` → "pedir ajuda ao agente {agent}"
  - `composio_execute` → "executar a ação {slug}"
  - `secondbrain_remember`/`personalbrain_remember` → "salvar na memória (empresa/pessoal): {preview}"
  - fallback → nome da tool humanizado + resumo dos args
- ApprovalQueue: card legível (agente + frase + citação), `<details>` "ver detalhes técnicos" com o JSON, botões maiores.

### 3. Dashboard "precisa de atenção"
- Card de alerta quando `pendingApprovals > 0` → botão leva a Aprovações.
- Linha de status de integrações: Provedor de IA · WhatsApp · Cérebro da empresa — bolinha verde/cinza + botão "Conectar" que navega pro lugar certo.
- Checklist reescrito em termos de ação ("Conecte uma IA", "Crie seu primeiro agente"…).

### 4. AgentWizard (3 passos)
- Modal em AgentList substitui o form direto: **1)** grid de templates agrupados (cards com tagline) + "Em branco"; **2)** nome + "instruções extras" opcional (append ao system prompt); **3)** revisão — capacidades em linguagem natural (derivadas de toolNames/skills via `describeTool`), modelo, botão Criar.
- Link "Modo avançado" abre o `AgentForm` atual (modelo, temperatura, tools, skills manual).
- `createAgent` recebe o mesmo payload do AgentForm (config do template + name/description/capabilities).

### 5. Tour guiado
- `TourOverlay`: spotlight (overlay escuro + cutout no alvo via box-shadow), card com título, texto, Voltar/Avançar/Pular, dots de progresso.
- Âncoras `data-tour="..."` em App.tsx (nav, dashboard, agents, governance badge, settings) e AgentList.
- Steps: Boas-vindas → Menu → Início → Agentes → Aprovações → Configurações. Auto-start 1x (`localStorage km-tour-done`); replay via botão "?" na sidebar e no dashboard.
- Implementação própria (~150 linhas), sem dependência.

### 6. Admin
- Subtítulos explicando papéis (Membro/Admin/Owner) na gestão de usuários; badges de papel já existem.

## i18n
Todas as strings novas entram no dict com `en` + `pt` (es cai em en). Prefixos: `nav.*` (valores), `ph.*` (page headers), `ap2.*` (aprovações), `wiz.*` (wizard), `tour.*`, `dash2.*`.

## Arquivos
- novos: `lib/plainLanguage.ts`, `components/common/HelpTip.tsx`, `components/common/PageHeader.tsx`, `components/tour/TourOverlay.tsx`, `components/agents/AgentWizard.tsx`
- edits: `App.tsx` (nav labels, data-tour, tour state), `ApprovalQueue.tsx`, `AnalyticsDashboard.tsx`, `AgentList.tsx`, `AgentForm.tsx` (link modo avançado), páginas p/ PageHeader, `i18n.tsx`, `AdvancedSettings.tsx` (role hints)
