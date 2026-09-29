# Corch shared data and mechanical commands

Roles own workflow judgments. These conventions carry the current target and
actual results without prescribing a generated prompt or a sequence of packets.
Read `.agents/workflow.json` for repository, scrum provider, prefix, base, runtime and setup.
`TASK-N` and branch examples below stand for those configured values.

## External scrum provider

For coordinated delivery, the external scrum provider owns the backlog, priority,
item lifecycle, acceptance and dependency relationships. Conversations/documents
supply requests; Refinement turns them into verified provider items. Direct user
decisions override older provider content. The local record holds the agreed context snapshot and Corch
execution state, including approval, runtime, ownership and technical results.
It does not replace the external backlog.

Configure `scrum.provider` (for example `jira`, `linear` or `github`) and a
credential-free `scrum.projectUrl` in `.agents/workflow.json`, or resolve them from
the user's selected project/item. Null/missing fields mean unresolved, not local
mode. Discover the provider's supported item types, fields, status transitions,
parent/dependency links and attachment capabilities through available tools.
Use a connected provider tool or a relevant adapter such as `$corch-jira-api`.
No provider CLI, dispatcher, normalized status engine or new executable is needed.
Keep credentials and private deployment identifiers in runtime configuration.

| Role | Provider responsibility |
| --- | --- |
| Refinement | Read the relevant backlog, check duplicates, create/update the bounded item, acceptance and dependency relationships, then verify the saved result. |
| Coordinator | Read the selected item and dependencies before dispatch; verify readiness, ownership and priority when prioritization is requested; reconcile lifecycle completion after verified merge and the project's completion criteria. |
| Planner | Plan from the agreed snapshot and linked item; return material scope discrepancies without silently redefining the backlog. |
| Worker | Keep authorized in-progress/blocked/review transitions and the eventual PR link current; disclose pending synchronization and never mark Done just for opening a PR. |
| Reviewer | Review the agreed target; return findings to Worker without independently editing the provider item. |
| Tester | Choose and publish acceptance evidence to the selected destination, which may be the provider item; return verified links without changing lifecycle status. |

Reuse established destination/operation authorization. Merely configuring a
provider or storing its URL grants none. Re-read affected fields after writes;
inspect ambiguous outcomes before retrying to avoid duplicate items/comments.
Do not overwrite concurrent provider edits from a stale local snapshot. Refresh
material context before dispatch, preserving newer direct user decisions and
reusing any existing approved family. Metadata-only changes do not restart roles.

An unresolved provider, inaccessible item or failed refinement write leaves new
refinement pending with a concrete blocker; a local draft is not a refined external
item. Existing authorized implementation can continue during an outage while
reporting pending synchronization. The router's direct-delivery eligibility
rules and explicit user instructions determine when work may proceed without a
provider item; an outage does not change that eligibility. Direct delivery needs
no task-family record. Evidence may remain local unless an external publication
destination and operation have been selected.

## Local execution record

`.agents/task-state/TASK-N.json` remains `task-state/v2` with
`workflowProtocol=delivery-v3`. It contains registered task identities, immutable
Worker runtime snapshots/history, plan/result references, an optional checkout
lease and delivered events. Older references remain readable. New records also
contain `workItem` and `delivery`; neither duplicates the plan or transcripts.

Run `task-state.mjs show --issue TASK-N` in the actual checkout. A linked
worktree reads its local record first, falling back to the primary record only
before its first local write. Mutations copy that latest fallback under the
local state lock. Later preparation never overwrites local decisions from the
primary cache. After registration, all family mutations target that checkout.

### Work item

`record-context --issue TASK-N --expected-revision N` reads one object from stdin:

```json
{
  "summary": "One bounded change",
  "outcome": "The resulting observable behavior",
  "acceptance": [{ "id": "AC-1", "text": "An observable acceptance criterion" }],
  "userDecisions": [],
  "constraints": [],
  "sourceRef": null,
  "scrum": {
    "provider": "jira",
    "key": "PROJ-42",
    "url": "https://tracker.example.test/browse/PROJ-42"
  },
  "dependencies": []
}
```

`sourceRef` may be null, a credential-free HTTPS URL, a repository-relative
document path, or `codex://threads/ID`. It identifies the originating input.
`scrum` identifies the verified external item with its provider, native key/ID
and HTTPS URL; it can differ from both `sourceRef` and the internal `TASK-N` key.
The example is synthetic. Use the real item and preserve its binding across
context revisions; a provider move/replacement needs verified reconciliation.
Legacy records, pending drafts and direct/local work may omit `scrum` or use
null. The helper validates fields; it neither contacts the provider nor decides
refinement readiness. Before dispatching legacy work, resolve its real provider
item without discarding its plan, approval or active family.

A hard dependency has `key`, `kind: "hard"`, `requiredMilestone: "merged" | "done"`,
`verified` and `evidence`. A coordination dependency has `key`,
`kind: "coordination"` and a concrete non-overlapping `boundary`. The helper
checks shape; Refinement verifies meaning and Coordinator decides readiness.

Start with expected revision 0. The helper stores `workItem.revision` and
increments it on changed content. An identical current/retried write is
idempotent. Conflicting stale updates fail without overwriting newer decisions.
Use file tools to stage stdin; never interpolate task text into shell code.

### Delivery identity

`record-delivery --issue TASK-N --expected-revision N` reads:

```json
{
  "repository": "example/project",
  "remoteUrl": "https://github.com/example/project.git",
  "baseBranch": "main",
  "headBranch": "corch/task-42-example",
  "pullRequest": null,
  "evidenceDestination": null,
  "allowedOperations": []
}
```

Use the real configured values and matching key, not these examples. Launch
identity cannot change after recording. `delivery.revision` uses the same
optimistic update semantics as context. Supply the full current object without
its saved `revision`, preserving previously recorded decisions, when adding
optional PR metadata: `{ "number": 123, "url": "https://github.com/owner/repo/pull/123" }`.
An external evidence destination is an explicit HTTPS URL. Null means local
delivery or a destination not yet selected. `allowedOperations` records the
actual established operations, for example `commit`, `push`, `create-pr`,
`publish-evidence`, `update-scrum-item`, `transition-scrum-item`, `ready-pr`; it grants nothing on its own. The agent must
verify the corresponding user authorization. A source URL is not that authority.

A PR is not an inherent prerequisite for any role. Its timing follows the
validation needs described below; adding a PR/evidence URL alone does not
invalidate technical results.

## Remaining helpers

All three executables are under `scripts/`, run with Node.js 22+ and Git, and
have `--help`. They require no runtime npm dependencies in an adopting project.

| Command | Responsibility |
| --- | --- |
| `prepare-worker-worktree.mjs` | With no arguments, Local Environment setup only. With `--issue`, `--thread`, `--worktree`, validate the task's prepared checkout/branch, register the real Planner and finish configured setup. |
| `task-state.mjs show` | Read the selected record without taking the writer lock. |
| `task-state.mjs record-context` / `record-delivery` | Store compact structured stdin with `--expected-revision`. |
| `task-state.mjs record-route` | Save initial classification, rationale, signals and resolved runtime. |
| `task-state.mjs runtime` | Read the runtime for `--role planner\|worker\|reviewer\|tester`; return app `model`/`thinking`, without generating a prompt. |
| `task-state.mjs escalate-route` | Atomically record an evidenced upward route change with `--expected-revision`; no active checkout lease. |
| `task-state.mjs register-task` | Record real role/thread/checkout/branch and optional host. Planner also uses `--kind task`. |
| `task-state.mjs record-plan` | Record the existing ignored Markdown path and positive revision. |
| `task-state.mjs claim-gate` | Atomically claim a registered Worker checkout and actual commit for a review/test thread. |
| `task-state.mjs end-gate` | Release the matching gate/thread only after the owner confirms completion. |
| `task-state.mjs record-gate` | Record an existing contained result file and its observed commit; no verdict interpretation. |
| `task-state.mjs record-event` | Deduplicate a stable event against its real target after confirmed delivery. |
| `task-state.mjs retire-task` | Retire the matching identity when its work is finished. |
| `run-bounded-check.mjs` | Run `--issue KEY --name LABEL [--timeout-ms N] -- COMMAND ARG...`, saving sanitized bounded logs and the actual outcome. Default deadline is 180000 ms; choose a suitable explicit deadline for longer checks. |

State mutations use an exclusive PID/token lock around read/validate/write.
Do not steal a live, stale or unverifiable lock. Check its owner before removing
only a confirmed abandoned lock file; never delete task state or clear a checkout
lease to repair a writer lock. Metadata changes cannot overwrite an active lease.
Legacy `begin-gate` remains an alias for a registered role, with the same checkout
and commit verification; new instructions use `claim-gate`.

Only one Reviewer/Tester uses the mutable Worker checkout at a time. The Worker
creates/registers, claims, sends, waits and releases. Role initialization ends
before claiming and assignment. On ambiguous app operations inspect the live
target and delivered event before retrying. State records are not live UI state.
No hook, dispatch executable or nested role orchestration is required.

## Portable command execution

Keep reusable helper logic in Node.js, using its filesystem/path APIs and
executable-plus-argument process calls. `lib/command-execution.mjs` owns the
platform-specific process adapter. On Windows, npm/pnpm/Corepack use their Bash
shims from PATH through Git Bash. The adapter discovers Bash beside Git's
execution directory; set `CORCH_BASH` to an absolute Git Bash executable path for
a custom installation. It fails clearly when Bash or the package manager's shell
shim is missing, without falling back to CMD or the WSL launcher.

The adapter passes literal arguments, disables Bash startup files and MSYS path
rewriting, and supports spaces, quotes and shell metacharacters without treating
them as shell code. The package manager still owns how project scripts execute;
their shell setting remains a project decision. Other executables run directly.
Windows process-tree cleanup uses the native `taskkill.exe` executable without
CMD; Linux and macOS launch executables directly and stop owned process groups.
Keep those operating-system branches inside the adapter.

Setup `command`/`args` and bounded-check arguments describe an executable and
literal arguments, not shell source. Put reusable multi-step logic in a Node.js
file instead of embedding pipes, command chaining or shell variable expansion.
An adopting project's own shell scripts may be invoked explicitly when their
shell is an established project requirement.

For interactive commands, inspect the actual host shell and use its quoting,
environment-variable and stdin syntax. A PowerShell command from one chat is
not a portable workflow instruction. Document common helper invocations as
single-line `node` commands; label any shell-specific examples. Run verification
on each supported operating system before claiming compatibility there.

## Runtime and plan

`lib/runtime-policy.mjs` owns defaults and `.agents/workflow.json.runtimes` owns
overrides. Worker routes retain `execution-route/v2` and their original model,
effort and revision history. Config edits affect new selections, not saved
Worker snapshots. Reviewer normally follows the saved Worker runtime; role
chats retain the runtime chosen at creation on subsequent passes.
Escalation ordering remains bounded/routine, standard/complex, high-risk,
exceptional. A stale revision requires a reread and rejected runtimes need
explicit correction. Never silently substitute another model.

The approved `.agents/task-state/TASK-N-plan.md` starts with
`# TASK-N Implementation plan`. Its reference retains `implementation-plan/v4`,
path and revision. The Planner owns design and plan updates; state checks file
identity, not design quality. Direct user decisions preserve their own approval.
The Worker and all other roles read the current record and referenced plan.

## Common Reviewer/Tester result

The Worker selects initial and repeat passes under its role skill. Only executed
passes produce independent results; skipped roles are explained in the handoff.
Both first and returning passes use readable Markdown at
`.agents/evidence/TASK-N/<observedSha>/<role>-<attempt>.md`. Keep completed
technical results and stable finding identities; state points at the latest
actual result for that role. Legacy JSON result files remain historical records
and need no automatic conversion. The following is required information, not
an exact heading, phrase, word-count or file-type validator:

- Identity: task, role, actual observed commit, relevant comparison range and
  optional previous result. PR metadata is optional.
- Verdict/summary: Reviewer uses `APPROVED`, `CHANGES_REQUESTED`, `BLOCKED`;
  Tester uses `PASS`, `FAIL`, `BLOCKED`.
- Acceptance covered, actual checks/outcomes, evidence references, explicit
  gaps and user waivers. Reused evidence retains its original observed commit,
  source result and rationale for applicability.
- Stable findings/failures, including a disposition for each previously open
  relevant item. Do not silently drop failures or turn a waiver into a pass.
- Publication status and actual verified external links or local artifact paths.

For its selected pass, Tester owns evidence sufficiency, inspection, sanitization
and publication in its role contract. Helpers neither decode images nor decide
whether a screenshot, log or other artifact proves acceptance. There are no evidence profiles/quotas,
mandatory reports, attempt packets, gate selection schemas or amendments.
On return, update the common result and retain earlier technical observations.

Worker decides subsequent role passes from changed behavior and remaining
uncertainty. It may verify a straightforward fix itself and document that
resolution without changing the original independent verdict or observed commit.
If it cannot establish the fix/impact, return to the appropriate existing role.
Neither a changed SHA nor an older review automatically demands another pass.

## Handoff and publication

The Worker writes `.agents/task-state/TASK-N-handoff.md` with current outcomes,
initial role selections and rationale, original role results, findings
dispositions, repeat-pass reasoning, evidence links and confidence gaps.
This is the human handoff, not a serialized gate.
Record each explicit waiver's user decision, reason, exact check and affected
acceptance here. `SKIPPED` means not executed; unverified acceptance is
`NOT_VERIFIED`, never PASS. Preserve real failures, blocked outcomes and older
observations. A failure requires a demonstrated fix or revised user target.

When no Tester was selected, the Worker preserves and publishes its actual
validation evidence within existing authorization. Inspect and sanitize artifacts,
keep them contained in the task's evidence directory, and explain what they prove
and who produced them. An omitted Tester is not an independent PASS, and evidence
publication alone never requires creating a Tester. Direct delivery reports its
checks and evidence in the current chat without manufacturing a task-family record.

Tester may publish to an already selected destination during its pass. For a
future PR, save technical evidence first and publish on a later publication-only
request. That request reads saved artifacts without source inspection or test
execution, needs no checkout execution lease, and does not issue a new verdict.
Preserve the technical result; append a publication receipt or return links for
the handoff. An upload failure changes publication status, not the test verdict.
Verify the destination and prior uploads/comments before retrying ambiguity.
Local evidence is sufficient when no external destination was selected.

## PR timing and readiness

Default to PR creation at local readiness after the selected independent checks
and necessary corrections. After a coherent candidate and focused local checks,
create a draft earlier when it unlocks the next required validation step: PR-only
CI, a preview deployment or a required integration environment. If a branch push
provides the same validation, use that without advancing PR creation. Record the
concrete reason in the existing handoff, or current chat for direct delivery.

Use existing destination-specific authority for the push, PR and any preview or
integration action; draft creation grants no merge or production authority.
Review can proceed while remote CI runs when its work does not depend on those
results. Supply the Tester with the required environment and verify its deployed
commit before the dependent pass. Keep shared-checkout activity serialized.
An available draft PR can be the authorized evidence destination immediately.

Opening a draft does not declare readiness. Before marking it ready or handing
off, complete required checks and corrections, inspect required remote CI for
the actual current head, and provide evidence and the updated change summary.
Preserve explicit waivers and their coverage gaps; unresolved failures need a
demonstrated fix or revised user target. Unavailable unwaived required checks
block readiness and remain disclosed. Rerun only checks affected by relevant
code/environment changes or failure remediation. No new approval or timing
packet is required when the action is already authorized.

## On-demand retrospective

When five comparable deliveries before and after exist, compare time to first
edit, approval interruptions, repeated checks without a relevant change, and
distinct defects accepted from independent roles. Link existing evidence and
mark missing measurements unknown. This is a manual assessment, not another
tracking file, dashboard, scheduled job or delivery gate.
