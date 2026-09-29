# Agent instructions

Stop every process you started when the task finishes. Preserve processes owned
by the user or another task.

## Scope and sources of truth

This repository contains Corch, a reusable Codex delivery workflow: role skills,
deterministic helpers, protocol contracts, and tests.

- Source owns implementation; tests verify observable behavior.
- `.agents/workflow.json` owns repository, scrum provider, issue, CI, and setup settings.
- The adopting project's accepted specifications own product behavior.
- The external scrum provider owns the backlog, work items, priority and lifecycle.
  Refinement maintains scope, acceptance and dependencies there. Direct user
  decisions prevail; the local task record holds agreed context and execution state.
- Keep operational state, plans, logs, and evidence in ignored `.agents/`
  directories. They are not public documentation.

When adopting this workflow, merge these instructions with the project's own
architecture, commands, product constraints, and canonical documentation.

## Delivery routing

Use `$corch-development-workflow` for implementation requests whose role is not
assigned. A named role uses exactly its skill: `$corch-delivery-coordinator`,
`$corch-refinement`, `$corch-planner`, `$corch-worker`, `$corch-reviewer`,
or `$corch-tester`.

The router keeps eligible bounded changes in the current chat and checkout.
Coordinated delivery uses Refinement, Coordinator, Planner and Worker; the
Worker selects initial and repeat Reviewer/Tester passes proportionally.
Follow explicit user instructions for direct work, required roles or waived
checks. Preserve assigned families, approvals, and active checkout ownership.
Routing eligibility, shared helpers and data conventions belong to
`corch-development-workflow`.

Read `.agents/workflow.json` before recording delivery identity. `TASK-N`,
`corch/task-n-<slug>`, `main`, and `npm run verify:ci` in skill examples represent
the configured prefix, branch convention, base branch, and CI command. Example
GitHub addresses are synthetic; configure the delivery repository before
coordinated implementation. Inputs may start in conversations, documents or
provider items; normal Refinement resolves them to an external backlog item.
Keep its identity in `workItem.scrum` and original input in `sourceRef`. Internal
keys and provider keys may differ. Resolve the provider from configuration or
the user's selected project; missing access is a concrete refinement blocker,
not permission to substitute a local backlog. Direct delivery follows the
router's eligibility rules or an explicit user instruction. Credentials never
belong in this file.

## Engineering and authorization

- Check `git status`, preserve unrelated edits, and keep changes scoped.
- Prefer existing boundaries and the smallest complete implementation.
- Follow explicit user decisions and existing authorization. A local edit alone
  does not authorize publishing or external messages.
- Never commit credentials, personal account data, task transcripts, or evidence.
- Preserve idempotency and test security, privacy, billing, data, and deployment
  changes in proportion to their actual risk.
- Update documentation only when its owned behavior, interface, architecture,
  operator procedure, or onboarding instructions materially change.
- Record each fact in one canonical place and preserve language accents.

## Validation and navigation

Start with `rg` and focused source reads. Run focused checks first and the
configured CI command for substantial changes. Explain checks that cannot run.
Use independent gates when the role workflow and user authorization call for them.

For this toolkit, run `npm test` or `npm run verify:ci`. Workflow tests need
Node.js 22 or newer and Git, after `npm ci --ignore-scripts`.
