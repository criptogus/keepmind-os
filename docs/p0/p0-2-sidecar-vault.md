# P0-2 (keepmind-os): sidecar KeepMind com um vault por empresa e desbloqueio cifrado

**Origem:** `BRIEF-P0-THOR.md` / `MELHORIAS-KEEPMIND.md` (14/11/2026). Esforço: L. Base: `main` @ 8da512a.

## Problema
- O vínculo do sidecar é **por agente** (`agentId`), então dois agentes da mesma empresa podem apontar para raízes de dados diferentes.
- O desbloqueio do vault cifrado não existe: `sidecar.ts:5` diz "Encrypted unlock FD/keychain lifecycle is a P1 launcher integration". Na prática, só há fixtures plaintext.
- O humano precisa digitar caminhos absolutos (`dataRoot`, `entry`, `node`).

## Onde (main atual)
- `src/main/keepmind/sidecar.ts:3-9`: `createCompanyKeepMind` e opção `allowPlaintextFixtures`.
- `src/main/keepmind/CompanyBrains.ts:14-30`: `binding(agentId)`, `save()` (filtra por `agentId`), `remove(agentId)`.
- `src/renderer/components/settings/CompanyBrainsPanel.tsx:10,20`: formulário com `agentId`/`dataRoot`/`entry`/`node`.
- Testes existentes: `test/keepmind/isolation.test.ts`, `test/keepmind/gate.test.ts`. Também `gate.ts:8`, `scopes.ts:5`, `map.ts:8`.
- O SB já aceita o desbloqueio por FD dedicado: `keepmind/tools/keepmind-mcp.mjs:721-730` (`KEEPMIND_MCP_UNLOCK_FD`, exige fd >= 3; a passphrase é lida do descritor). O brief citava `:23-37`, mas no main atual o trecho está em 721-730.

## O que fazer
1. Trocar o vínculo por agente por um vínculo **por `companyId`**, guardando o `dataRoot` uma vez por empresa.
   - Os agentes herdam da empresa.
   - A mesma empresa não pode ter duas raízes: rejeitar ou exigir substituição explícita.
   - Migrar os bindings antigos por agente: agrupar por `companyId`; se houver conflito de raízes, não escolher sozinho e sinalizar.
2. Desbloqueio via FD dedicado: passar a passphrase ao processo do SB por um pipe/FD herdado (>= 3) e setar `KEEPMIND_MCP_UNLOCK_FD`.
   - A passphrase vem do keychain do SO (`safeStorage`), nunca do env, de argv, do agente/LLM ou de log.
   - Sem keychain disponível, falhar fechado.
3. Auto-detectar o `entry`/`node` do KeepMind instalado em vez de pedir caminho absoluto. O humano só escolhe a empresa e autoriza.
4. Manter `write:false` e o catálogo `sb_search/read/list/recent`.
5. Auditoria sem conteúdo, só hash (sha256) e metadados.
6. Nunca logar chave, senha ou passphrase.

## Critérios de aceite (do brief)
- [ ] Testes de isolamento atuais verdes.
- [ ] Novo teste: "2 agentes, mesma empresa ⇒ mesmo root".
- [ ] Novo teste: "vault cifrado abre sem plaintext em disco".
- [ ] Teste E2E com fixture cifrada **sintética** (gerada no teste, fora do git).
- [ ] Auditoria sem conteúdo, só hash.
- [ ] `write:false` e catálogo `sb_search/read/list/recent` mantidos.

## Testes esperados
- `CompanyBrains`: salvar a empresa X com root R e pedir o binding para os agentes A1 e A2 da empresa X ⇒ ambos recebem R. Tentar salvar X com R2 ⇒ erro (ou substituição explícita).
- Migração dos bindings legados por agente para empresa, incluindo o caso de conflito.
- Launcher: o processo filho recebe `KEEPMIND_MCP_UNLOCK_FD` (>= 3), e a passphrase não aparece em `env`, argv nem logs (assert em spy do logger/env).
- E2E: criar um vault cifrado sintético em tmpdir, abrir via sidecar, `sb_search`/`sb_read` funcionam e nenhum arquivo plaintext da nota é escrito em disco (varredura do tmpdir).
- Auditoria: as linhas contêm `sha256`/`bytes`, nunca o texto retornado.

## Regras (obrigatórias)
- **Sem plaintext:** nenhuma credencial, passphrase, chave ou conteúdo de nota em texto puro em disco, log, teste ou PR.
- **Sem dados de vault no git:** só fixtures sintéticas geradas no teste; nada de vault real, segredo ou token.
- **Não mexer em `.github/workflows`.**
- Trabalhar nesta branch / PR **draft**. Nada de push na main, merge, release ou tag sem o OK do Gustavo. Sem force-push.
- TDD: o teste novo falha no main atual e passa com a correção. Rodar `npm test`, `npm run typecheck` (e lint, se houver) e registrar no PR quais falhas já existiam no main.
- `git diff --check` limpo; rodar gitleaks no diff se disponível.
- Este arquivo de spec pode ser mantido ou removido no commit da implementação.
