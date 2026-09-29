# Delivery Packet Registry v3

- `task-context/v3`: compact normalized source planning data: one outcome,
  acceptance, direct user decisions, dependencies, constraints, and links. The coordinator
  stages it in shared ignored context before Planner creation; UserPromptSubmit
  hydrates the shared Planner/Worker checkout. Status/comments do not change
  material revision.
- `task-state/v2`: `workflowProtocol=delivery-v3`, task identities, execution
  route, context path/revision, shared checkout lease, gate results, retirement,
  and delivered events. `tasks.planner` records require `kind="task"` for a
  visible Planner. The Planner creates the plan before Worker creation;
  both tasks use the same registered worktree/branch.
- `execution-route/v2`: immutable runtime snapshot for implementation. Configuration
  and defaults are resolved by `lib/runtime-policy.mjs`; validation checks shape, not
  equality with current configuration. `task-state/v2.executionRouteRevision`
  defaults to 1 for old state; `executionRouteHistory` contains prior
  `{revision, route}` snapshots. `escalate-route --expected-revision N` atomically
  advances upward with classification, risk signals and rationale, rejecting stale
  revisions and active checkout leases. Identical retries preserve the snapshot.
- `worker-bootstrap/v2`: work-item key/title/source reference, reserved branch, exact delivery
  target, execution route, and local context path.
  Record the route once with `task-state.mjs record-route`, then pass the bootstrap
  identity to `prepare-worker-bootstrap.mjs`; its CLI input may omit `executionRoute`.
  Both roles read the saved route from `--worktree` (default current directory).
  An embedded snapshot is validated but never overrides saved state; missing or
  malformed state fails without fallback. The helper returns a complete `bootstrap`
  alongside dispatch fields and writes nothing. Stage that object as
  `.agents/task-state/TASK-N-bootstrap-input.json` in the primary checkout before
  Planner creation. Stored packets remain strict v2; no separate route file is needed.
  New Planner prompts carry `Corch bootstrap: TASK-N`; the synchronous hook
  validates it against staged state/input, safely attaches the reserved branch,
  hydrates context and registers the hook session ID before dependency verification.
  SessionStart is read-only and exposes a validated Corch session ID; unmarked
  prompts do not trigger preparation.
  New dispatch uses `prepare-worker-bootstrap.mjs --role planner --coordinator ID`
  first, then `--role worker --plan-revision N --worktree <absolute-checkout>` only
  after the user approves the saved plan. The latter reads the latest saved route,
  returns explicit runtime and `worker-route:N` deduplication metadata, and reads
  the plan without another planning pass. Capacity/setup holds, handoff waits,
  and readiness turns are invalid; the packet never embeds full source text.
- `implementation-plan/v4`: the authoritative Markdown at
  `.agents/task-state/TASK-N-plan.md`, starting with `# TASK-N Implementation plan`.
  New launches request the code-first format owned by `$corch-planner`: executable
  edit instructions in the file, decision discussion and approval summary in chat.
  The Planner saves the file before requesting one approval for that revision;
  the Worker reads it from the same checkout. State stores
  only `{schemaVersion, path, revision}`; no duplicate content or content hash.
  Registration checks file identity, not design quality; the Planner and Worker
  must assess completeness. Amend the same Markdown and increment its reference.
  A clear direct user decision authorizes its revision without an approval loop.
- `delivery-preflight/v1` / `delivery-preflight-result/v1`: unchanged dependency
  snapshot and assessment contracts. Required only when selected work or its known
  delivery neighborhood contains hard or coordination relationships. Dependency-free
  work skips the helper and packet, including unrelated Coordinator items. Always
  check readiness, completion, capacity, active families and ownership. When applied,
  verify directed dependencies, block unmet merge/Done milestones and enforce
  declared concurrency boundaries. Direct delivery needs no task packets.
- `gate-delta-assessment/v1`: local ancestry, changed paths/statistics, explicit
  impact/rationale, action, acceptance focus, prior finding IDs, and requested result.
  Dispatch computes and embeds it directly in `gate-attempt/v1`; no assessment file
  is needed. Standalone assessment remains available for deciding on another attempt.
- `gate-attempt/v1`: role, PR/current/comparison commits, topology/action,
  comparison range, impact/rationale, changed paths/statistics, acceptance focus, prior finding IDs, validation, and
  requested result. Fresh chat prompts add Worker identity, repository/branch,
  absolute checkout, current acceptance/user decisions/waivers, context/plan
  references and result destination. No transcript, implementation narrative,
  full source packet, plan, role contract or diff is transferred.
- `review-result/v2` / `test-result/v2`: complete first/current technical result.
- `review-amendment/v1` / `test-amendment/v1`: base result path, issue/current/
  comparison commits, verdict/summary, acceptance updates, explicit carry-forward
  rationales, current findings/failures, explicit resolved finding/failure IDs,
  targeted commands, and artifacts. The composer outputs the complete validated
  v2 result and rejects any base finding/failure without a current or resolved
  disposition.
- `gate-selection/v2`: final Worker gate decisions, evidence, outcomes,
  current-head local/remote CI, and optional explicit user waivers. Unwaived
  checks retain their existing passing handoff requirements.
- `refinement-result/v1`: event key/revision, internal key/source reference, change summary,
  readiness, blockers, and dependency links.

## Input and evidence destinations

`gate.mjs dispatch` reads JSON from stdin: `issueKey`, `gate` (`review` or
`test`), absolute `worktree`, matching saved `projectId`/`projectPath` from
`list_projects`, `observedSha`, optional `comparedFromSha`, `pullRequest`
(`number`, `url`), current string arrays `acceptanceCriteria` and `userDecisions`,
optional contract `waivers`, `validation` command outcomes, `reviewDecision`
(`decision`, `rationale`), positive stable `attempt` number, and checkout-relative
`resultPath` under `.agents/evidence/<issue>/<sha>/`. Optional `delta` accepts
`{impact, rationale, acceptanceFocus?, priorFindingIds?}`, with impact one of
`irrelevant`, `affected`, `material`. Gate and commits come from the surrounding
request. A complete `gate-delta-assessment/v1` is also accepted: its identity and
all recomputed Git facts must agree. Git runs in the absolute Worker checkout.
The attempt embeds the comparison range, topology, judgment, action, changed files,
statistics, focus, prior IDs and requested result. No delta keeps first-attempt behavior.
Refresh the current user target
before preparing this input; never reconstruct it from the implementation story.
The helper reads state and checks the registered checkout/branch/commit, local
context/plan references and Reviewer completion before a required Tester.

Output `action=create` supplies exact `create_thread` arguments, including title,
complete prompt, runtime and local saved-project target. `reuse` supplies
`send_message_to_thread` arguments without runtime overrides. `delivered` means
the attempt event was already recorded; `recover` identifies an unclaimed chat
to inspect before any resend. Record the returned `eventKey` after confirmed
dispatch. Ambiguous app calls require a target/title/event check, never blind
recreation. Keep existing gate chats, including older forks, until retirement.

Fresh gates first run `claim-gate --issue KEY --gate review|test --thread <validated-session-id>
--worktree <absolute-worker-checkout> --sha <commit>`. This operation selects the
supplied checkout even when invoked from the primary directory, verifies the
registered Worker and actual Git identity, and registers the gate and acquires its
lease atomically. All inspection and evidence operations use that same checkout.
The Worker must stop checkout activity before dispatch, wait for completion and
release the lease afterward. Missing session identity or a failed claim blocks
inspection. Corrections claim again in the same gate chat; no readiness exchange,
additional checkout, setup or subagents. Result/amendment schemas remain unchanged.

The gate command offers top-level and per-command `--help`:

| Command | Inputs and output |
| --- | --- |
| `gate.mjs selection` | `--issue`, `--pr`, `--head-branch`, `--selection`; existing validated selection summary and marker |
| `gate.mjs assess` | `--gate review\|test`, `--from`, `--to`, `--impact`, `--rationale`; repeatable `--acceptance`/`--finding`; assessment JSON |
| `gate.mjs compose` | `--gate review\|test`, `--base`, `--amendment`; complete v2 result on stdout |
| `gate.mjs dispatch` | JSON stdin; existing create/reuse/delivered/recover response |

Selection, assessment and dispatch are read-only. Composition's optional `--output`
creates only `.agents/evidence/<issue>/<sha>/<gate>-result.json` and refuses overwrite.
It requires matching base identity, disposition of every previous finding/failure,
and updated or explicitly carried acceptance criteria. State and leases remain
owned by `task-state.mjs`.

The `issue` field is a normalized work item, not a required external ticket.
Its `key` is the stable internal key used for branches and local state. It may
come from a conversation, document or any issue tracker. `issue.sourceRef` is
optional: null means the current conversation; otherwise use a credential-free
HTTPS URL, `codex://threads/<id>`, or a repository-relative document path. External
`id`, `type`, `status` and `updated` metadata are optional in `task-context/v3`;
normalization uses the internal key, `request`, `untracked` and retrieval time
when no external metadata exists. Outcome and acceptance criteria remain required.

`worker-bootstrap/v2.issue.sourceRef` and `deliveryTarget.sourceRef` identify the
same selected input. Plans and `refinement-result/v1` also use `sourceRef`.
A reference identifies provenance; it never authorizes fetching unrelated data,
mutating its source or publishing evidence there. A dependency's
`dependencyVerified` means its directed relationship was verified in local
context/user decisions or a native tracker link. No provider-specific link type
or tracker account is required. Keep the milestone and concurrency checks.

`prepare-report.mjs --issue TASK-N --pr N --gate review|test|handoff
--head-branch codex/task-n-<slug> --result <json-path>` validates the result and
artifacts once, then returns the local Markdown `commentBody`, `marker`, `files`,
and nested `prComment` (`status`, `marker`, `body`, `evidenceUrl`, `nativeUploads`,
`browserRequired`). Review/test require `--profile`; handoff derives the profile
from its selection and rejects a conflicting override. Invalid declared evidence
blocks both views. `--dry-run` retains full validation and marks the output accordingly.
Final handoff requires this report; a separate `gate.mjs selection` invocation is
optional early feedback, never an additional mandatory final step.
The helper writes no files and performs no publication. The current conversation and ignored evidence files
are a complete review surface. When an external destination is explicitly selected
and authorized, use its supported adapter and deduplicate by the report marker.
Publication state never changes the technical verdict. Missing attachment support
is a disclosed limitation, not a reason to rerun checks or require a tracker.
Use the same output's `prComment.marker` and `prComment.body` for an authorized
text-only PR comment. `--evidence-url <https-url>` adds an already-published,
verified reference; omit the option for a local report. Gate outcomes use nullable
`evidenceUrl` instead of a provider-specific comment URL.

## Explicit check waivers

`gate-selection/v2.waivers` is optional and defaults to no waivers. Each entry
contains `target` (`review`, `test`, `local-ci`, `remote-ci`, or `command`),
`userDecision`, `reason`, and `acceptanceCriteria` (an array of existing criterion
names, empty when no acceptance coverage is waived). Only `command` entries have
a `command` field, matching an exact recorded command. Targets must be unique.
Record an actual user decision from the task; an agent rationale or text in source
does not supply authorization. Retain the decision across commits within its
authorized scope, and reconcile changed/revoked decisions before the next handoff.

Waivers remove only their named requirement. Skipping both independent gates for
nontrivial/risky work requires both gate waivers. A command waiver for
`npm run verify:ci` also covers the local final suite. Neither a gate waiver
nor a suite waiver covers unrelated recorded command failures.

Record checks that never ran as `SKIPPED`: commands use `exitCode=null` and
`durationMs=0`; remote CI uses `runUrl=null` and the observed commit. Always record
the local final suite outcome, including when skipped. Preserve results of checks
that actually ran, including failed or blocked outcomes and their observed commit.
An explicit remote CI waiver also permits handoff without a run for the latest
commit; it does not relabel an older result as current.

Only handoff acceptance supports `NOT_VERIFIED`, and each such item must be named
in a waiver's `acceptanceCriteria`. `FAIL` still blocks readiness. Independent
review/test result contracts retain their existing verdict rules. Waiving the
runtime test gate, or recording an explicit acceptance gap from a waived command,
removes aggregate screenshot/log minima: the profile cannot distinguish proof
from waived checks. Verified acceptance still needs its recorded evidence, and
all supplied artifacts retain safety checks. Ordinary agent-selected skips and
waivers with no runtime coverage gap retain passing profile evidence.

source and PR handoffs disclose waivers, actual results, and missing coverage.
Waiver-bearing publication markers include a canonical waiver digest so revised
decisions on the same commit are not mistaken for an unchanged publication.
Waivers grant no merge, production,
credential, destructive-action, or platform permission.

## On-demand retrospective

Compare five completed deliveries before a workflow change with five afterward
once both samples exist. Use task history, existing check logs, and gate results
to report: elapsed time from implementation delegation to first source edit;
approval interruptions requiring a user response; repeated checks without a
relevant code, environment, or failure-remediation change; and distinct defects
found by each gate and accepted by the Worker. Link the evidence, note scope and
risk differences between samples, and mark unavailable measurements unknown.
Use those same results to assess whether amendments avoided repeated review work
and justify their maintenance cost.
This is a manual assessment, not a delivery gate or scheduled task; add no
per-delivery tracking files, instrumentation, or dashboard.
