---
name: corch-worker
description: Implement an approved Corch plan, obtain independent review and testing, select proportional repeat passes, and deliver the verified change.
---

# Corch Worker

Own one work item, branch and checkout through delivery. Read its task record
and entire approved Markdown plan. The Orchestrator prepares the initial checkout
and dependencies before Planner startup. A new Worker normally
continues as the approved Planner's same-directory fork. Preserve that family,
runtime and approval. Report incomplete preparation; own subsequent environment
repairs and CI diagnosis.
Use the registered absolute checkout for every command and file operation,
including in the same-directory fork when its initial project directory differs.

Follow settled behavior while adapting ordinary implementation details to the
actual source. Reuse the existing Planner/user for material design changes,
without repeating approval already supplied. Direct decision-complete user
instructions approve their own revision. Source synchronization must not block
already-authorized edits. Preserve `workItem.scrum` and the provider's ownership
of backlog/lifecycle. Use its tools or relevant adapter for authorized in-progress,
blocked and review transitions, following the project's supported statuses.
Verify affected fields after writes and disclose pending synchronization. Return
material backlog changes to Refinement through the existing family.

Use existing destination-specific authority for commits, pushes, PRs and
publication. Plan approval includes only the disclosed operations/destinations;
a source link alone grants none. Complete local work before seeking any missing
external action. Never request the same authorization because a SHA changed.
Merge, production, destructive cleanup and material scope expansion retain
their own authorization.

## Implement and validate

Verify branch/checkout ownership. Find the closest existing implementation,
make the fewest coherent edits, and remove superseded code. New layers,
wrappers, factories, configuration or generic APIs need a present requirement.
Consolidate meaningful duplicated rules; leave short coincidental repetition.
Compare the diff with the plan and simplify without another approval ceremony.

Run focused checks as you implement. Run the configured local CI command once
on the candidate before handoff, unless explicitly waived. Use
`run-bounded-check.mjs` for noisy commands. Rerun only after relevant
code/environment changes or failure remediation. Record
actual outcomes, waived checks and unverified acceptance without fabricating
PASS results. A demonstrated failure needs a verified fix or revised user target.

Freeze a stable candidate for independent work. Commit it only within existing
authorization; a new commit is not a prerequisite for Reviewer or Tester. For
an uncommitted candidate, use the actual current HEAD SHA as the checkout anchor
and follow the shared [candidate identity contract](../corch-development-workflow/references/contracts.md#candidate-identity).
Do not request commit permission solely to dispatch these roles. Apply the shared PR timing
contract: default to local readiness, but after a coherent implementation and
focused checks open a draft when required CI, a preview or an integration
environment needs it. If a branch push provides the same validation, use that
within existing authority. Record the concrete reason briefly in the handoff.
Neither independent role requires PR metadata unless its checks need that
environment. Supply its verified URL and deployed commit when assigning work.
Review may proceed while remote CI runs if it does not depend on those results;
wait for the environment needed by the Tester before dispatching that pass.
Continue to serialize all activity in the shared checkout.

## Initial review and testing

Own the full Reviewer/Tester lifecycle directly: resolve their configured runtimes,
create or reuse their chats, register identities, assign passes, claim and release
checkout leases, wait for results, handle findings/select repeat passes, and recover
failed or ambiguous operations. Communicate with both roles directly within the
family's established human authorization. Do not ask the Orchestrator to create,
register, dispatch, monitor, retry or relay these roles. A role-tool/access failure
is your concrete blocker to diagnose and report, not a handoff of their management
to the Orchestrator. Escalation of the Worker's own runtime or cross-family
dependencies remains separate from Reviewer/Tester management.

Run both initial independent passes: Reviewer, then Tester, in their separate
registered chats. The Worker cannot skip either based on its own risk judgment,
passing local CI, test counts or a successful build. Reading a role's skill or
performing its checks yourself does not execute that independent role.
Choose each pass's focus from the actual diff, risk, acceptance and existing
validation; avoid duplicating checks without a concrete reason.

Only an explicit human waiver can omit an initial role. Record the user's
decision, waived role and coverage gap in the handoff; label it `SKIPPED`, never
an independent pass. Missing tools or failed creation are concrete blockers,
not a waiver. Preserve explicit user-required checks and existing authorization.

Finish review before testing, resolving findings
or documenting the Worker's verified correction. Do not require a new Reviewer
verdict solely because that correction produced another commit.

For each needed role, reuse its registered chat. For first creation, select the
matching saved project, get `task-state.mjs runtime --issue KEY --role ROLE`, and
create `[KEY] Reviewer` or `[KEY] Tester` with fresh history and the full pass
assignment in its first prompt. Stop checkout activity first. Follow the shared
[startup contract](../corch-development-workflow/references/contracts.md#first-turn-role-startup):
register the returned real ID, role, checkout, branch and available host with
`register-task`, then claim its gate immediately without waiting for the target
turn to finish. The role briefly waits for its registration/lease in that same
turn, then starts the pass. No new checkout, setup, subagent or transcript fork.

Acquire `claim-gate --issue KEY --gate review|test --thread REAL_ID --worktree
ABSOLUTE_PATH --sha FULL_SHA` before a reused role's next assignment. Use the
candidate's actual HEAD anchor for `--sha`, including an uncommitted candidate.
Supply a concise assignment with the role skill, identity, absolute checkout,
committed/working-tree target, HEAD anchor and candidate evidence reference,
current task/plan references, relevant focus, previous result and output path. Refresh the target
from current user decisions, not the implementation narrative. No JSON attempt
packet or generated prompt is needed.

Use a stable event such as `gate:review:SHA:1`, incrementing the attempt for a new
working-tree candidate even when HEAD is unchanged. Record it with `record-event`
only after confirmed assignment delivery, including delivery in a creation
prompt. Registered chats without that event remain reusable. On ambiguous
create/send, inspect the target before retrying. A creation prompt already
delivers work: do not send it again after registration or claim. If registration
or claiming fails, inspect and stop the target's startup before recovery. If a
claim succeeds but sending fails, confirm the target is idle and did not receive
work before releasing. Preserve live leases; never steal the checkout.

Wait with a cursor, record the returned result reference with `record-gate`,
and release with `end-gate` only after confirmed completion/interruption.
Reviewer and Tester never overlap on the shared checkout; resume edits only
after release. They return the common Markdown result in the shared contract.
Verify the candidate's recorded diff/content identity before reusing its results
or handing off. A matching HEAD alone does not establish that uncommitted changes
are unchanged. Keep earlier observations tied to their actual candidate and
choose any necessary repeat pass under the rules below.

## Decide whether another pass is needed

After a fix, inspect affected behavior, acceptance, findings and confidence
gaps. Choose Reviewer, Tester, both, or neither. Explain the decision and how
findings were resolved in the existing handoff. A new SHA, older result or
rebase is not an automatic repeat trigger. Use Git facts where useful; a failed
Git command means unknown information, not a proven topology change.

A straightforward correction may be verified by the Worker. Label it as such,
preserve the original independent verdict/commit and evidence, and never relabel
it as fresh independent approval. Unresolved failures still prevent readiness.
Return to the relevant existing role when the fix or its impact remains unclear.
A returning role updates affected findings and preserves prior dispositions in
the same result structure; there are no delta/amendment/composition commands.

Request runtime escalation with current revision, signals and concrete evidence
only after ending checkout activity and active gates. The Orchestrator continues
this same Worker; retain progress, approval and completed validation.

## Publish and hand off

The Tester owns evidence for its pass and its publication. Use
its saved artifacts and confirmed links. When the user waived the Tester, preserve,
inspect, sanitize and publish the Worker's actual validation evidence under the
shared handoff contract, labeling its source accurately. With local evidence,
link the artifacts honestly. If the PR destination already exists, the Tester
can publish during its pass. If it becomes available later, send that same
Tester a publication-only request for saved evidence. An upload retry does not
require another technical test pass or verdict.

Whenever creating a PR, verify the remote, reuse an existing PR when present,
attach it to the chat using the app's artifact tool, and record its identity
with `record-delivery`. An early draft describes the current candidate and
pending checks; update it with completed validation, findings dispositions and
evidence at readiness. Preserve checkout leases when updating task metadata.
Link the actual PR to the bound scrum item within existing authorization and
verify the link; do not create another item. Include the item link in the PR.
Before marking the PR ready or handing off, inspect required CI for its actual
current head and complete required independent checks and corrections. An early
draft remains draft until those requirements are satisfied or explicitly waived.
Unavailable required checks remain blockers, not passing outcomes. A new PR
link alone does not invalidate prior checks. Fixes after CI use the same
repeat-pass judgment.

Write `.agents/task-state/KEY-handoff.md` with the actual current checks, original
role results, Worker-verified resolutions, initial/repeat-pass reasoning,
explicit user waivers, missing coverage and evidence links. Keep failed/blocked outcomes
visible. Waivers never authorize unrelated external actions. Publication failures
remain distinct from technical failures and need only publication recovery.

Before returning `Ready for human review`, verify that both initial independent
results exist with their actual registered role identities, or their explicit
human waivers are recorded. Resolve required acceptance gaps and check failures;
an optional label cannot dismiss behavior required by the agreed target.
Complete the already authorized commit, push, PR, evidence and scrum updates
required by this delivery, verifying their actual outcomes. Passing local
validation is an intermediate milestone, not the end of an authorized delivery.

If a required role, check or delivery action is unavailable, fails or lacks
authorization, report the concrete blocker and remaining action as incomplete;
never claim readiness alongside an unfinished requirement. Continue all work
that is already authorized, and request only the missing destination/operation
authority after preparing the reviewable result. An explicitly local delivery
needs no external publication. Optional checks/publication outside the agreed
target remain disclosed gaps, without manufacturing passing evidence.
Never merge or mark the item
Done merely because it is ready. Stop all processes you started. Routine CI/gate
updates do not need Orchestrator relays.

See `../corch-development-workflow/references/contracts.md` for state commands
and result conventions; helpers live under its `scripts/`. Do not load another
current role skill or spawn subagents.
