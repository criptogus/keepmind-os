# Telemetry

Zero Agency OS v0.1 sends no analytics, diagnostics, or telemetry, including when the preference is enabled. The persisted preference is a future opt-in indicator and defaults off; it does not authorize implementing a sender.

Paperclip is configured with telemetry.enabled=false and updates.checkEnabled=false. The supervisor sets PAPERCLIP_TELEMETRY_DISABLED=1 and DO_NOT_TRACK=1. These remain disabled regardless of the Zero Agency OS preference.

Local server logs and accounting records remain on disk. Task execution sends the task prompt to the operator-selected provider only after explicit paid-execution consent. That operational provider traffic is separate from telemetry. Dependency installation and future packaging can require network access outside the app's runtime behavior.
