# Design: Modo Pessoal vs Corporativo + instalação guiada do segundo cérebro

Data: 2026-11-12 · Status: aguardando aprovação

## Intent / porquê

O KeepMind OS deve saber, logo no primeiro uso, se a pessoa está em contexto
pessoal ou corporativo — e adaptar menus, configurações, features, templates
de agentes e o passo de "segundo cérebro" do onboarding. Hoje o onboarding
pede URL+token de um servidor que o usuário precisa já ter instalado e
configurado manualmente; a ideia é oferecer o instalador certo dentro do app.

## Decisões do usuário

- "Instalar" = **baixar o instalador correto para a plataforma** (macOS
  dmg/zip, Windows exe, Linux AppImage) do GitHub Releases do produto certo
  e **abri-lo**. O usuário termina a instalação no app do brain e volta ao
  OS para colar URL+token (ou testar conexão).
- Modo muda **tudo**: menus, defaults, features visíveis, templates de
  agentes e fluxo de onboarding.
- KeepMind Corp ainda não tinha release pública → **publicar agora**
  (workflow `release-corp.yml` corrigido e tag `corp-v0.2.6` disparada).

## Achado técnico que molda o design

A API HTTP de segundo cérebro (`/api/brain/*`) **só existe no KeepMind
Corp** (`corp/server.mjs`, `corp/brain-api.mjs` e o servidor embutido do app
Corp em `src/main/services/corp-server.ts` — porta aleatória em loopback).
O KeepMind pessoal **não expõe** essa API: ele é MCP + webhooks
(`src/main/services/hooks.ts`). Ou seja, a conexão "second brain" do OS hoje
só funciona contra Corp.

Implicação: no modo pessoal, o card de instalação baixa o KeepMind pessoal
(o segundo cérebro de fato, memória em Markdown + MCP), mas a conexão
agentes↔memória via HTTP continua sendo recurso do modo corporativo — a
não ser que adicionemos um endpoint `/api/brain` no app pessoal (fora de
escopo aqui; registrado como follow-up).

## Design

### 1. `appMode`: 'personal' | 'corporate'

- Nova setting persistida `app.mode` via `StorageManager`.
- IPC: `app:getMode`, `app:setMode` (setMode restrito a admin/owner se
  multi-user existir; por ora single-user).
- Renderer: `useAppMode()` hook + `ModeContext`; `App.tsx` filtra a nav.

### 2. Onboarding

- Novo **passo 0 — "Como você vai usar?"**: dois cards grandes
  (Pessoal / Empresa), cada um com avatar/ícone e uma linha explicando o
  que muda. Escolha persiste `app.mode` antes dos demais passos.
- Passo "segundo cérebro" passa a mostrar **cards de instalação** em vez de
  só o formulário:
  - `personal` → "Instalar KeepMind" → release `criptogus/keepmind`, asset
    por plataforma (`KeepMind-*-universal.dmg`, `KeepMind.Setup.*.exe`,
    `KeepMind-*.AppImage` do release `continuous` ou latest).
  - `corporate` → "Instalar KeepMind Corp" → release `corp-v*` no repo
    `criptogus/keepmind`, assets `KeepMind Corp*` / `KeepMind-Setup*` do
    build corp.
  - Em ambos: botão "Já instalei — configurar conexão" revela os campos
    URL+token atuais + "Testar conexão".
- Quem já concluiu onboarding não revê o wizard; o modo fica editável em
  Configurações → Geral (com aviso de que trocar muda menus/templates).

### 3. Instalador guiado (main process)

- Novo IPC `brain:installProduct` com `{ product: 'personal' | 'corporate' }`.
- Main resolve o asset correto: lista releases do repo `criptogus/keepmind`
  via `net.fetch` na GitHub API, ignora drafts, casa padrão por
  `process.platform`/`arch`.
- Baixa para `app.getPath('downloads')` (ou temp) com progresso via
  `webContents.send('brain:installProgress')`; ao concluir,
  `shell.openPath`/`shell.showItemInFolder` + `shell.openItem` no arquivo.
- Falhas retornam `{ ok:false, error }` exibido inline no card.
- Reutiliza o padrão do updater (download verificado por sha256 do
  `digest` do asset quando disponível — a API de releases já expõe
  `digest: sha256:...`).

### 4. Adaptação por modo

- **Nav (App.tsx)**: modo `personal` esconde/seções corporativas —
  Equipes, Governança, Auditoria, (ABAC/classificação se existir como item
  próprio), convites/escopos de credencial; modo `corporate` mostra tudo.
  Itens mantidos nos dois: Dashboard, Agentes, Automações, Habilidades,
  Aprovações, Execuções, Histórico, Configurações.
- **Templates de agentes** (`agentTemplates.ts`): `corporate` inclui os
  templates de cargos (CEO/CMO/HR/CFO/CTO/etc.); `personal` mostra apenas
  templates pessoais (assistente geral, pesquisa, redação etc.) e esconde
  os corporativos. Modo indefinido (upgrade de instalação antiga) → trata
  como `personal` mas mostra banner "Escolha seu modo".
- **Defaults**: corporate pré-marca acesso `write` + blockPii no segundo
  cérebro; personal sugere `read` para começar.
- **Configurações**: seção "Modo de uso" com seletor Personal/Empresa e
  texto explicando o que cada um libera.

### 5. Fora de escopo (registrado)

- Endpoint `/api/brain` no KeepMind pessoal (hoje só Corp tem).
- Auto-detecção da porta do servidor Corp embutido (porta aleatória —
  exigiria o app Corp publicar a porta; follow-up no repo keepmind).
- Linux build do KeepMind OS (site já diz "em progresso").

## Verificação

- typecheck + 102 testes existentes + novos testes do resolver de asset
  (patterns por plataforma, escolha de release, sha256).
- Teste manual: onboarding passo 0, cards de install nos dois modos,
  troca de modo em Configurações refletindo na nav.
