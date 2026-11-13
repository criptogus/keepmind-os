# Table, feedback and routine intake polish

Scope: PR #12, no merge. Preserve the conversation-first interface, Portuguese/English choice and white/black/lime identity.

## Changes

- History and governance tables use quiet headers, row separators, tabular numbers and contained horizontal scrolling. History payloads expand using keyboard-accessible native disclosure controls; missing values no longer crash rendering.
- Page headers wrap their actions before squeezing the title. Markdown tables retain semantic table markup and alignment in a labelled, focusable scrolling region.
- History, governance and routine loading use real asynchronous feedback. Failures retain existing content, expose technical details separately and allow a refresh. Routine mutation failures no longer become unhandled rejections. Failed list requests no longer masquerade as an empty agent list.
- Decision cards and page entry use the existing short transition; loading uses the shared three-dot treatment. Reduced-motion preferences disable movement.
- Closing the last macOS window no longer closes the database or stops workspace services. Actual quit stops services once; repeated quit requests cannot bypass pending cleanup.
- Desktop webhook requests persist their original payload and provenance with the task before execution. Callers may supply `Idempotency-Key` (nonempty, at most 200 characters). Repeated identical events return the existing task without re-executing; changed content with the same key fails. Interrupted tasks remain blocked, requiring review. Incoming content is explicitly untrusted context, never permission.

## Boundaries

The webhook remains loopback-only and token-protected. HTTP acceptance does not certify a successful agent delivery; inspect the task status. Without an idempotency key each request is a distinct event. Keys refer to the original routine configuration and payload; they are not a generic retry queue. The runner's schedule path is unchanged. Durable multistage orchestration, dedicated developer/QA gates, external inbox subscriptions and Google/Meta campaign changes remain separate implementation work.

## Verification

`npm run verify:ux` passed: 248 unit tests (37 files), 1 integration test and 44 Electron scenarios, plus typecheck, build, runner, secrets scan (0 findings) and dependency inventory (462 packages). The HTTP fixture exercises JSON/text preservation, duplicate events, conflicting suffixes beyond 4,000 characters, malformed URL paths and payload size rejection.

`node_modules/.bin/electron scripts/smoke-lifecycle.cjs` passed on macOS: close the production window, emit native activation, reopen and read workspace context from SQLite. The test uses a fresh profile. It encountered an occupied default webhook port, which does not affect the lifecycle assertions; webhook HTTP checks use a separate isolated port.

Inspected History screenshots at desktop/390px, light/dark. Visual inspection caught a squeezed page heading and broken agent names that an overflow assertion had missed; both were corrected before final captures. Full payload disclosures were exercised in the rendered app. Source screenshots: `evidence/history-table-*.png`; aggregate results: `evidence/ux-report.json`, `evidence/lifecycle-report.json`.

Fixtures are synthetic and do not call live providers or customer accounts. Reduced-motion and the complete request → delivery → revision → approval flow remain in the aggregate smoke. Error handling in every other settings/integration panel has not been exhaustively audited.

Focused UX reference queries supported contained table overflow, readable numbers, real loading feedback and reduced motion. Jev 1.14.0 reviewed minimal synthetic recovery copy and the bounded automation claim (597 input / 86 output tokens): copy supported at 0.98; claim supported at 0.61 with 0.33 insufficient evidence. This advisory check is not runtime proof; production-path HTTP and persistence tests supply that evidence.


## Standards review

Two findings: the first smoke lacked dark 390px evidence; JSON key order affected event equality (judgment concern). Added and inspected the missing capture; canonicalized nested object keys and tested array-order sensitivity. No other hard standards violation reported.

## Spec review

Two findings: non-JSON webhook content was truncated, and populated governance lacked refresh feedback. Preserved bounded text in full with explicit oversize rejection and production HTTP regressions; added governance refresh/loading/error alongside existing data.

Summary: 2 Standards findings addressed (1 validation gap, 1 judgment concern); 2 Spec findings addressed (both correctness/behavior gaps).
