---
name: corch-refinement
description: Refine a request from a conversation, document, or issue tracker into a bounded work item with acceptance criteria and dependencies. Use only for the Refinement role, never for implementation or Worker orchestration.
---

# Corch Refinement

Accept the user-selected input: a conversation request, local document, GitHub
issue, Linear item, Jira issue, or another available source. Do not require a
tracker account or create an external ticket to make a request eligible.

Inspect only the selected input and relevant repository contracts. Normalize one
independently deliverable outcome, scope, acceptance criteria, real constraints,
user decisions and directed dependencies into `task-context/v3`. Assign a stable
internal `TASK-N` key after checking local task state for collisions; use the
configured prefix. Preserve an existing key and map its external reference via
`issue.sourceRef`. A conversation without a link uses null. No invented URL,
external ID, type or status is required.

The persistent local Refinement task never implements, creates branches,
worktrees/Workers/subagents, opens PRs or accesses production. It may stage
ignored planning/event state. Mutate an external source only when the user has
authorized that specific destination and operation. Native issue types and
statuses are provider details, not core workflow requirements.

Preserve direct user decisions when they contradict source text, specs or prior
plans. Note consequences if useful; never dilute scope. The Worker need not wait
for source synchronization to implement an already-authorized change.

Search boundedly for duplicates where a source exists. Write the minimum
complete work item: one outcome, smallest scope, observable acceptance, real
exclusions/blockers, and proportional tests. Usually three to seven criteria are
enough. Do not turn intake into an implementation blueprint, file inventory,
architecture proposal or generic checklist. Include a constraint only when it
changes the result. Prefer an existing item or smaller edit; no speculative
infrastructure, adapters, retries or future-proofing.

Split independent outcomes only when they can be delivered separately. Preserve
an explicitly requested technical mechanism as a direct user decision; otherwise
describe behavior. Link canonical contracts rather than duplicating them.

Classify consumed unfinished deliverables. Hard prerequisites require a verified
directed dependency and `requiredMilestone=merged|done`. Record the direction and
its evidence in local task context, or use a verified native tracker link when
available. Set `dependencyVerified` from that evidence, never from a guess.
Missing verification blocks readiness; missing tracker support does not.
Coordination-only dependencies need a concrete non-overlapping ownership boundary.

Return one `refinement-result/v1`: event key/revision, internal key, optional
`sourceRef`, compact change summary, readiness, blockers and dependency evidence.
Send exactly one deduplicated result to the source coordinator only when that
coordination is authorized; otherwise return it to the user. No progress pings.

Read `../corch-development-workflow/references/contracts.md` when constructing
or validating packets. Execute helpers under `../corch-development-workflow/scripts/`;
do not duplicate their logic or load implementation/gate skills.
