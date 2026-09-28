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
- `execution-route/v2`: runtime for implementation after Astra planning. Bounded/
  routine uses Luna/xhigh; standard and decision-complete complex work use
  Luna/max; remaining high-risk/exceptional reasoning uses GPT-5.6 Sol/high or xhigh.
  Luna routes use `gpt-6-luna`. Reviewer matches its Worker; Tester dispatch uses
  GPT-6 Luna/xhigh.
- `worker-bootstrap/v2`: work-item key/title/source reference, reserved branch, exact delivery
  target, execution route, and local context path.
  Stage as `.agents/task-state/TASK-N-bootstrap-input.json` in the primary checkout.
  New Planner prompts carry `Corch bootstrap: TASK-N`; the synchronous hook
  validates it against staged state/input, safely attaches the reserved branch,
  hydrates context and registers the hook session ID before dependency verification.
  SessionStart is read-only; unmarked prompts do not trigger preparation.
  New dispatch uses `prepare-worker-bootstrap.mjs --role planner --coordinator ID`
  first (`gpt-6-astra`/`xhigh`), then `--role worker --plan-revision N` only after the user
  approves the saved plan. The latter emits the implementation runtime and reads
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
- `gate-delta-assessment/v1`: local ancestry, changed paths/statistics, impact,
  action, acceptance focus, prior finding IDs, and requested result. The Worker
  combines it with issue/PR/validation identity to create `gate-attempt/v1`.
- `gate-attempt/v1`: role, PR/current/comparison commits, topology/action,
  changed paths/statistics, acceptance focus, prior finding IDs, validation, and
  requested result. It contains no full source packet, plan, role contract, or diff.
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

`prepare-evidence.mjs` validates artifacts and returns a local Markdown report;
it performs no publication. The current conversation and ignored evidence files
are a complete review surface. When an external destination is explicitly selected
and authorized, use its supported adapter and deduplicate by the report marker.
Publication state never changes the technical verdict. Missing attachment support
is a disclosed limitation, not a reason to rerun checks or require a tracker.
`prepare-pr-comment.mjs --evidence-url <https-url>` adds an already-published
reference; omit the option for a local report. Gate outcomes use nullable
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
This is a manual assessment, not a delivery gate or scheduled task; add no
per-delivery tracking files, instrumentation, or dashboard.
