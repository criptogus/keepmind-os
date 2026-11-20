# Design system do agentes.chat

Referência completa e canônica. Fonte de verdade dos valores: `packages/ui/src/styles/tokens.css` (espelho versionado em `docs/design/design-system/tokens.css`, mantido igual por teste) e `apps/web/src/styles.css` (fontes e ajustes da web). Este documento explica **o que cada token significa e quando usar** — se um valor divergir, o CSS vence e este doc está errado.

Docs relacionadas: `UX-GUIDE.md` (facilidade de uso, obrigatório junto), `refresh-2026-10.md` (spec do refresh), `design-system/README.md` (voz e fundamentos), `icons/` (ícones próprios).

## 1. Princípios visuais

1. **Neutro primeiro.** Pessoas e interface vivem em tinta sobre superfícies neutras. Cor é exceção com significado.
2. **Cor = significado, nunca decoração.** `agent` só em identidade de agente; `warn`/`attention` só no que espera um humano; `danger` só em erro/destrutivo; `ok` só em sucesso.
3. **Estado em chip, nunca em card.** Cards são sempre neutros (`raised` + `line`). Status vai num chip com ícone + palavra.
4. **Dá para saber de relance quem é pessoa e quem é agente** — avatar, não cor de fundo.
5. **Denso mas confortável** (referência: Resend). Agrupe e respire; não delete conteúdo para "limpar".
6. **Controles sempre próprios.** Select, menu, checkbox, radio, diálogo, tooltip: nunca visual nativo do SO/navegador.

## 2. Cor

### Superfícies

| Token | Uso |
| --- | --- |
| `bg` | Fundo do app |
| `side` | Sidebar (papel quase branco, levemente frio) |
| `pane` | Área de trabalho (branca no claro) |
| `raised` | Cards, composer, botão secundário, diálogos |
| `raised-2` | Um degrau acima dentro de containers elevados (aplicado automaticamente) |
| `sunken` | Trilhos, segmentado, esqueletos, estados chosen |
| `glass` / `glass-solid` | Menus, popovers, select, toasts, ⌘K (com e sem `backdrop-filter`) |

### Tinta e linhas

`ink` (texto e ação primária) · `ink2` (corpo de mensagem) · `muted` (secundário) · `faint` (metadados — mínimo AA 4.5:1 nos dois temas) · `line` (hairline) · `line2` (separadores fortes, borda de e3) · `line-strong` (borda de controle, 3:1).

### Cor semântica

| Token | Significado | Regra |
| --- | --- | --- |
| `agent` / `agent2` | Identidade de agente | Só avatar, símbolo do logo, anel "trabalhando", cursor de streaming, pílula de agente alvo. Nunca em nomes, botões, barras, fundos |
| `agent-soft` | Fundo da pílula de agente | Só dentro da identidade de agente |
| `action` / `on-action` | Botão primário | Ação humana principal. Não é "azul de destaque" |
| `warn` / `warn-soft` | Esperando um humano | Chip pequeno com ícone. Nunca card tingido |
| `ok` | Sucesso/presença | Check + palavra. Não é "verde de status genérico" |
| `danger` | Erro, destrutivo | Sempre com palavra ou ícone |
| `info` | Informação neutra | Uso raro, contextual |
| `plate` / `plate-soft` | Hover de linha | Fundo de hover, não de estado |

Regras duras: texto sobre cor usa o token `on-…` correspondente, nunca `#fff` literal. Borda de controle ≥ 3:1 (`line-strong`). Badge/contador "não lido" ≥ 3:1 contra o fundo.

## 3. Tipografia

### Fontes (nunca trocar)

| Face | Onde | Token |
| --- | --- | --- |
| **Source Sans 3 Variable** | Todo o app web, títulos inclusive | `--font-sans` (apps/web/src/styles.css) |
| **JetBrains Mono Variable** | Só código: inline, blocos, diffs, comandos | `--font-mono` |
| **Funnel Display** | Logo/marca e landing | `--font-brand` |
| **Doto** | Só ocasião especial (".chat" do logo, número de destaque) | uso pontual |
| Onest / Martian Mono | Defaults do kit e desktop | fallback do `packages/ui` |

Fallbacks CJK por locale já existem em `apps/web/src/styles.css` — não os contorne. `font-feature-settings: "ss01", "tnum"` para algarismos tabulares em números que mudam (contadores, custos, métricas).

### Escala (apps/web)

| Tamanho | Uso |
| --- | --- |
| 11.5 | Eyebrow de seção (caixa alta, +0.08em, `faint`) |
| 12 | Meta, timestamps, hints |
| 13 | Texto pequeno, botões sm |
| 14.5 | UI padrão (inputs, menus, cards) |
| 15–15.5 | Mensagens e corpo (linha ~1.62–1.7) |
| 16 | Busca |
| 17–20 | Títulos de seção/card (-0.025em) |
| 28–32 | Títulos de página (-0.035em) |

Regras: mono nunca em rótulo, metadado, botão ou texto de UI. Títulos de página usam `display`, headers de canal/card `title`, corpo `body`, rodapés `small`, rótulos de sidebar `label`. O kit (`packages/ui`) exporta variantes de `Text` — use-as em vez de tamanhos soltos.

## 4. Espaço e layout

- **Base 4px.** Escala: `--space-1`…`--space-8` = 4, 8, 12, 16, 24, 32 (+ passos intermediários do kit). Sem px cru para padding/gap/altura.
- **Formulários:** campos a 16px; label a 4px do controle; campos preenchendo a largura do form.
- **Listas:** padding vertical `--row-py` (8, 12 no touch). Alturas de linha: uma linha 36 · com face 24 → 40 · com controle 32 → 48.
- **Cards:** padding `--card-pad` (16). Placa de ação a ≥ 8 das bordas (`--action-clear`).
- **Grupos de lista:** 24 entre grupos (`.ac-groups`).
- **Página:** começa em `--page-top` (alinha com a linha do título na sidebar; 20 no mobile) e `--page-x` (24, 16 abaixo de 640px). Header, toolbar e conteúdo a 16; título, uma frase, controles — nada mais.

### Régua de controles (inviolável)

Três alturas, escolhidas pelo contexto — nunca uma quarta:

| Altura | Uso | Raio (=30% da altura) | Lado | Texto | Ícone |
| --- | --- | --- | --- | --- | --- |
| **32** | Toolbars, filtros de lista, ações em linha, composer | 10 | 12 | 13 | 16 |
| **40** | Formulários, botões de página/diálogo, busca, selects, itens de sidebar | 12 | 14 | 14 | 18 |
| **48** | Só a ação principal de uma tela inteira | 14 | 16 | 15 | 20 |

- Controles lado a lado têm a **mesma altura** — encolha o mais alto.
- **Pílula só para etiqueta que não se pressiona** (status, contador, menção). Botão nunca é pílula.
- Botões platados (`primary`/`default`) ficam a 8px um do outro; fileira de ações `.ac-acts` mantém 16px visíveis.
- Segmentado: itens a 4px da borda; raio interno = raio externo − recuo.
- Alvo de toque: controle de 32 estende o alvo a 44px no touch sem engordar o visual (`--touch-target`).

### Layout de página

Toolbar única: busca à esquerda; abas, filtros e selects à direita. Abaixo de 761px a busca nunca fica < 160px; se não couber, a busca ocupa a linha de cima sozinha e as ações lideram a linha dos filtros. **Nunca um controle órfão numa linha.**

## 5. Forma, profundidade e vidro

- Raios: `radius-sm` 6 (inputs pequenos, código) · `radius-item` 10 (menus) · `radius-btn` 12 (botões, segmentado) · `radius-lg` 14 (cards, mensagens) · `radius-xl` 18 (composer) · `radius-section` 20 (seções, paleta) · `radius-full` (pessoas, pílulas, reações) · `radius-agent` `30% 30% 30% 9%` (o símbolo do agente — canto vivo inferior esquerdo, só em coisas de agente).
- **Aninhado arredondado:** raio interno = raio externo − gap entre eles.
- Elevação: `e1` cards/botão secundário · `e2` hover de card interativo, composer · `e3` vidro, diálogos, composer em foco. `--top` = luz de 1px no topo de toda superfície elevada.
- Vidro (`.ac-glass`): `glass` + `backdrop-filter: blur(18px) saturate(1.6)` + e3; `glass-solid` de reserva sem suporte.

## 6. Movimento

- `--out: cubic-bezier(.2,.8,.2,1)` para entradas/sombras; `--spring: cubic-bezier(.34,1.4,.5,1)` para press, pílulas deslizantes, enviar.
- Entradas 120–220ms (opacidade + transform, sem layout shift). Só entradas — fechar é imediato.
- Nada aparece do nada: card novo, thread aberta, painel — tudo anima.
- `prefers-reduced-motion`: nada anima (inclusive piscar/halo do agente).

## 7. Iconografia e marca

- Ícones próprios: grid 20px, traço 1.6, pontas arredondadas; formas que fecham repetem o canto vivo do agente. Inline com `stroke: currentColor` (classe `ac-icon`). Arquivos-fonte em `docs/design/icons/`.
- Sem emoji como ícone. Chip/badge de estado sempre com ícone + palavra.
- Logo: símbolo do agente + "agentes" (minúsculo). `<Logo>` do kit; abaixo de 18px só o símbolo. Endereço: agentes.chat.
- Avatares: pessoa = círculo com iniciais + ponto de presença `ok`; agente = símbolo vivo (degradê `agent2→agent`, olhos que piscam/olham/escrevem conforme o run: `idle`/`thinking`/`writing`).

## 8. Inventário de componentes (`packages/ui`)

Regra de ouro: **se o componente existe, use-o**. Antes de criar markup novo, procure aqui e nos padrões `ac-*` de `packages/ui/src/styles/components.css`.

- **Ação:** `Button` (primary/default/ghost/danger, sm/md, loading, split), `SplitButton`, `Segmented`, `Tabs`, `Kbd`, `Tip` (tooltip do kit — nunca `title` nativo)
- **Formulário:** `Field` (label + hint + erro + example), `Input`/`TextInput`, `Select`, `SearchSelect`, `Checkbox`, `Switch`, `ChipField`, `CodeInput`, `DatePicker`, `TimeSelect`, `TimezoneSelect`, `RecurrencePicker`, `ColorPicker`, `MediaPicker`, `EmojiPicker`, `VoiceRecorder`
- **Overlay:** `Dialog` (confirmação, formulários), `DetailsDialog`, `AccessDialog`, `Menu`, `MenuOverlay`, `Popover`, `CommandPalette` (⌘K), `OptionList`
- **Identidade:** `Avatar` (pessoa/agente), `AgentLook`, `AgentSticker`, `RoleMark`, `PresenceBadge`, `Logo`, `ProviderLogo`, `ColorDot`
- **Conteúdo:** `Message`, `Card`/`Surfaces`, `Work`/`WorkLine`/`ToolBlock`/`StepTrack` (resumo de trabalho do agente), `Diff`, `Markdown`, `Mention`, `EventPill`, `FactLine`/`FactStrip`, `PlanMeter`, `UsageDays`, `GroupHeading`, `FoldRow`, `SavedNote`, `Skeleton`
- **Mídia/motion:** `VideoPlayer`, `VoicePlayer`, `ChatGif`, `Carousel`, `PixelSpinner`, `PixelSky`/`KeepMindBackdrop`, `Brain`, `Computer`, `RunPixels`, `AutonomyPixels`, `EffortPixels`, `SearchPixels`, `ToolPixels`, `HostingScene`, `QrCode`
- **Layout:** `PageHeader`, `Toolbar`, `Settings`/`SettingsPath`, `InfoHint`

Novos componentes entram em `packages/ui` com variantes nomeadas — nunca classes soltas numa página.

## 9. Padrões de tela

- **Página:** `PageHeader` (título `display` + no máximo uma frase + ações à direita) → toolbar (busca esq., filtros/ações dir.) → grupos de lista com `GroupHeading` (8 acima, 16 abaixo do toolbar).
- **Lista:** linhas de 36/40/48 conforme conteúdo; times à direita alinhados numa borda; nunca reticências no que importa — `Tip` no hover/foco; ordenação estável e previsível.
- **Diálogo:** `Dialog` do kit; corpo com campos a 16px; rodapé com ação primária à direita e **cancelar plain/default** (nunca ghost). Diálogo nunca é faixa larga e chapada — card lê-se quadrado.
- **Formulário:** label a 4px; `Field` com `hint` para ajuda (ⓘ), `example` para formato, `error` para falha. Ajuda longa vai para página de docs linkada uma vez.
- **Card de ação sensível:** nomeia quem + o quê + alvo ("Ada quer fazer merge do PR #42 em main"); aprovar/recusar com verbo; "Aprovar sempre" quando a política permite.
- **Conversa:** layout único (canal, thread, DM); mensagens do mesmo autor agrupadas; cards de tools/arquivos com largura única `--msg-card-w`; texto usa a coluna toda; código e tabelas rolam dentro da própria caixa.
- **Menu/popover/toast/⌘K:** vidro e3, raio 16–20, itens na altura do seu tipo (linha 32 · com descrição 50 · com face 36; +4 no touch), padding 4, 2px entre itens.
- **Vazio/loading/erro:** ver templates no `UX-GUIDE.md` §Templates.

## 10. Responsivo e temas

- Larguras de verificação obrigatórias: **320, 390, 1280** (e 761 como breakpoint de toolbar). Toda tela nova mede nos três.
- Abaixo de 640: `--page-x` 16, `--page-top` 20; cards com ação primária full-width (≥90% do card).
- Temas claro/escuro via `data-theme`; todo token existe nos dois. Nunca cor literal — sempre token. Verificar os dois temas em mudança de cor.
- Texto quebra por significado, nunca palavra a palavra; o pior caso (nomes longos, listas vazias/enormes, traduções) passa pelo fixture do componente.

## 11. Acessibilidade

- Foco visível só no teclado: anel de 2px `focus-color` com 1px de superfície (`focus-ring`); `html[data-pointer]` suprime após mouse/toque.
- Contraste: texto ≥ 4.5:1, grande ≥ 3:1, controles/bordas ≥ 3:1 — nos dois temas.
- Todo controle tem nome acessível; ícone sozinho precisa de `aria-label` ou `Tip`.
- `prefers-reduced-motion` desliga toda animação.
- Fluxos completáveis por teclado; ordem de tab lógica; Esc fecha overlays.

## 12. Checklist de revisão (antes de "pronto")

1. Só tokens — zero px/cor literal para espaçamento, cor e tipo.
2. Régua de controles respeitada; alturas iguais lado a lado.
3. Uma ação primária; verbos com objeto; sem "OK/Confirmar".
4. Vazio ensina, erro resolve, loading é skeleton, falha tem retry.
5. Permissão explica-se antes de bloquear.
6. Componentes do kit usados; padrão varrido em todos os irmãos (web + mobile + desktop).
7. Medido a 320/390/1280, claro e escuro, com dados piores casos.
8. `bun test scripts/geometry/check.test.ts` verde; `check:geometry` sem offenders novos.
9. i18n: chaves em todos os locales obrigatórios; sem strings soltas.
10. Semântica HTML + foco/contraste/teclado ok.

## 13. Rotina obrigatória (skill `ui-polish`)

Toda mudança de UI segue a rotina da skill `.claude/skills/ui-polish/SKILL.md`: consertar no kit → varrer irmãos → break-ui com pior caso → auditoria Impeccable → geometry check → shots antes/depois a 1280 e 390 → build CSS medido. Não pule etapas; "feito" sem medição não está feito.
