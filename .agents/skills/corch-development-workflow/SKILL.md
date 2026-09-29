---
name: corch-development-workflow
description: Deliver bounded Corch changes in the current task or route work needing tracked ownership, coordination, or material risk handling to its delivery role. Use only before a task role is assigned.
---

# Corch Delivery Router

Identify the task role and load exactly one destination:

- coordinator: `$corch-delivery-coordinator`;
- Refinement: `$corch-refinement`;
- planner: `$corch-planner`;
- Worker: `$corch-worker`;
- Reviewer: `$corch-reviewer`;
- Tester: `$corch-tester`.

Once a role is known, do not load another current role skill. Keep deterministic
scripts and packet contracts in this skill's shared `scripts/` and `references/`
directories; role skills use them without copying their logic.

## Direct delivery

Use direct delivery for localized fixes and routine bounded changes when every condition holds:

- the user explicitly delegated implementation in this task;
- the outcome is concrete, localized, and verifiable with established patterns;
- it has small blast radius, no cross-task coordination, tracked ownership, or
  active delivery family; and
- it does not materially affect production/customer data, security, privacy,
  auth, billing, metering, database schema, public/cross-package contracts,
  infrastructure, deployment, or dependencies.

Otherwise route the request to `$corch-refinement`.

Remain in this task and checkout; no external ticket, separate task, worktree,
Planner, Reviewer, Tester, task packet or dependency preflight is required. Preserve unrelated work, make the
smallest complete change with existing patterns, and run focused checks. Use
independent checks only when the risk warrants them and delegation is authorized.

Use existing destination-specific authorization for commits, pushes, and PR
creation/update. An implementation request alone authorizes local edits and
validation; when publication is not yet authorized, finish the reviewable patch
before requesting the specific external action. Never repeat an authorization
already supplied. Use a codex/ branch for authorized PR delivery; do not repurpose
another issue's branch or publish unrelated changes. Inspect current-head remote
CI before PR handoff unless explicitly waived; a full local verify:ci run is not
mandatory for this route. Report actual validation, explicit check waivers, and
confidence gaps without claiming skipped checks passed.

Preserve assigned delivery families. Scope requiring coordination or
material risk handling follows the named role; synchronize already-authorized
user decisions without blocking their implementation on source administration.
For an on-demand workflow retrospective, use references/contracts.md.
