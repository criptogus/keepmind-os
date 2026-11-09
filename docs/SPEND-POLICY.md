# Spend policy

Paid execution starts disabled and is not restored automatically after restart. Enabling requires a provider configuration, an encrypted BYOK secret reference, a positive integer monthly cap in cents, and explicit human consent. Allowed caps are 1 through 100000 cents ($1000). Zero, negatives, fractions, NaN, infinity, strings, and larger values are rejected before any budget API call.

Paperclip interprets a cap of zero as disabling budget enforcement. To block spend, keep paid execution off. Disabling pauses the agent; it never writes a zero budget. Startup auditing pauses managed agents with missing, inactive, or nonpositive policies. The orchestrator additionally pauses every managed agent on startup until fresh consent is given.

A cap sets both the agent monthly budget and an active hard-stop policy with warnPercent=80, unpricedUsagePolicy=block, and a positive per-run reservation within the cap. Changing the cap disables execution until consent is renewed. Partial policy failures never enable execution.

The runner refuses a task before contacting the provider when rates are missing or invalid, the estimated worst case exceeds the configured per-run maximum, the budget is nonpositive, or remaining budget is below the estimate. Input tokens are estimated as ceil(prompt characters / 3); output tokens use the configured maximum. Worst-case cents = (estimated input tokens × input cents per million + maximum output tokens × output cents per million) / 1000000. Rates and usage are operator/provider supplied and this estimate is not a provider-enforced billing ceiling.

On success the runner reports actual input/output token usage with a priced cost event, heartbeatRunId, and idempotency key zaos:<runId>. It posts the result as a comment and requests in_review. Human review is required for completion.

Paperclip's process adapter also writes an unknown/unpriced receipt. The board adjusts only that same run's process receipts with reason `unknown_billing`, `missing_price`, or `missing_model`, or provider `unknown` to zero, only after finding the managed runner's acknowledgement that Paperclip accepted the separate priced ZAOS event. The adjustment has its own idempotency key and operator pricing provenance. Priced cost is retained. A crash, missing acknowledgement, or missing usage leaves cost unknown and future execution blocked. Logs are local trusted evidence, not independent verification of a provider invoice.

The cap governs Paperclip's local ledger, not the provider's account-wide billing. Costs from other applications, rate errors, concurrent requests outside this orchestrator, provider overrun, or non-token fees may escape this model. Use provider-side limits as well. Disabling does not refund or necessarily cancel already-started requests. Never automatically replay uncertain runs.

A process receipt may remain in `costs/data-quality` with provider `unknown`, reason `unknown_billing`, and zero cents after reconciliation. The event must still be adjusted even when its reason is `unknown_billing` and its cost is zero. Retries use the same per-event adjustment idempotency key; a duplicate/409 is acceptable. After adjustment, reconciliation returns `unknown cost` unless `budgets/overview` confirms the agent policy has `unpricedEventCount: 0`. Integration additionally verifies `costs/summary` (`unpricedEventCount: 0`, `pricingComplete: true`) and the agent policy in `budgets/overview` (`status: "ok"`, `unpricedEventCount: 0`), with no data-quality reason other than `unknown_billing` for the run. The real integration report records these fields and the remaining informational events. For the mock provider's happy path, spend is 1.4 cents and the 100-cent policy has 98.6 cents remaining.

API connector estimates use the selected connector's positive rates with the
same worst-case formula. Custom, Hermes, Codex API and Claude API require
operator-supplied rates. OpenRouter live USD/token strings convert to cents per
million by multiplying by 1e8. Missing, zero, negative (including -1 router
sentinels) or invalid prices remain unknown and cannot activate paid execution.
DeepSeek static rates retrieved 2026-11-09 from
https://api-docs.deepseek.com/quick_start/pricing are PEAK cache-miss rates:
deepseek-flash (DeepSeek-V4.1-Flash-1017) 30/120 input/output cents per million;
deepseek-v4-pro 132/396. Off-peak is half; estimates use peak conservatively.

CLI subscription mode still requires the positive monthly USD cap, fresh consent
and Paperclip hard-stop policy. It additionally requires an integer monthly run
cap 1..1000 and timeout 30..1800 seconds. The orchestrator persists a UTC-month
counter before issue creation; restarts never reset it. Failed attempts consume
a slot. The runner enforces timeout and the adapter allows timeout + 30 seconds.
Subscription costs are unknown externally: local events report zero cents with
billingType subscription_included and reported status, plus the usual receipt
acknowledgement and idempotency key. Vendor plan usage/limits are authoritative.
