# KeepMind: conexões de IA — validação de 15/11/2026

## Mudança

- Planos ChatGPT e Claude mantêm a autenticação dos programas oficiais Codex/Claude Code. O ChatGPT começa pelo login; ajuda sobre a configuração de segurança fica disponível sob demanda.
- OpenRouter: autorização pública PKCE S256, com código fornecido pelo provedor (fluxo headless para navegador externo). Segredo temporário em memória, expiração em dez minutos, troca com timeout e sem redirecionamentos; salvar/testar continua no fluxo de credenciais existente. Chave manual preservada.
- OpenCode gratuito aparece junto das escolhas principais. Não há fallback automático para modelos pagos.
- Ollama: acesso direto, detecção pelo servidor, endereço local preenchido, modelos selecionáveis e controles avançados preservados. Não baixa modelos nem instala serviço Ollama. O Ollama precisa estar em execução; localhost refere-se à máquina do servidor KeepMind.
- Serviços macOS dos conectores com diretórios distintos recebem identificadores próprios. O diretório padrão mantém compatibilidade com o identificador anterior.

## Preservação

| Capacidade | Novo acesso | Evidência |
| --- | --- | --- |
| Planos e contas existentes | Mesmas contas e permissões, login oficial | Testes de contas e fluxos; resposta real do ChatGPT |
| Chave manual e outros provedores | Alternativa manual e seletor existentes | Testes de formulário e conexão |
| Endpoint personalizado/modelos/preços | Opções avançadas | Sete testes do formulário |
| Modelos gratuitos | OpenCode visível; Ollama local | Catálogo real, recusa de quota explícita e resposta local |
| Conector persistente | Serviço isolado por diretório | Testes de serviços e reconexão observada |

## Evidência

- ChatGPT respondeu no chat: “ChatGPT conectado”. Não foram solicitadas ferramentas nem alterações de dados no teste.
- Ollama qwen2.5:1.5b respondeu via API: “Conexão local funcionando”. A interface detectou quatro modelos já instalados. O processo temporário usado no teste foi encerrado; abra o Ollama para usá-lo.
- OpenCode chegou ao provedor, mas retornou 429: limite gratuito esgotado. Não foi testada resposta bem-sucedida nem usado plano pago.
- OpenRouter abriu a página oficial. Autorização completa/troca com conta real e login real do Claude permanecem pendentes do titular. Testes automatizados cobrem PKCE e protocolos existentes; não substituem consentimento real.
- 79 testes de conexão, 7 de endpoint, 45 de contas e 10 de OAuth/serviços passaram. Build web e typechecks web/servidor passaram. Revisão visual desktop/mobile: disposition ship, sem bloqueios materiais. Rótulo de unidade de preço no modo simples Ollama é resíduo menor conhecido.
- JEV review foi inconclusivo, sem achado concreto; revisão humana do código e checks determinísticos prevaleceram. JEV verify apoiou cinco afirmações, com baixa confiança apenas na reconexão, diretamente confirmada pelo log local. Uso: review 3255 entrada/79 saída; verify 2085 entrada/479 saída. Não há baseline para alegar economia.

## Atualização local

Interface copiada para diretório durável web-connections-20261115, selecionado por WEB_DIR no ambiente local; arquivo anterior preservado. Recursos assinados do aplicativo, banco, contas e permissões não foram substituídos. Conector existente recompilado no diretório durável e serviço recuperado. Reinício do servidor seguido de reconexão automática observado. Aplicativo nativo abriu e exibiu a conversa. Isto é uma atualização local, não uma nova release oficial.

## Referências de protocolo

- https://openrouter.ai/docs/guides/overview/auth/oauth
- https://code.claude.com/docs/en/legal-and-compliance
- https://docs.ollama.com/api/introduction
- https://opencode.ai/docs/console/models/
