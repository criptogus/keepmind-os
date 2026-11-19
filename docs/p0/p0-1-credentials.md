# P0-1 (keepmind-os): credenciais falham fechado sem `safeStorage`

**Origem:** `BRIEF-P0-THOR.md` / `MELHORIAS-KEEPMIND.md` (14/11/2026). Esforço: M. Base: `main` @ 8da512a.

## Problema
Sem `safeStorage` disponível, o `CredentialStore` grava a credencial como `plain:` + base64. Isso é só codificação, não cifra: chaves BYOK, tokens OAuth e segredos de integração ficam legíveis no SQLite.

## Onde (main atual)
- `src/main/auth/CredentialStore.ts:28-29`: `encode()` gera `'plain:' + base64`.
- `src/main/auth/CredentialStore.ts:38`: `decryptSync` aceita `plain:`.
- `src/main/auth/CredentialStore.ts:61`: `isAsyncEncryptionAvailable()`.
- `src/main/auth/CredentialStore.ts:117-119`: `write()` cai em `encode(plain)` quando não há cifra.
- `SECURITY.md:22`: documenta o fallback "unencrypted encoding".
- Padrão a seguir: `keepmind/src/main/services/security/keys.ts:14`, que recusa quando `!isEncryptionAvailable()` ou o backend é `basic_text`.

## O que fazer
- Recusar a persistência: sem cifra, a credencial fica **só em memória** (cache da sessão) e o app/agent recebe um aviso/erro claro (ex.: "Cofre do sistema indisponível; a credencial não foi salva e vale só nesta sessão").
- Tratar o backend `basic_text` do Linux como indisponível, igual ao SB.
- Nunca mais gerar `plain:` em escrita nova.
- Migração dos valores `plain:` existentes:
  - com cifra disponível, regravar como `enc:` no warm-up;
  - sem cifra, apagar o valor e pedir a credencial de novo.
- Atualizar o `SECURITY.md:22` para refletir o fail-closed.

## Critérios de aceite (do brief)
- [ ] Teste unitário: com `isAsyncEncryptionAvailable=false`, nada é gravado em settings.
- [ ] Teste de migração de `plain:` (para `enc:` com cifra; apagado + re-prompt sem cifra).
- [ ] `npm test` e `typecheck` verdes.
- [ ] `SECURITY.md:22` atualizado.

## Testes esperados
- `CredentialStore` com `safeStorage` mockado indisponível: `setSetting` nunca é chamado com valor da credencial; o `read()` na mesma sessão devolve o valor em memória; o erro/aviso é emitido.
- Backend `basic_text`: mesmo comportamento de indisponível.
- Setting legado `plain:…` + cifra disponível: após o warm-up, o valor gravado começa com `enc:` e decifra para o original.
- Setting legado `plain:…` + cifra indisponível: o setting é removido e a credencial aparece como ausente (re-prompt).
- Nenhum teste usa segredo real; só strings sintéticas.

## Regras (obrigatórias)
- **Sem plaintext:** nenhuma credencial, passphrase, chave ou conteúdo de nota em texto puro em disco, log, teste ou PR.
- **Sem dados de vault no git:** só fixtures sintéticas geradas no teste; nada de vault real, segredo ou token.
- **Não mexer em `.github/workflows`.**
- Trabalhar nesta branch / PR **draft**. Nada de push na main, merge, release ou tag sem o OK do Gustavo. Sem force-push.
- TDD: o teste novo falha no main atual e passa com a correção. Rodar `npm test`, `npm run typecheck` (e lint, se houver) e registrar no PR quais falhas já existiam no main.
- `git diff --check` limpo; rodar gitleaks no diff se disponível.
- Este arquivo de spec pode ser mantido ou removido no commit da implementação.
