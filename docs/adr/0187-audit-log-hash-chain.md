# 0187. The audit log is a hash chain

- Status: Accepted
- Date: 2026-11-20

## Context

`audit_log` holds what people changed and what agents did. Anyone who can write to the
database could edit or remove a row and leave no trace. The first chain (migration
`0281_audit_chain`) linked each row to the previous one but sealed neither the row's id
nor its time, kept the whole log in memory to verify it, and no route or command ran
the verification.

## Decision

Every row `recordAudit` writes joins one chain per workspace. Under a transaction-level
advisory lock for that workspace, the row takes the latest chained row's `chain_hash` as
its `prev_hash` and stores its own `chain_hash`.

- Format `v2:<sha256 hex>`: the hash covers the row's id, creation time, every stored
  field and `prev_hash`, as JSON with sorted keys. The id (UUIDv7) and the time are made
  by the server under the lock, so ids follow append order.
- Rows in the first format (bare hex, without id and time) still verify with the first
  function. The prefix names the format; no migration rewrites a stored hash.
- Rows written before any chain keep both columns null and are counted, not verified.
- `verifyAuditChain` reads the log in pages of 1,000 and stops at the first row whose
  link or hash is wrong. `GET /api/app/organizations/{orgId}/audit/chain` returns the
  result to whoever may read the audit log (`view_audit`), with `head`: the latest
  verified hash.

## What it does not do

- The hash has no key. Someone with write access to the database can change a row and
  recompute every hash after it. The chain shows accidents and partial edits, and it
  shows a full rewrite only against a head that was kept elsewhere.
- Rows removed from the end leave a chain that verifies. Record `head` outside the
  database (a backup's notes, a ticket, another system) on a schedule and compare.
- The lock serializes audit writes per workspace until the surrounding transaction
  ends. Agents' tool calls write here, so a workspace with many concurrent runs queues
  on it. Measure before raising concurrency; a per-workspace sequence table is the
  next step if it shows.
- With several server replicas whose clocks disagree by more than their commit times,
  an id can sort before an older row's. Keep the replicas' clocks synchronized.

## Consequences

A key held outside the database (an HMAC, or signed periodic heads) would close the
first two gaps and is left for a later decision, with its key management.
