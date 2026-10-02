import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { CONFIG, validateConfig } from "../.agents/skills/corch-development-workflow/scripts/lib/workflow-config.mjs";
import { fixture, scripts, write, command, git } from "./helpers.mjs";

test("configuration rejects ambiguous destinations and escaping setup paths", () => {
  for (const change of [{ repository: "owner/repo/extra" }, { issuePrefix: "task/../" }, { baseBranch: "main..other" }, { baseBranch: "-main" }, { localCiCommand: "npm test\nother" }]) {
    assert.throws(() => validateConfig({ ...CONFIG, ...change }), /Invalid Corch configuration/);
  }
  for (const entry of ["../outside", "/tmp/outside", "C:/outside", "node_modules/../../outside"]) {
    assert.throws(() => validateConfig({ ...CONFIG, setup: { steps: [{ name: "install", command: "node", args: [], inputs: [entry], outputs: [] }] } }), /repository-relative/);
  }
});

test("scrum configuration preserves provider selection, accepts unresolved legacy settings and rejects unsafe destinations", () => {
  const { scrum: ignored, ...legacy } = CONFIG;
  assert.equal(validateConfig(legacy).scrum, undefined);
  for (const scrum of [
    { provider: null, projectUrl: null },
    { provider: "jira", projectUrl: "https://tracker.example.test/projects/PROJ" },
    { provider: "linear", projectUrl: "https://linear.app/example/team/ENG" },
    { provider: "custom-provider", projectUrl: null },
  ]) assert.deepEqual(validateConfig({ ...CONFIG, scrum }).scrum, scrum);
  for (const scrum of [null, [], "jira", { provider: "bad provider" }, { provider: 42 },
    { provider: "jira", token: "not-a-config-field" },
    ...["http://tracker.example.test", "https://user:pass@tracker.example.test", "https://tracker.example.test/\nother", "file:///tmp/project", {}]
      .map((projectUrl) => ({ provider: "jira", projectUrl })),
  ]) assert.throws(() => validateConfig({ ...CONFIG, scrum }), /Invalid Corch configuration/);
});

test("project chat runtime choices round-trip through project configuration", () => {
  const runtimes = Object.fromEntries(["delegator", "coordinator", "refinement", "workflow"].map((role) =>
    [role, { model: "project-model", reasoningEffort: "high" }]));
  assert.deepEqual(validateConfig({ ...CONFIG, runtimes }).runtimes, runtimes);
  assert.throws(() => validateConfig({ ...CONFIG, runtimes: { refinement: { model: "partial" } } }), /complete model\/reasoningEffort pair/);
});

test("copied helpers run without toolkit packages using adjacent config or CORCH_CONFIG", () => fixture(({ root }) => {
  const installed = path.join(root, "installed");
  const copied = path.join(installed, ".agents/skills/corch-development-workflow/scripts");
  cpSync(scripts, copied, { recursive: true });
  const custom = { ...CONFIG, repository: "sample/toolkit", issuePrefix: "OPS2", baseBranch: "develop", localCiCommand: "make check",
    scrum: { provider: "jira", projectUrl: "https://tracker.example.test/projects/PROJ" } };
  const adjacent = path.join(installed, ".agents/workflow.json");
  write(adjacent, custom);
  const override = path.join(root, "override.json");
  write(override, { ...custom, repository: "overridden/toolkit" });
  assert.equal(existsSync(path.join(installed, "node_modules")), false);
  for (const configured of [false, true]) {
    const env = { ...process.env }; delete env.CORCH_CONFIG;
    if (configured) env.CORCH_CONFIG = override;
    const call = (name, args, input) => command(root, process.execPath, [path.join(copied, name), ...args], {
      env, input: input === undefined ? undefined : JSON.stringify(input),
    });
    for (const name of readdirSync(copied).filter((file) => file.endsWith(".mjs"))) {
      const help = call(name, ["--help"]); assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /Usage/);
    }
    const key = configured ? "OPS2-8" : "OPS2-7";
    const repository = configured ? "overridden/toolkit" : "sample/toolkit";
    const result = call("task-state.mjs", ["record-delivery", "--issue", key, "--expected-revision", "0"], {
      repository, remoteUrl: `https://github.com/${repository}.git`, baseBranch: "develop",
      headBranch: `corch/${key.toLowerCase()}-fixture`, allowedOperations: [],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(call("task-state.mjs", ["show", "--issue", "TASK-7"]).status, 1);
    const record = JSON.parse(call("task-state.mjs", ["show", "--issue", key]).stdout);
    assert.equal(record.delivery.repository, repository);
    const checked = call("run-bounded-check.mjs", ["--issue", key, "--name", "copied", "--", process.execPath, "--version"]);
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(JSON.parse(checked.stdout).status, "PASS");
  }
  // The environment helper resolves dependency steps from its target checkout.
  const target = path.join(root, "linked");
  git(root, "worktree", "add", "--quiet", "--detach", target);
  write(path.join(target, ".agents/workflow.json"), { ...CONFIG, setup: { steps: [{ name: "create", command: process.execPath,
    args: ["-e", "require('node:fs').writeFileSync('prepared.txt','ready')"], inputs: [], outputs: ["prepared.txt"] }] } });
  const setup = command(target, process.execPath, [path.join(copied, "prepare-worker-worktree.mjs")], { env: { ...process.env, CORCH_CONFIG: adjacent } });
  assert.equal(setup.status, 0, setup.stderr);
  assert.equal(readFileSync(path.join(target, "prepared.txt"), "utf8"), "ready");
}));
