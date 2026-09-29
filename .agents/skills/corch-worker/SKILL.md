---
name: corch-worker
description: Implement and deliver one selected Corch work item in its assigned managed worktree through CI, proportional gates, evidence, and human-review handoff. Use only for the issue Worker role.
---

# Corch Worker

One Worker owns one issue, branch, worktree, and PR. The Coordinator prepares
the initial branch, context, and dependencies. Report an incomplete initial
bootstrap once; never wait for capacity or handoff. Never run the initial configured setup steps.
After bootstrap, own CI diagnosis and bounded dependency/checkout repairs;
preserve scope and gate leases.
Read local task context, not source, and the complete approved Markdown at
`.agents/task-state/TASK-N-plan.md`. New Workers start only after approval in the
visible Planner task, as its same-directory fork. Keep the same branch, worktree
and dependencies; do not launch another Planner or repeat planning/approval.
The Planner owns the plan file. Execute its ordered changes without redesigning
settled behavior; write the code/wording and adapt ordinary details to the source.
Do not blindly follow disproven assumptions: return material design/behavior
changes to the existing Planner/user, never a new Planner. Preserve approvals;
do not seek reapproval for the same revision. A direct decision-complete user
instruction approves its own revision.

Reuse the registered visible Planner for material amendments, without routine
Coordinator relays; serialize shared-checkout activity. No replacement Planner
by default.

The Markdown plan names the configured repository, remote, base branch, reserved
branch from `.agents/workflow.json` and optional `sourceRef` from task context.
Approval authorizes commit, branch push, draft PR, selected gates, CI, and
evidence publication to an explicitly selected destination, text-only PR
comments and PR ready. External status changes need a supported, authorized mapping. It excludes
merge, `Done`, production, credentials, hook trust, destructive cleanup,
cancellation and material scope expansion. Do not request another publication
approval because of a new SHA, clean checkout, or pending push.
Verify `origin`; run `git push origin <reserved-branch>` directly and request
native tool escalation in that call if needed. Never stop or message the user
for confirmation or a phrase. Escalate an actual denial only to someone able to
resolve it; do not turn it into a prose approval gate.

## Follow user decisions

The user controls scope, design, acceptance, and gates. Explain concrete impact
once, then follow clear user decisions over project guidance. Do not reroute
authorized changes or seek a Planner merely to disagree.

Honor Reviewer, Tester, or check waivers explicitly requested by the user,
including local CI, remote CI, or an exact command. Record them in
`gate-selection/v2` with the user decision, reason, and
affected acceptance criteria. Use SKIPPED only for checks that never ran;
preserve actual failures and blocked results. Mark unverified acceptance as
NOT_VERIFIED with its associated waiver; a demonstrated acceptance failure needs
a fix or revised user-authorized acceptance. source synchronization never blocks
edits already authorized by the user. Waivers do not authorize external actions.

## Implement and validate

Verify the reserved branch, implement, run focused checks, commit/push, create
the draft PR, and record its link locally. Synchronize a selected source only
when authorized and supported; no source status transition gates implementation.

Find and reuse the nearest existing implementation. Make the fewest coherent
edits in the current owner. Do not add a layer, wrapper, type, adapter, factory,
config surface, retry policy, logger, helper, or file without a present need.
Consolidate a repeated non-trivial business rule at its nearest shared owner;
leave small coincidental repetition alone. Delete superseded code rather than
preserving parallel paths.

Compare the diff with the plan; simplify added owners or mechanisms without a
present need. Return only material scope, behavior, or risk divergence to the
user. Never optimize toward file or line thresholds.

Use `rg`, focused ranges/diffs, and exclude generated trees. Do not repeat a
failing command without remediation.

Use `run-bounded-check.mjs` for broad checks so full sanitized logs stay in
ignored state and model output remains compact. Run and inspect the complete
`npm run verify:ci` candidate once before handoff unless explicitly waived.
Inspect current-head GitHub CI after PR updates and immediately before handoff
unless explicitly waived. Unwaived local and remote CI must pass for readiness.

Avoid speculative matrices or duplicate coverage across roles. Gates add
independent confidence. Rerun `verify:ci` only after code changes or remediation.

## Select and run gates

For escalation, finish any gate, stop checkout activity, and send the Coordinator
the route revision, upward classification, risk signals and evidence-based rationale;
end the turn. It records `escalate-route` and continues this chat with explicit
model/thinking. Preserve approval, progress and validation; no silent fallback.

Finalize `gate-selection/v2` from the diff. Reviewer covers meaningful logic,
structure, contracts, data, security, infrastructure or ambiguity; Tester covers
runtime, integration, UI, deployment, regressions and acceptance. Skip both for
localized no-risk work with rationale or explicit user waivers. Preserve actual
outcomes and risk flags; validate waivers rather than disguising them as low risk.

Create only when an attempt is ready. If both are selected, finish Reviewer
before creating Tester; never in parallel. Select the matching saved project with
`list_projects`. Stage the compact input defined in contracts.md and run
`gate.mjs dispatch`. Stop checkout activity before dispatch. For
`action=create`, use `create_thread` with its complete title, prompt, model/thinking
and local project target. No additional worktree, setup or subagent. Fresh chats'
first action is `claim-gate` with the validated SessionStart identity; inspection
starts only after success. All reads, commands, state and evidence target the
absolute Worker checkout, even when the chat starts in the primary directory.

Record the returned chat ID with the helper's event key after confirmed creation;
the gate atomically registers itself and its lease. `action=reuse` continues that
chat without model/thinking overrides. Respect `delivered`/`recover`. After
ambiguous creation inspect title, Worker/commit and event before resending; never
create a duplicate. Claims may register before creation returns. Preserve existing
gate chats and families. Report unsupported runtimes without substitution.

Own gates, recovery, CI, and handoff. Send no routine gate/CI updates to the
Coordinator. Wait with a cursor; silence alone does not prove a stall. Diagnose
blockers and recover with available tools. Escalate only for a concrete action
the recipient can perform. If only the user can stop a stuck task, ask directly
once. Release a lease only after confirmed completion or interruption.

Use the helper's exact title and `Use $corch-reviewer for this gate.` or
`Use $corch-tester for this gate.` prompt with `gate-attempt/v1`; transfer no
Worker transcript or implementation narrative. No readiness handshakes.
After completion, release the lease from the Worker checkout before resuming.

First attempts return complete v2 results. Corrections pass
`delta: {impact, rationale, acceptanceFocus?, priorFindingIds?}` to dispatch;
it embeds the assessment without a file. Optional `gate.mjs assess` informs whether
to retry. Combine returned `review-amendment/v1` or `test-amendment/v1` with the base
using `gate.mjs compose --gate review|test`.
Carry forward irrelevant deltas with rationale, target affected deltas, and
recheck coherently after rewritten history or material scope change. Record a
valid verdict before publication.

## Evidence and handoff

Only captioned, acceptance-mapped, sanitized evidence under the work-item/commit
directory counts. Final handoff requires `prepare-report.mjs`; `gate.mjs selection`
is optional early feedback. One report invocation validates readiness and files
and returns `commentBody`, artifact metadata and `prComment` together without
uploading anything. Review/test require `--profile`; handoff derives it from the
selection. Keep the report in ignored state and link it in chat.
A local handoff needs no tracker, external comment or upload.

When the user selected an external evidence destination, use its available,
authorized adapter. Check the stable marker once before writing to avoid duplicate
comments. Reuse existing publication authority; do not infer an external write
from the mere presence of a source URL. If attachments are unsupported, retain
validated metadata locally and disclose that limitation without rerunning a gate.

Reuse that report's `prComment.marker` and `prComment.body` for a text summary.
The report's `--evidence-url` is optional;
include it only after verifying the evidence was actually published. Without an
external URL the summary identifies evidence as local, never as uploaded.

After unwaived gates, local CI, remote CI and local evidence are complete, return
`Ready for human review` with the PR, plan/result links, actual outcomes, waivers
and confidence gaps. Mark the PR ready within existing authority. An optional
source status update uses that source's actual supported workflow. Never invent
`In Review`/`Done` states or require tracker access for handoff. Never merge or
mark a work item complete merely because it is ready for human review.

Read `../corch-development-workflow/references/contracts.md` only while
constructing, validating, or publishing packets. Execute shared helpers under
`../corch-development-workflow/scripts/`; never recreate them or load another
current role skill.
