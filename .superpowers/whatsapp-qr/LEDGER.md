# WhatsApp QR connector — execution ledger
Plan: docs/superpowers/plans/2026-11-17-whatsapp-qr-connector.md
Spec: docs/superpowers/specs/2026-11-17-whatsapp-qr-connector-design.md
Branch: whatsapp-qr-connector (off main d90158a+1f10341)

Rulings:
- Working on a feature branch (not main) per executing-plans; merge at end after review.
- Token storage: sealed (envelope encryption) — engine verifies bridge bearer on /api/internal route.
- External senders: hidden relay agent authors inbound messages with meta.external; designated agent answers.

Tasks:
- [ ] T1 bridge scaffold + session lifecycle
- [ ] T2 bridge MCP tools + /send
- [ ] T3 engine supervisor + whatsapp_sessions
- [ ] T4 connector registration + internal routes
- [ ] T5 inbound mirror + reply delivery
- [ ] T6 web UI QR pairing
- [ ] T7 docs/packaging/E2E
