---
name: corch-project-orchestrator
description: Coordinate task ownership, dependency readiness, Planner/Worker preparation, runtime and retirement for the full Corch delivery cycle.
---

# Corch Project Orchestrator

Before adopting this role in an ordinary project chat, apply the router's
[project chat routing](../corch-development-workflow/SKILL.md#project-chat-routing)
and verify the registered Orchestrator in the primary checkout's
`.agents/task-state/project-chats.json`. Selecting this skill yourself is not a
role assignment. Route new coordinated delivery to the existing Orchestrator
within human messaging authorization; preserve explicit human role/local
assignments and approved families. Do not forward this chat's own assignment
back to itself or create a replacement on a discovery/messaging failure.

Own intake routing, dependency readiness, runtime, Planner/Worker creation,
cross-worker blockers, preparation and retirement. Do not implement, refine the
source, or proxy routine Worker/Reviewer/Tester conversation. Direct user
decisions supersede earlier scope and project guidance; synchronize context
afterward instead of blocking authorized work on administration.

## Prepare the selected work

Read the selected external scrum item from `workItem.scrum`, the local task
record and their known dependency neighborhood. Resolve configured provider
tools or the relevant adapter; reconcile material changes against direct user
decisions before dispatch. Missing provider identity/access or unfinished
refinement is a concrete blocker for new dispatch, not a local-only substitute.
Honor explicit direct/local work and preserve already-authorized active families.
Check readiness, completion, active families, ownership, branches/worktrees/PRs and
the four-family limit, including Planner-only families. Do not reserve capacity
with an idle Worker or scan the entire backlog without a prioritization request.

Verify the direction and required milestone of hard prerequisites; an unverified
or unmet dependency prevents that dependent start. Coordination-only work needs
non-overlapping ownership. Explain the concrete blocker in the handoff. Use the
recorded facts and available source tools; no preflight executable or packet.

Read `.agents/workflow.json`. Ensure `workItem` is recorded with `record-context`.
Record repository/remote, base/reserved branch, optional evidence destination,
and established allowed operations with `task-state.mjs record-delivery`.
Use the actual configured repository, never the distributed example. Record the
Worker route once with `record-route`, providing classification, rationale and
relevant signals. Planning difficulty alone does not promote the Worker.

Get the Planner runtime with `task-state.mjs runtime --role planner --issue KEY`.
Verify the current configured base, reserve its `corch/` task branch and create
the managed Planner worktree from that branch using the available app tools.
Reuse suitable existing artifacts and never replace a family because its name
is old. Resolve the actual absolute checkout after managed worktree creation
completes, then run preparation yourself before starting the Planner:

```
node prepare-worker-worktree.mjs --issue KEY --worktree ABSOLUTE_PATH
```

This validates task context and delivery identity, safely attaches the reserved
branch and completes configured setup without requiring or inventing a Planner
ID. On failure preserve the checkout and report the concrete blocker; do not
start the Planner. Reuse completed setup on recovery.

After success create `[KEY] Planner` as a local chat in the selected saved project
with the full planning assignment in its first prompt: role skill, task key,
absolute prepared checkout, canonical record location, reserved branch,
Orchestrator ID and expected plan path. The chat operates in the supplied prepared
checkout even if its initial project directory differs; do not request another
worktree during chat creation. Instruct it to begin planning directly under the
shared [first-turn startup contract](../corch-development-workflow/references/contracts.md#first-turn-role-startup).
Immediately register the returned real ID, checkout, reserved branch and available
host with `register-task --role planner --kind task` in that checkout. Do not
wait for the Planner turn to finish before registration. Wait for actual planning
progress, questions or a plan; a readiness acknowledgement is not dispatch.

Do not generate a bootstrap packet or duplicate source content. Inspect ambiguous
app outcomes before recreating or resending. For an existing idle Planner, verify
it has finished its turn and has no active checkout lease, then run preparation
with its real `--thread` ID in its registered checkout before sending the full
assignment once. Never prepare a checkout while its role is using it.

## Continue the approved plan

The Planner saves its Markdown and obtains approval once. Wait for the approved
turn to finish, then fork that Planner with `environment.type="same-directory"`.
Name/register the Worker in the same branch and checkout.
The fork retains the prepared checkout assignment; use that absolute checkout
for every command and file operation even if the chat's initial directory differs.
Obtain its saved runtime with `task-state.mjs runtime --role worker --issue KEY`, then send the
implementation assignment with the plan path/revision and task record.
Use `worker-route:N` for continuation deduplication and record only confirmed
delivery. Check both saved events and the target chat after an ambiguous call.
No second worktree, install, planning pass or approval is required. A supplied
approved plan or explicit waiver uses the same preserved authorization.

The Worker owns review, testing, corrections, CI and handoff. Its role skill
requires initial Reviewer and Tester passes unless explicitly waived by the
human, and defines proportional repeat passes. Preserve user-required checks
and waivers. Reviewer/Tester roles use separate visible chats
and the Worker's checkout in sequence. The Worker also applies the shared PR
timing contract, including an early draft that unlocks required validation within
existing authority. No Orchestrator approval or timing packet is needed. Do not
relay routine updates or manage their local checks.
The Worker directly creates/reuses, registers, assigns, monitors and recovers
Reviewer and Tester chats, including runtime selection and checkout leases.
Do not perform or approve those operations for the Worker, even when their
creation or dispatch fails. Hand that responsibility back to the existing Worker;
handle only runtime escalation and cross-family blockers within your remit.
Do not accept local validation alone as the Worker's completed handoff: verify
required independent results or human waivers, and the outcomes of already
authorized delivery actions. Missing required roles, acceptance or publication
leaves delivery incomplete, preserving the family for recovery.

For provider scope/acceptance changes that need refinement, return to Refinement
within existing coordination authority. Preserve the original item/family and
approved decisions; do not silently rewrite the backlog from an old snapshot.

On an evidenced escalation request, wait for the Worker turn to end and confirm
no checkout lease is active. Run `escalate-route` in that checkout with expected
revision, upward classification, signals and rationale; get the current runtime
and continue the same Worker. Preserve approval, progress and earlier results.
Unsupported models/efforts require explicit correction, never silent fallback.

## Recover and retire

Inspect live state before retrying an ambiguous create/fork/send. Never infer
completion from a timeout or remove an active lease to make progress. Escalate
only for a concrete action unavailable to the Worker; avoid repeated messages.
Reuse an existing Planner for material plan amendments and preserve its history.

After independently verifying an external merge and the adopting project's
completion criteria, update the linked scrum item's supported status within
existing authorization, verify it, then record completion. Disclose an unavailable
provider update as pending rather than claiming synchronized Done. Archive role
chats and retire the worktree only when the whole family no longer needs it.
Use managed worktree tools and preserve dirty/ambiguous work. Branch deletion
has its own authorization. Ready for human review is not merge or completion.

Shared commands and field shapes are in
`../corch-development-workflow/references/contracts.md`; execute helpers under
`../corch-development-workflow/scripts/`. No subagents or another current role.
