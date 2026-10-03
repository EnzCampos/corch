---
name: corch-development-workflow
description: Deliver eligible bounded Corch changes directly or route coordinated work through its delivery roles, preserving explicit user decisions and active families.
---

# Corch Delivery Router

For Corch installation, configuration or repair requests, use `$corch-setup`
directly. Changes to the toolkit's implementation still follow this router.

Apply project chat routing below before selecting a role for a new request.
Use the already assigned role's skill. An approved plan or existing family
continues at its current role; do not restart intake or repeat approval.
For new implementation requests, use direct delivery when the conditions below
hold; otherwise route to `$corch-refinement`. Explicit user instructions about
direct work, required roles or waived checks remain controlling.

Role skills are `$corch-project-orchestrator`, `$corch-refinement`,
`$corch-planner`, `$corch-worker`, `$corch-reviewer`, and `$corch-tester`.
Load exactly the applicable role. Keep mechanical helpers and shared data
conventions in this skill's `scripts/` and `references/contracts.md`.

## Project chat routing

In a project with persistent role chats, this routing applies to every project
chat, including ordinary exploration chats and Work Delegator. Discussion,
research and previews can remain where they started. When the user asks to turn
that discussion into backlog work (for example, "make that into a task"), send
the request and agreed context to the project's Refinement chat. Creating/refining
epics or issues, formalizing acceptance, and splitting backlog work belong there.
Selected refined work requested for coordinated implementation goes to the
Project Orchestrator. Loading a peer's skill locally is not a handoff and does
not assign this chat that role. A generic request to create a task is not an
instruction to bypass the registered role chat.

Continue locally when this chat is the verified destination, the human has
explicitly assigned this chat that role or requested local execution, or an
existing approved family already owns the work. Eligible direct implementation
can also remain here under the rules below; a backlog-creation request is not
direct implementation. Do not forward a role chat's own assignment back to itself
or restart an existing family.

Consult the primary checkout's `.agents/task-state/project-chats.json`, verify
the live peer's project and responsibility, and reuse human authorization for
that handoff. If the registry is missing or stale, discover existing project chats
before assuming the role is absent. The [project chat contract](references/contracts.md#persistent-project-chats)
defines discovery and messaging boundaries. If authorization is missing, ask
specifically to send the request; if discovery or messaging fails, report that
blocker instead of silently doing the peer's work. Neither case changes the role.
If discovery confirms the project has no provisioned role chat, use the applicable
skill locally under the ordinary workflow; do not create a chat without a request.

Send the user's request, relevant decisions, source/item links and unresolved
questions once. Preserve a handoff already in progress, inspect ambiguous send
results before retrying, and confirm receipt with the app's wait/status tools.
Report the actual destination and status. Do not start implementation merely
because Refinement has received a backlog request.

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
Assess eligibility from the actual change, not passing test/build output. An
active coordinated family stays coordinated; a Worker cannot switch to direct
delivery to omit its required independent roles.

Reuse established authority for commits, pushes and PRs. An implementation
request authorizes local edits and validation, not external publication. Finish
the reviewable patch before seeking missing external authority. For authorized
PR delivery, use an appropriate `corch/` branch without publishing unrelated
changes, and follow the shared PR timing/readiness contract. Do not create a
delivery family solely to record a direct change or its PR.

## Coordinated delivery

Refinement establishes the outcome in the external scrum provider's backlog;
the Orchestrator prepares the family; the Planner resolves implementation with
the user. The Worker owns implementation, initial independent Reviewer and
Tester passes, corrections and delivery. Both initial roles are required unless
explicitly waived by the human; local validation never substitutes for them.
The Worker selects repeat passes proportionally under its role skill.

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
