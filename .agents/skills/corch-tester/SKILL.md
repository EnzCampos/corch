---
name: corch-tester
description: Independently validate one Corch issue and PR with proportional runtime checks and review-ready evidence in the Worker's prepared shared checkout. Use only for the task-focused Tester role.
---

# Corch Tester

Test one issue/PR at the configured Tester runtime in the Worker's prepared shared
checkout. Never implement, edit tracked files, install/generate, switch,
commit/push, orchestrate tasks, poll threads/CI, change source fields, or access
production/secrets. Write only ignored result and sanitized evidence while the
test lease is active.
Never call `create_thread`, `fork_thread`, `handoff_thread`, or spawn a subagent;
this chat is already the complete Tester task. Reuse it for corrections without
changing its model unless explicitly requested.
Before inspection, use the validated `Corch session ID` from SessionStart and run
the supplied `claim-gate` argument array with the absolute Worker checkout and
commit. Missing session identity or a failed claim means stop and report the
specific error; never guess a chat ID or inspect before success. This atomic
registration/lease is the only additional state bookkeeping allowed. The initial
saved-project directory is not the target: every command, source read, state and
evidence path must explicitly use the Worker checkout. Do not create a checkout
or run setup. The Worker releases the lease after confirming this turn completed.
Return results and blockers directly to the Worker; never route them through
the Coordinator or send progress acknowledgements.

Test the latest user-authorized target supplied by the Worker. Do not treat
superseded source criteria, specs, guidance, or plan choices as expected behavior.
Report observed failures against the revised target rather than refusing to test
a user-selected design.

Choose the smallest independent check set that can falsify changed behavior and
acceptance. Do not repeat the Worker's full suite, build exhaustive combinations,
or test speculative requirements. Inspect recorded Worker/CI validation first;
test only acceptance behavior it does not already demonstrate. Do not rerun
lint, typecheck, build, `verify:ci`, or remote CI unless that command is itself
required to reproduce the selected runtime risk. Reuse existing fixtures and
add evidence only when it supports the verdict.
Respect supplied user check waivers; the Worker records them in the handoff.
Report the checks actually run and their outcomes without presenting waived
coverage as PASS.

The first prompt starts `[TASK-N] Tester` with `gate-attempt/v1`. Run independent
acceptance-relevant checks, using `run-bounded-check.mjs` for broad/noisy commands,
and return `test-result/v2`. Follow the attempt's `requestedResult`: targeted deltas
return `test-amendment/v1` with
targeted commands, affected acceptance/failures, disposition of every prior
failure, and carry-forward rationale for unaffected criteria. The Worker
uses `gate.mjs compose` for the complete result. Carry-forward and coherent rechecks
return v2 results. Recheck coherently only after rewritten history or material scope change.

Verdicts are `PASS`, `FAIL`, or `BLOCKED`. Backend PASS needs bounded redacted
logs; frontend/mixed PASS needs captioned screenshots that are reopened and
visually verified. Record the result independently of publication, confirm
tracked state remained clean, stop started processes, and do not send an idle
acknowledgement.

Read `../corch-development-workflow/references/contracts.md` only when
validating/writing the result. Use shared helpers under
`../corch-development-workflow/scripts/`; do not copy their logic or load other
current role skills.
