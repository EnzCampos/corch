---
name: corch-delivery-coordinator
description: Coordinate worktrees, Worker handoff, dependencies and retirement. Use only for the Coordinator role.
---

# Corch Delivery Coordinator

Own intake, dependency preflight, runtime, Planner/Worker creation, cross-worker
blockers, worktree recovery and retirement. Do not implement, refine source or
proxy routine Worker/gate conversation.

Direct Planner/Worker user decisions supersede source scope, prior plans and project
guidance. Do not block, reverse, or reroute them. Synchronize context afterward. Intervene only for missing
external/destructive authority or an actual platform/safety prohibition.

Route one deliverable outcome by minimal required implementation and real blast radius. Return
combined outcomes to Refinement for splitting and prescriptive issues for subtraction.

## Start work

Start only a user-selected work item from the conversation, a document or tracker.
Read its context and known dependency neighborhood once. Check readiness, completion,
blockers, active families, ownership, branches/worktrees/PRs, hook trust and the
four-Worker limit. Only when selected work or that neighborhood contains hard or
coordination relationships, run `assess-delivery-preflight.mjs` with `delivery-preflight/v1`.
Dependency-free work skips both helper and packet, including unrelated Coordinator
items. Query the backlog only for explicit backlog-wide prioritization.

Hard prerequisites require a verified directed dependency and merge/Done milestone
in context or the selected source. Return unverified links to Refinement.
Coordination-only relationships require a non-overlapping ownership boundary.

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
Record `execution-route/v2` once with `task-state.mjs record-route` (classification,
rationale and risk signals); `workflow.json` and `lib/runtime-policy.mjs` own runtime settings.
Planning difficulty never promotes a Worker. Preserve active routes.
Create the reserved `codex/task-n-<slug>` branch at
the verified current `main`, then create `[TASK-N] Planner` as a managed worktree
from that existing branch with the helper's explicit model/thinking arguments.
The Local Environment and synchronous UserPromptSubmit prepare dependencies;
the latter attaches the branch, hydrates context and registers the Planner first.
SessionStart is read-only. The Coordinator owns both paths.
Never delegate configured setup steps to the Planner or Worker.
After bootstrap, the Worker owns bounded local environment repairs and CI.

Use `prepare-worker-bootstrap.mjs --role planner --coordinator <this-task-id>`
in the primary checkout with bootstrap identity; omit `executionRoute`.
It reads saved state and writes nothing. Stage its returned `bootstrap` at
`.agents/task-state/TASK-N-bootstrap-input.json` before creation; send its prompt
unchanged with its runtime. Inspect hook registration; never race setup with
manual repairs. Resolve failures before retrying.
No Worker exists yet. The user discusses and approves the Planner-owned Markdown
file in that task. Omit planning only for an already supplied approved plan or
explicit user waiver; retain the established direct Worker bootstrap in that case.
After ambiguous creation, check the exact title once and reuse the task.

On the single approved-plan handoff, verify the approval and saved path/revision,
then wait for the Planner turn to complete so its approval is in forked history.
Recheck capacity/dependencies only if materially changed. Use `fork_thread` with
the Planner ID and `environment.type="same-directory"`; set the Worker title
`[TASK-N] <summary>` and register it in that same checkout. Generate its prompt
with `--role worker --plan-revision N --worktree <absolute-worker-checkout>`;
send its explicit model/thinking from the latest recorded route. No second
worktree, install, planning pass or approval. Deduplicate its `worker-route:N`
event against state and target messages, then record it after confirmed delivery;
an ambiguous fork requires an ID/title check, never an automatic refork.

## Coordinate compactly

On a Worker escalation request, wait for that turn to complete and confirm no
checkout gate lease is active. In its checkout run `task-state.mjs escalate-route`
with the expected revision, destination classification, concrete risk signals and
evidence-based rationale. Only upward moves are allowed: bounded/routine →
standard/complex → high-risk → exceptional. Legacy routes start at revision 1.
Generate Worker continuation again from the latest saved state and continue the
same registered Worker using explicit model/thinking. Preserve plan approval,
checkout, progress and completed validation. Check `deliveredEvents` before
sending; after an ambiguous dispatch inspect that chat for the route event before
resending. Record the event only after confirmed delivery. A stale revision needs
a state reread, never a blind retry. If Codex rejects a runtime, report the exact
model/effort and error for configuration correction; never silently downgrade or
substitute another model. Existing recorded runtimes are snapshots, not policy
revalidations against today's config.

Intervene for starts, approved-plan handoffs, cross-worker decisions and checkout
recovery/retirement.
Other blockers need a concrete action unavailable to the Worker. Do not take over
local CI, repairs, gate recovery or checkout scheduling. UI blockers go directly
to the user. Do not reply to routine updates; deduplicate actionable messages.

Send `$corch-refinement` a bounded mutation request with an event key. It
returns one `refinement-result/v1`. Wait once with a cursor; after ambiguity,
perform one target check and one targeted source verification. Never poll
transcripts or resend unchanged messages.

Workers create fresh Reviewer/Tester chats with `create_thread`, then reuse each
registered chat for corrections, Reviewer before Tester. No subagents, recursive
gates or parallel checkout gates. Existing families and gate chats remain valid.
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
