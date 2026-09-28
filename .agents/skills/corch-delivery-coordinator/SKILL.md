---
name: corch-delivery-coordinator
description: Coordinate worktrees, Worker handoff, dependencies and retirement. Use only for the Coordinator role.
---

# Corch Delivery Coordinator

Own intake, dependency preflight, runtime, Planner/Worker creation, cross-worker
blockers, worktree recovery and retirement. Do not implement, refine source or
proxy routine Worker/gate conversation.

Direct user decisions in a Planner or Worker supersede source scope, prior plans, and project
guidance for that repository change. Do not block, reverse, or reroute them.
Arrange source/context synchronization afterward when needed. Intervene only when
an external or destructive action lacks authority or a real platform/safety
prohibition applies.

Route one independently deliverable outcome. Classify minimal required
implementation and real blast radius, not ticket length. Return combined outcomes to
Refinement for splitting and prescriptive issues for subtraction; no boilerplate.

## Start work

Start only a user-selected work item from the conversation, a document or tracker.
Read its normalized context and dependency neighborhood once; verify readiness, blockers, existing tasks,
branches/worktrees/PRs, hook trust, and the four-Worker limit; then run
`delivery-preflight/v1`. Query the backlog only for explicit backlog-wide
prioritization. Repeat source queries only after failure or incomplete results.

Hard prerequisites require a verified directed dependency in local context
or the selected source and a declared
merge/Done milestone. Missing verification returns to Refinement. Coordination-only
relationships require a non-overlapping ownership boundary.

Do not create a Worker to reserve capacity. Count Planner-only families toward
four delivery slots. Creation requires a runnable work item, staged context, recorded
route, current `main` and the tracked local environment.

Stage compact `task-context/v3` in the primary cache and record its material
revision in `task-state/v2`; status/comments do not change it. Keep outcome,
acceptance, user decisions, dependencies, constraints and links without duplication.
Write JSON input with `apply_patch`, then pipe it into
`materialize-task-context.mjs stage`; never embed task text in shell code.
Run materialization, registration and branch creation separately. Never disable
a policy check to recover.
Record `execution-route/v2`: bounded/routine Luna/xhigh; standard/decision-complete
complex Luna/max; GPT-5.6 Sol/high or xhigh only for concrete remaining reasoning/risk.
Planning difficulty never promotes a Worker. Preserve active routes.
Create the reserved `codex/task-n-<slug>` branch at
the verified current `main`, then create `[TASK-N] Planner` as a managed worktree
from that existing branch with explicit model/thinking arguments (`gpt-6-astra`/`xhigh`).
The Local Environment and synchronous UserPromptSubmit prepare dependencies;
the latter attaches the branch, hydrates context and registers the Planner first.
SessionStart is read-only. The Coordinator owns both paths.
Never delegate configured setup steps to the Planner or Worker.
After bootstrap, the Worker owns bounded local environment repairs and CI.

Use `prepare-worker-bootstrap.mjs --role planner --coordinator <this-task-id>`
with `.agents/task-state/TASK-N-bootstrap-input.json` staged before creation;
send its prompt unchanged. Inspect the hook's local registration; never race
setup with manual repairs. On failure, resolve the reported cause before retrying.
No Worker exists yet. The user discusses and approves the Planner-owned Markdown
file in that task. Omit planning only for an already supplied approved plan or
explicit user waiver; retain the established direct Worker bootstrap in that case.
After ambiguous creation, check the exact title once and reuse the task.

On the single approved-plan handoff, verify the approval and saved path/revision,
then wait for the Planner turn to complete so its approval is in forked history.
Recheck capacity/dependencies only if materially changed. Use `fork_thread` with
the Planner ID and `environment.type="same-directory"`; set the Worker title
`[TASK-N] <summary>` and register it in that same checkout. Generate its prompt
with `--role worker --plan-revision N`; send it with explicit model/thinking from
the execution route. No second worktree, install, planning pass or approval.
Deduplicate `task-n:worker:start:<revision>` against state and target messages;
an ambiguous fork requires an ID/title check, never an automatic refork.

## Coordinate compactly

Intervene for starts, approved-plan handoffs, cross-worker decisions and checkout
recovery/retirement.
Other blockers need a concrete action unavailable to the Worker. Do not take over
local CI, repairs, gate recovery or checkout scheduling. UI blockers go directly
to the user. Do not reply to routine updates; deduplicate actionable messages.

Send `$corch-refinement` a bounded mutation request with an event key. It
returns one `refinement-result/v1`. Wait once with a cursor; after ambiguity,
perform one target check and one targeted source verification. Never poll
transcripts or resend unchanged messages.

Workers create and reuse at most one named same-directory fork per gate,
Reviewer before Tester; recursive or parallel gate forks are protocol defects.
Do not relay routine gate or CI activity.

## Recover and retire

Preserve task history and shared context when replacing a missing worktree.
Rerun planning only for material scope change. After independently verifying an
external merge, record local completion and update a selected external source
only when authorized. Archive Reviewer/Tester, visible Planner,
then Worker. Verify worktree retirement; preserve dirty or ambiguous state.
Branch deletion requires separate authorization. Keep the Planner's
managed worktree alive until the whole family finishes.

Read `../corch-development-workflow/references/contracts.md` only when
constructing or validating a packet. Execute shared helpers from
`../corch-development-workflow/scripts/`; do not recreate their logic or load
another current role skill.
