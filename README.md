# Corch

Corch is a reusable AI development workflow for Codex. Install its skills and
helpers in a repository to give Codex a consistent way to scope requests, plan
changes, implement them, review them, and verify the result.

Small, eligible changes stay in the current chat and checkout. Work that needs
coordination uses an external backlog, a prepared Git worktree, and dedicated
delivery roles. You define the desired outcome and authorize the relevant
operations; Corch preserves those decisions throughout delivery.

[Leia em português](README.PT.MD).

## How it works

Corch has three layers:

- **Skills** describe each role's responsibilities and how it makes decisions.
- **Helpers** prepare checkouts, maintain execution state, and run bounded
  commands. They enforce mechanical rules such as identity and checkout ownership.
- **Project configuration** selects the repository, backlog provider, validation
  command, dependency preparation, and role runtimes.

The adopting project's specifications and source define product behavior. The
external scrum provider owns backlog items, priority, acceptance, dependencies,
and lifecycle. Ignored local records hold the agreed context and execution state.
Direct user decisions take precedence over earlier recorded context.

### Direct delivery

Use `$corch-development-workflow` for a new implementation request without an
assigned role. The router keeps work local when the result is concrete, localized,
and verifiable using established patterns, with a small blast radius and no
active delivery family or coordination requirement. Changes that materially
affect security, privacy, billing, production data, public contracts,
infrastructure, deployment, or dependencies do not qualify automatically.

Eligible direct work needs no backlog item, task record, separate role chat,
worktree, or plan approval. Codex makes the change, runs focused checks, and reports
the result in the current chat. Explicit project and user requirements still apply.

### Coordinated delivery

A **delivery family** is the set of chats and local records responsible for one
work item. Its normal flow is:

| Role | What it does |
| --- | --- |
| Refinement | Checks the external backlog for duplicates and creates or updates a bounded item with acceptance criteria and dependencies. |
| Project Orchestrator | Verifies readiness and ownership, records delivery context, and prepares the branch, worktree, and dependencies before starting the Planner. |
| Planner | Resolves the design with you and saves a Markdown implementation plan for approval. |
| Worker | Continues from the approved Planner in the same checkout, implements the change, validates it, and owns delivery. |
| Reviewer | Independently checks the candidate for correctness, simplicity, and relevant risks. |
| Tester | Independently verifies acceptance and chooses, inspects, sanitizes, and publishes appropriate evidence within authorization. |

The Worker manages Reviewer and Tester directly. Their initial passes run in that
order, in separate registered chats, with only one using the mutable checkout at
a time. Both are required unless you explicitly waive a role. After corrections,
the Worker chooses repeat passes according to the changed behavior and remaining
uncertainty; a new commit alone does not require repeating every check.

Review and testing support committed and uncommitted changes. For uncommitted
work, the roles identify both the actual content and the checkout's HEAD anchor.
Plan approval and existing authorizations survive continuation and recovery.

## Set up Corch in your project

### Requirements

- Codex with access to the target repository. Coordinated delivery also needs
  tools for project chats and managed Git worktrees.
- Node.js 22 or newer and Git for the helpers.
- The target project's own build, package-manager, and validation tools.
- Access to the chosen external scrum provider for normal coordinated delivery.
  Jira has an included adapter; other providers require suitable connected tools.

The helpers have no runtime npm dependencies. Adopting Corch does not require
copying this toolkit's `package.json` or installing its test dependencies.
On Windows, the command adapter runs npm, pnpm, and Corepack through their Bash
launchers on PATH using Git Bash. Set `CORCH_BASH` to an absolute Git Bash
executable path if automatic discovery does not fit your installation.

### Installation

Open a Codex chat in the Corch checkout and give it the source skill and target
repository. Replace these paths with your own:

> Use the skill at `/path/to/corch/.agents/skills/corch-setup/SKILL.md` to install
> and configure Corch in `/path/to/my-project`.

Setup inspects the target's instructions, Git state, CI, existing installation,
and active delivery ownership. It copies the distributed `corch-*` skills,
merges workflow guidance into `AGENTS.md`, adds operational directory ignores,
and establishes `.agents/workflow.json`. It preserves unrelated skills and
intentional customizations. Shared components used by active delivery must wait.

Setup presents recommended and effective model/reasoning-effort choices and checks
availability where possible. For Codex desktop it integrates dependency preparation
with the existing local environment, respecting generated-file ownership. It runs
applicable preparation and project validation and reports what passed, what was
skipped, and what remains unresolved.

Local installation can finish before provider access is ready. That does not
establish coordinated-delivery readiness. The distributed `example/project`,
`TASK`, `main`, and CI command are placeholders to replace with project settings.
In an existing installation, invoke `$corch-setup` to configure or repair it.
Version upgrades are a separate operation, described below.

### Optional persistent project chats

Ask setup to provision persistent chats if you want dedicated entry points:

> Use $corch-setup to configure this project and create the four persistent
> project chats. Present the runtime choices so I can select them.

| Chat | Purpose | Runtime key |
| --- | --- | --- |
| Work Delegator | Intake and routing through the development workflow. | `delegator` |
| Project Orchestrator | Ownership, readiness, and Planner/Worker coordination. | `orchestrator` |
| Refinement | Backlog scope, acceptance, and dependencies. | `refinement` |
| Workflow Changer | Maintenance of Corch skills and configuration. | `workflow` |

Setup verifies and reuses existing chats, creating only missing ones. Their IDs
live in the primary checkout's ignored `.agents/task-state/project-chats.json`.
Provisioning does not create an issue family or authorize messages between chats.

Routing applies in every project chat. When a discussion becomes a backlog request
such as “make that into a task,” Corch uses the registered Refinement destination;
selected coordinated delivery goes to the Orchestrator. Explicit role assignments,
local-work instructions, existing families, and messaging authorization are preserved.

## Use it day to day

Describe the outcome, constraints, and evidence you expect. Useful requests include:

> Use $corch-development-workflow to correct this command's help text and check
> that the documented options match the implementation. Keep delivery local.

> Turn this idea into a backlog item with observable acceptance criteria. You may
> send this request and the agreed context to the registered Refinement chat.

> Use $corch-project-orchestrator to coordinate delivery of this refined item.
> Keep commits, pushes, and PR publication pending until I authorize them.

The named role skill applies when that role is assigned. An approved family
continues from its existing role rather than restarting intake or planning.

Expect a scoped result with actual validation outcomes, evidence, unresolved
findings, and coverage gaps. Coordinated delivery also produces a plan, independent
role results or explicit waivers, and a readable Worker handoff. A skipped check
is not a pass, and passing local CI does not replace required independent roles.

Local edits do not automatically authorize commits, pushes, PRs, external messages,
merge, or production actions. Required operations need destination-specific
authorization, which Corch reuses once given. Local-only delivery is a valid target.

PR creation normally happens at local readiness. An earlier draft can unlock
required PR-only CI, a preview, or an integration environment within existing
authorization. If a branch push supplies the same validation, use that instead.
A draft does not mean readiness: required checks must cover the current candidate,
and failures need a demonstrated fix or a revised user target. Missing required
checks or delivery operations leave delivery incomplete with a concrete blocker
and next action. Opening a PR does not by itself mark a backlog item Done.

## Customize Corch to fit your preferences

Put each decision in the file that owns it:

| What you want to change | Where to change it |
| --- | --- |
| Product behavior and acceptance | Project specifications and the external backlog item. |
| Architecture, coding conventions, validation requirements, and authorization guidance | The adopting project's `AGENTS.md` and canonical documentation. |
| Repository, base branch, internal issue prefix, provider, CI, and preparation | `.agents/workflow.json`. |
| Models and reasoning effort for future role selections | `.agents/workflow.json.runtimes`. |
| Role responsibilities or delivery procedure | The relevant `.agents/skills/corch-*/SKILL.md`, keeping shared contracts consistent. |
| State, execution, or preparation mechanics | The router's `scripts/` and `references/contracts.md`, with appropriate tests. |

For example:

> Update Corch for this project's conventions. Use our existing CI command,
> preserve plan approval, and recommend runtime overrides that favor lower cost
> for routine implementation. Verify support before saving choices.

### Project settings

This illustrative configuration describes an npm project using Jira. Replace
its repository, URL, branch, prefix, commands, and paths with your actual values:

```json
{
  "repository": "your-org/your-project",
  "baseBranch": "main",
  "issuePrefix": "TASK",
  "scrum": {
    "provider": "jira",
    "projectUrl": "https://your-site.atlassian.net/projects/PROJ"
  },
  "localCiCommand": "npm run verify:ci",
  "runtimes": {},
  "setup": {
    "steps": [
      {
        "name": "install",
        "command": "npm",
        "args": ["ci"],
        "inputs": ["package.json", "package-lock.json"],
        "outputs": ["node_modules"]
      }
    ]
  }
}
```

The repository field currently supports GitHub `owner/repo`; other Git hosts need
a compatibility change. The internal prefix may differ from the provider's key.
Provider settings select a destination; credentials stay in runtime configuration.
Missing provider settings do not select a local backlog mode.

Preparation steps run in order and use an executable plus separate literal
arguments. Inputs and outputs are repository-relative paths with forward slashes;
choose lifecycle-script policy according to your project. An empty step list is
valid. The setup cache accounts for commands, inputs, outputs, and upstream steps.

`CORCH_CONFIG` selects an alternate configuration. By default helpers locate
configuration beside their installation, independently of the shell's working
directory. See the [configuration contract](.agents/skills/corch-development-workflow/references/contracts.md#project-configuration-and-setup)
for validation and environment integration.

### Runtime preferences

Keep defaults implicit and save only overrides. Planner, Tester, and the four
persistent chat roles accept complete `model`/`reasoningEffort` pairs. Worker
overrides are keyed by `bounded`, `routine`, `standard`, `complex`, `high-risk`,
or `exceptional`. Reviewer accepts a pair or `"worker"`, its default, which follows
the saved Worker runtime. Tester resolves separately from Worker overrides.

Defaults are owned by [runtime-policy.mjs](.agents/skills/corch-development-workflow/scripts/lib/runtime-policy.mjs).
Use `$corch-setup` to inspect recommendations, verify host support, and save
preferences. Configuration edits affect future selections; they do not change
existing chats or a Worker's saved runtime snapshot. Unsupported pairs require
explicit correction rather than silent substitution.

### Workflow changes

Make targeted edits to the owning skill or helper, preserve explicit user
decisions and active ownership, and update the shared contract when its interface
changes. Keep operational records, transcripts, credentials, and evidence out of
public documentation. If you want a required initial role omitted for a delivery,
state the waiver explicitly so its coverage gap is recorded.

## Files and local records

| Path | Responsibility |
| --- | --- |
| `AGENTS.md` | Project instructions and delivery routing. |
| `.agents/skills/corch-*` | Setup, delivery roles, and Jira adapter. |
| `.agents/workflow.json` | Project configuration. |
| `.agents/skills/corch-development-workflow/references/contracts.md` | Shared state, command, and result contracts. |
| `.agents/skills/corch-development-workflow/scripts/prepare-worker-worktree.mjs` | Verified checkout and dependency preparation. |
| `.agents/skills/corch-development-workflow/scripts/task-state.mjs` | Atomic state, identities, references, checkout leases, and event deduplication. |
| `.agents/skills/corch-development-workflow/scripts/run-bounded-check.mjs` | Bounded, sanitized command logs and cleanup on interruption. |
| `.codex/environments/environment.toml` | Codex local environment preparation. |
| `tests/` | Toolkit tests, separate from helper runtime requirements. |

Coordinated work uses ignored `.agents/task-state/TASK-N.json` records, with the
external item in `workItem.scrum` and original input in `sourceRef`. Plans and
handoffs use `TASK-N-plan.md` and `TASK-N-handoff.md`; role results and artifacts
live under `.agents/evidence/`. `TASK-N` represents the configured internal key.
New coordinated branches use `corch/<key>-<slug>`; direct delivery can use
`corch/<slug>` without creating a task key.

## Validate or develop this toolkit

In this Corch checkout, with Node.js 22+, npm, and Git:

```sh
npm ci --ignore-scripts
npm run verify:ci
```

`verify:ci` checks formatting and runs the tests. Use `npm test` for tests alone,
`npm run format` to format `.mjs` files, or `npm run format:check` to check formatting.
Tests use temporary synthetic repositories and data without Jira/GitHub credentials.
They cover concurrency, identity, recovery, runtimes, safe references, command
execution, and copied installation. Run them on the operating systems you support;
automated checks do not replace observing a real Codex delivery.

This toolkit's repository-local `.codex/hooks.json` formats JavaScript at
`SessionEnd` using installed Prettier. Review and trust it through Codex's `/hooks`
interface before use and start a new session to load it. It has a three-second
timeout; use `npm run format` if automatic formatting fails. Session end is distinct
from the end of an assistant response. Setup does not copy this hook into adopting
projects, and Corch installs no global hooks.

## Repair, upgrade, and recover

Use `$corch-setup` for installation, configuration, and compatible repairs.
Version upgrades are outside that skill's scope. Before replacing an installed
version, finish or intentionally stop active delivery; do not replace shared
skills and helpers while a family depends on them.

Update distributed skills and helpers as a coherent set, reconcile local
customizations, and follow the current contracts. Preserve project settings,
operational history, checkouts, identities, approved plans, runtime snapshots,
and delivery events. Never copy another installation's state or credentials.

When upgrading older copies, remove retired helpers (`gate.mjs`,
`prepare-report.mjs`, `prepare-worker-bootstrap.mjs`,
`materialize-task-context.mjs`, `assess-delivery-preflight.mjs`, and their obsolete
internal modules) and the former `corch-delivery-coordinator` skill. Preserve
unrelated files and hooks. Setup handles the legacy `coordinator` runtime/registry
key migration to `orchestrator`, preserving verified chat identity and settings;
do not keep both runtime keys. Existing `codex/` task branches remain readable.

Historical JSON plan/result references remain supported. For inactive families
without a lease, restore missing agreed context and delivery fields through
`record-context` and `record-delivery`, starting at revision 0 when absent. Verify
with `show` in the family's checkout and resolve the real scrum item before a
new dispatch. Keep historical files rather than converting or deleting them.

For recovery, inspect the actual chat and checkout before retrying an ambiguous
create or send operation. State writes use PID/token locks: verify the owner has
stopped writing before removing only a confirmed abandoned lock. Do not delete
the state JSON or clear a role's lease to repair a writer lock. Stop processes
started for your task when it finishes, preserving those owned by other work.

See the [shared contracts](.agents/skills/corch-development-workflow/references/contracts.md)
for command details, candidate identity, readiness, and recovery rules.
