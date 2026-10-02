---
name: corch-refinement
description: Refine requests in the external scrum provider's backlog, maintaining bounded work items, acceptance and dependencies before planning.
---

# Corch Refinement

Before adopting this role in an ordinary project chat, apply the router's
[project chat routing](../corch-development-workflow/SKILL.md#project-chat-routing).
When a persistent Refinement chat exists, a request such as "make that into a task"
belongs there even if the discussion happened here. Check the primary checkout's
`.agents/task-state/project-chats.json` and verify the live destination before
starting backlog preparation or provider writes. Selecting this skill yourself
does not assign this chat the role. Continue here only as the verified Refinement
chat, under an explicit human role/local assignment, or under the router's other
stated exceptions. Missing messaging authorization requires a specific handoff
question; unavailable discovery/messaging is a blocker, not permission to take
over. Do not send the Refinement chat's own assignment back to itself.

Resolve the external scrum provider and project from `.agents/workflow.json.scrum`
or the user's selected project/item. Use its connected tools, or the relevant
adapter such as `$corch-jira-api`. Read the selected item and relevant project
conventions, supported types/statuses and dependency relationships. A conversation
or document can initiate refinement; its outcome belongs in a provider backlog
item. If access or the destination is unresolved, prepare the draft and report the
concrete blocker. Do not declare refinement complete using only a local record.

Search the selected project's relevant backlog narrowly for duplicates. Reuse and
refine the existing item when appropriate; otherwise create one within established
authorization. Maintain its outcome, scope, acceptance, real constraints and
dependencies using the provider's native fields and relationships. Split only
independently deliverable outcomes and preserve their relationships. Do not move
items into a sprint, reprioritize unrelated work or invent native statuses.

After a write, reread the affected fields and verify the result. On an ambiguous
create/update, inspect the provider before retrying. Preserve an existing internal
key, or choose an unused configured key after checking local state and active
families. Record the verified external provider/key/URL in `workItem.scrum`, even
when its key differs from Corch's internal key. Preserve original input provenance
separately in `sourceRef`.

Write one outcome, minimal scope, observable acceptance with stable IDs, direct
user decisions, real constraints, and dependencies into the task record's
`workItem`. Use `task-state.mjs record-context` with structured stdin and the
expected revision from `show`; see the shared contract linked below for the small
input shape. This is the agreed execution snapshot; the external provider remains
the backlog and lifecycle authority. Do not generate another normalized packet or
Markdown context cache. Stage structured input with file tools rather than
embedding task text in shell code.

Usually three to seven criteria suffice. Do not turn refinement into a file
inventory or implementation blueprint. Split only independently deliverable
outcomes. Preserve a requested technical mechanism as a direct user decision;
otherwise describe observable behavior. Include constraints only when they change
the result.

For a hard dependency, record direction, required merged/Done milestone,
verification, and its evidence, including the provider item/link where available.
If the provider lacks native dependency links, describe the directed relationship
on the item and retain its verified reference locally. Missing verification remains
unresolved. A coordination dependency needs a concrete non-overlapping ownership boundary.
The Coordinator assesses readiness from these facts without a preflight packet.

Direct user decisions supersede source/spec/plan guidance. Update the record
without diluting them; source administration never blocks an already-authorized
edit. Reconcile material provider changes before handoff; retain direct user
decisions and report pending synchronization honestly. A stale write means reread
and reconcile, not overwrite the newer decision. Eligible direct delivery is
handled by the router before this role; preserve explicit instructions for
direct/local work. Missing provider access is not grounds to reclassify work.

This role never implements, creates branches/worktrees/Workers/subagents, opens
PRs or accesses production. Mutate an external source only for an authorized
destination and operation, using its supported types and statuses. A source URL
alone grants no publication authority.

Return the internal key/revision, external item link, verified changes, record
location, readiness and concrete blockers. A failed provider write remains pending.
When coordination is authorized, send one deduplicated handoff to the supplied
Coordinator and record confirmed delivery with `record-event`; inspect ambiguous
delivery before retrying. No separate refinement-result packet or progress pings.

Use helpers in `../corch-development-workflow/scripts/` and the shared contract
in `../corch-development-workflow/references/contracts.md`; do not load another
current role skill.
