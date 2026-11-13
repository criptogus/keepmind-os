# Team setup and inline connections

The project settings form now separates Team, Tools and Rules. Team members have neutral numbered avatars, roles and descriptions. Each service has an accordion with one account picker, an explicit “not used” state, and account setup in place. Creating an account selects it immediately; saving grants project access, while authentication is a separate durable operation. Company account/skill sharing remains opt-in. The rules tab shows existing company/project rules and additional project guidance.

Project creation supports ready-made delivery, marketing, operations and general support teams, or independent copies of existing teams. Ready-made teams create a coordinator and two specialists without model calls, tasks, external connections or enabled schedules. They do not fabricate skills. Copying a team also remaps delegation IDs inside coordinator instructions.

Configuration requests now continue inline, with the existing delivery visible. Preparation decisions now persist the original task goal when the submitted message is empty; existing decisions have a renderer fallback to the last user turn or original goal. The initial request is forwarded automatically; the welcome screen and repeated “what do you want to connect” prompt are removed. Configuration histories and plan lookup are scoped by actor/project/conversation. The original global administrative conversation remains available for compatibility.

The new typed `project.brainConnect` action asks for the missing URL, then a secure credential field. After explicit plan approval it creates a separate read-only identity, tests the endpoint and binds it only to the selected project. Other currently effective accounts remain selected. The preview explicitly explains that this changes company-account inheritance into a project-specific selection. Company rules/skills are unaffected. A failed test does not bind the account or claim success; the prepared account may remain in the account list. Secrets bypass the planner and stored messages.

## Review evidence

The automated Electron flow covers account creation/selection/save without reselecting, inline Second Brain request → URL clarification → secure token → local HTTP verification → project binding, history isolation, secret exclusion, and ready-made team creation. The existing complete delivery/revision/approval regression flow remains part of `npm run verify:ux`. Actual aggregate counts are recorded in `evidence/ux-report.json`.

Screenshots: `project-access.png`, `project-access-narrow.png`, `project-team-setup.png`, `secondbrain-inline.png` and configuration chat captures. Synthetic profiles and loopback services are used; this is not a live-account OAuth or Second Brain authorization test.

UI reference retrieval returned useful form-label and submit-feedback guidance, but no verified progressive-disclosure pattern. Tabs/accordion decisions reuse existing Mantine components and product judgment. Jev 1.14.0 reviewed only synthetic interface copy: unclear 0.54, clear 0.45, insufficient 0.01 (500 input /45 output tokens). Its uncertain advisory result prompted more precise copy distinguishing project-choice saves from account authentication. It is not a usability or security acceptance gate.

## Actual results

`npm run verify:ux` passed: 273 unit tests in 44 files, one integration test, 56 Electron scenarios, typecheck/build/runner, no possible secrets found, and the 462-package dependency policy check. Light desktop and 390px screenshots were inspected. Native dark-mode inspection in Portuguese verified Team → Tools → Rules using arrow keys, inherited company rules, and Escape returning focus to the opener.

The real preview app was restarted with its existing test profile and CLI credential import disabled. The user's existing question about connecting Second Brain was recovered and forwarded through the saved configuration decision. The configured provider responded inline by asking only for the URL and explaining the read-only project scope. No new login, token entry or real Second Brain authorization was performed. A misleading reused “loading audit logs” message observed during this check was replaced with a configuration-specific label; this final copy-only change received typecheck and build verification.
