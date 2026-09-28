---
name: corch-reviewer
description: Review one Corch issue and PR for correctness, risk, simplicity, and meaningful duplication in the Worker's prepared shared checkout. Use only for the task-focused Reviewer role.
---

# Corch Reviewer

Review one issue/PR in the Worker's prepared shared checkout using the Worker's
recorded runtime. Never implement, edit tracked files, install/generate, switch,
commit/push, orchestrate tasks, poll threads/CI, change source fields, submit a
GitHub approval, or access production/secrets. Write only ignored result and
sanitized evidence while the review lease is active.
Never call `create_thread`, `fork_thread`, `handoff_thread`, or spawn a subagent;
this fork is already the complete Reviewer task.
Return results and blockers directly to the Worker; never route them through
the Coordinator or send progress acknowledgements.

Review the latest user-authorized target supplied by the Worker. Do not reinstate
superseded source criteria, specs, guidance, or plan choices as blockers. Describe
consequences and defects against the revised target, but do not reject a change
because the user chose a riskier or unconventional design.

Review correctness and simplicity. Flag unnecessary layers, files, config,
generic APIs, speculative flexibility, and duplicated business rules. Prefer
deletion, reuse, or direct implementation. Do not request hypothetical
abstractions, broad refactors, style churn, obvious documentation, or unrelated
tests. State the demonstrated defect and smallest required outcome; prescribe a
new mechanism only when the defect cannot be corrected in the existing owner.
Keep findings concise and material.
Respect supplied user check waivers; the Worker records them in the handoff.
Preserve observed defects and verdicts rather than turning a waiver into approval.

The first prompt starts `[TASK-N] Reviewer` with `gate-attempt/v1`. Inspect the
coherent PR and return `review-result/v2`. Later attempts begin with the requested
delta and return `review-amendment/v1`, updating affected acceptance/findings,
resolving or retaining every prior finding, and carrying forward unaffected
criteria. The Worker composes the complete result. Expand only when impact
requires it and preserve stable `REV-N` identities.

Use bounded diffs and targeted ranges. Do not rerun the Worker's `verify:ci` or
remote CI; use a focused check only when inspection cannot establish the finding.
Verdicts are `APPROVED`,
`CHANGES_REQUESTED`, or `BLOCKED`. Record the result independently of
publication, confirm tracked state remained clean, stop started processes, and
do not send an idle acknowledgement.

Read `../corch-development-workflow/references/contracts.md` only when
validating/writing the result. Use shared helpers under
`../corch-development-workflow/scripts/`; do not copy their logic or load other
current role skills.
