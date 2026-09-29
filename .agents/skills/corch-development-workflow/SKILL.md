---
name: corch-development-workflow
description: Deliver eligible bounded Corch changes directly or route coordinated work through its delivery roles, preserving explicit user decisions and active families.
---

# Corch Delivery Router

Use the already assigned role's skill. An approved plan or existing family
continues at its current role; do not restart intake or repeat approval.
For new implementation requests, use direct delivery when the conditions below
hold; otherwise route to `$corch-refinement`. Explicit user instructions about
direct work, required roles or waived checks remain controlling.

Role skills are `$corch-delivery-coordinator`, `$corch-refinement`,
`$corch-planner`, `$corch-worker`, `$corch-reviewer`, and `$corch-tester`.
Load exactly the applicable role. Keep mechanical helpers and shared data
conventions in this skill's `scripts/` and `references/contracts.md`.

## Direct delivery

Use this route automatically when every condition holds:

- The user has delegated implementation in the current chat.
- The outcome is concrete, localized and verifiable with established patterns.
- The change has small blast radius, no cross-task coordination or tracked
  ownership requirement, and no active delivery family.
- It does not materially affect production/customer data, security, privacy,
  auth, billing, metering, database schema, public/cross-package contracts,
  infrastructure, deployment or dependencies.

Keep the work in the current chat and checkout, preserving unrelated edits.
No external backlog item, task record, separate role chat, plan approval or new
worktree is required. Make the smallest complete change and run focused checks;
follow any additional project/user validation requirements. Report the actual
checks, evidence and confidence gaps in the final response. If investigation
reveals coordination needs or material risk, preserve work and authorization
while routing the expanded scope to Refinement.

Reuse established authority for commits, pushes and PRs. An implementation
request authorizes local edits and validation, not external publication. Finish
the reviewable patch before seeking missing external authority. For authorized
PR delivery, use an appropriate `corch/` branch without publishing unrelated
changes, and follow the shared PR timing/readiness contract. Do not create a
delivery family solely to record a direct change or its PR.

## Coordinated delivery

Refinement establishes the outcome in the external scrum provider's backlog;
the Coordinator prepares the family; the Planner resolves implementation with
the user. The Worker owns implementation, proportional initial independent
checks, corrections and delivery. Its role skill defines when Reviewer, Tester,
both or neither are needed, including repeat passes.

Preserve current edits, registered identities, plan approval, runtime snapshots,
and active checkout leases. Local implementation does not itself grant external
publication authority. Reuse existing destination-specific authorization;
complete a reviewable patch before asking for any missing external action.
Resolve the scrum provider from `.agents/workflow.json.scrum` or the selected
project/item. Normal Refinement must maintain a real provider item. Missing
provider access leaves refinement pending; do not silently replace it with local
state. Continue already-authorized implementation during a provider outage and
disclose pending synchronization. Provider unavailability does not make an
ineligible change eligible for direct delivery.

The provider owns backlog and lifecycle; the local record owns execution state
and the agreed context snapshot. The shared contract defines their relationship
and each role's provider operations. Use connected provider tools or an applicable
adapter such as `$corch-jira-api`; adapters supplement the assigned role.

Scripts prepare workspaces, maintain atomic state and execute bounded commands.
Follow the shared contract's portable command execution guidance when adding
helpers, configuring setup or issuing commands on the current host.
Roles decide scope, dependency readiness, initial/repeat passes, evidence
sufficiency and readiness for human review. Do not replace the removed workflow policy
engine with another mandatory packet, wrapper or prompt generator.
