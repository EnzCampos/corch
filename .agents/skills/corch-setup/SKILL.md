---
name: corch-setup
description: Install, configure or repair Corch in an existing repository, establish recommended role models and reasoning efforts, and check delivery readiness while preserving customizations. Use for Corch setup, not product implementation or version upgrades.
---

# Corch Setup

Set up Corch in the requested repository and report what is actually ready.
Work in the current chat without creating a delivery family. Read the
[configuration and setup contract](../corch-development-workflow/references/contracts.md#project-configuration-and-setup)
for configuration mechanics and the portable command execution guidance there
before running setup or checks. Do not add an installer, alternate schema or
setup cache.

## Establish the source and target

Use the distribution containing this skill as the source. Locate its repository
root from the skill path, independently of the command's working directory.
The target is the repository the user selected, or the current repository when
unambiguous. Resolve both absolute paths before copying. When invoked from a
Corch checkout to adopt elsewhere, require an identified target; do not configure
the distribution itself by accident. A target need not already contain Corch.

Inspect the target's applicable instructions, Git status, remotes and default
branch, CI, package manifests/lockfiles, existing Corch files and Codex environment
configuration. Inspect local delivery records in the primary and relevant linked
checkouts, including registered ownership and leases. Use available live task
status when needed; an old record alone does not establish that work has ended.
Defer edits to shared skills, helpers or configuration while an active delivery
depends on them. Keep inspection useful and report what must wait; do not retire
tasks, clear leases or stop another task's processes to enable setup.

Derive values from project evidence and preserve existing project decisions.
Ask only about unresolved choices, such as multiple delivery remotes, the scrum
project, an internal issue prefix or conflicting instructions. Do not infer the
internal prefix must equal the provider's key. Report unsupported repository
destinations rather than rewriting remotes or inventing support.

## Install or repair

Inventory the source's distributed `corch-*` skill folders and their supporting
files; use tracked files to distinguish distribution content from local artifacts.
Copy those files into the target's `.agents/skills/`. Preserve other skills. Never
copy source operational state, logs, evidence, credentials or project-specific
configuration values. If source and target are identical, inspect and repair in
place instead of copying files onto themselves.

For existing files, compare before editing. Leave identical files alone; restore
missing files only when compatible with the installed helpers/contracts. Preserve
intentional local changes and resolve meaningful conflicts with the user. Do not
equate every difference with corruption. This skill does not migrate versions:
if repair requires upgrading a coherent set of helpers or converting state,
report the required upgrade and leave those files intact.

Merge only Corch's workflow guidance from the source `AGENTS.md` with the target's
instructions. Do not transplant the source project's architecture, toolkit test
commands or product rules. Keep existing guidance and avoid duplicate sections
on repeat runs. Add missing ignores for `.agents/task-state/` and
`.agents/evidence/`; retain `.agents/task-context/` exclusions for historical
material. Do not alter tracked operational files silently if ignore rules expose
an existing tracking problem.

Create or complete `.agents/workflow.json` using the shared contract, not a blind
copy of the source project's settings. Preserve valid target values and runtime
overrides. Establish model/effort choices as described below. Use no dependency
setup steps unless the target needs them. Infer preparation commands
from the target's package manager and documented workflow; Corch's package.json
and development dependencies do not belong in the target.

For Codex desktop, integrate the existing environment setup with the Corch helper
without discarding commands, platform settings or unrelated configuration. Avoid
adding the same invocation twice. Inspect generated-file ownership: use the
owning editor/generator for files marked generated, rather than manually editing
them. If that facility is unavailable, report the pending integration and the
required helper invocation. Do not claim environment integration is complete.

## Establish role models and reasoning efforts

Read the installed `lib/runtime-policy.mjs` and the target's `runtimes` settings.
Use the policy defaults as Corch's recommended baseline; do not keep another list
of model names in this skill. Resolve both baseline and effective choices with
`resolveRuntime`, without recording a task or creating chats to discover them.

Present a compact table covering Planner, every Worker classification, Reviewer
and Tester. Show the recommended model and reasoning effort, the effective
project choice, whether it is inherited or overridden, and availability on the
delivery host. Explain the role/workload rationale: planning, implementation
complexity/risk, review following the actual Worker, and acceptance testing.
Group classifications only when both recommendation and effective choice match.
For Reviewer set to `worker`, show that relationship and explain that its pair
comes from the saved Worker route, not a newly resolved default. Resolve Tester
separately; a Worker override does not automatically change Tester.

Also account for Refinement, Coordinator, setup and direct delivery: these use
their current chat's model/effort and have no separate runtime fields. Recommend
retaining the user's chat selection by default, identify it when observable,
and mark it unknown otherwise. Adapters share the invoking role's runtime.
Do not invent configuration keys or claim setup changes these chat settings.

Check model/effort pairs against availability exposed by the destination's Codex
tools or runtime information. Schema validation alone does not establish model
availability. If availability cannot be inspected, report it as unverified; if a
pair is unsupported, explain the mismatch and resolve a supported replacement
with the user before claiming runtime readiness. Never silently substitute.

Use the existing defaults when no project preference changes them; do not require
another approval just to retain them. Preserve explicit overrides. When the user
chooses a different model/effort or states a cost, latency or capability preference,
recommend supported adjustments and save the resulting choices in the existing
`runtimes` fields. Store only overrides, with complete model/reasoningEffort pairs,
or `reviewer: "worker"` for inheritance. Validate and resolve the saved settings
again. Keep unchanged defaults implicit rather than pinning copied policy values.
These choices affect future selections; preserve active chats and saved routes.

## Verify and hand off

Check Node.js 22+, Git and the target's required tools, including Git Bash for
Windows package-manager execution. Validate the target configuration with the
existing `readConfig` validator using its explicit absolute path. Account for
`CORCH_CONFIG` when invoking helpers so a source or shell override cannot validate
the wrong project. Check distributed references and verify operational paths are
ignored with Git, without creating task records to test them.

Use available repository/provider tools for read-only checks of the selected
repository, base branch and scrum project. Read access does not prove write
permissions. Missing access or unresolved provider selection does not prevent
local installation, but remains a concrete coordinated-delivery readiness gap.
Keep credentials in runtime configuration and out of files, commands and reports.

Run applicable local preparation and the project's validation command by default.
In an existing linked checkout without conflicting ownership, run
`node .agents/skills/corch-development-workflow/scripts/prepare-worker-worktree.mjs`
without issue/thread arguments, using that checkout as the working directory.
This reuses the setup lock/cache. In a primary checkout the helper returns
`skipped-primary-checkout`: use the project's documented dependency preparation
when necessary and report worktree setup as unverified. Do not bypass the helper's
lock/cache in a linked checkout or manufacture a worktree, issue or thread merely
to obtain a passing setup result.

Use bounded command execution and the existing portable process adapter where
appropriate; the task-keyed check CLI is not a reason to create a family. Review
project commands before running them and respect their actual external effects
and existing authorization. Stop every process started for this setup when done,
preserving processes owned by the user or another task.

Review the resulting diff for unrelated changes and duplicate guidance or setup
commands. Report changed files, the effective role model/effort matrix and saved
overrides, local checks and actual outcomes, access checks, unexecuted steps and
blockers separately. A skipped check is not a pass. End with
`$corch-development-workflow` as the next entry point, or the already assigned
role for existing work; do not restart approved delivery. Setup alone authorizes
no backlog mutations, commits, pushes, publication or external messages.
