import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fixture, git, write } from "./helpers.mjs";
import { resolveRuntime, validateRuntimeSettings } from "../.agents/skills/corch-development-workflow/scripts/lib/runtime-policy.mjs";

test("runtime defaults and partial overrides retain the selected model and effort", () => {
  const workerRoute = { model: "historic-model", reasoningEffort: "high" };
  assert.deepEqual(resolveRuntime({}, "planner"), { model: "gpt-6-astra", reasoningEffort: "xhigh" });
  assert.deepEqual(resolveRuntime({}, "worker", { classification: "routine" }), { model: "gpt-6-luna", reasoningEffort: "xhigh" });
  assert.deepEqual(resolveRuntime({}, "worker", { classification: "complex" }), { model: "gpt-6-luna", reasoningEffort: "max" });
  assert.deepEqual(resolveRuntime({}, "worker", { classification: "high-risk" }), { model: "gpt-6.1-sol", reasoningEffort: "high" });
  assert.deepEqual(resolveRuntime({}, "worker", { classification: "exceptional" }), { model: "gpt-6.1-sol", reasoningEffort: "xhigh" });
  assert.deepEqual(resolveRuntime({}, "reviewer", { workerRoute }), workerRoute);
  assert.deepEqual(resolveRuntime({ runtimes: { tester: workerRoute } }, "tester"), workerRoute);
  for (const runtimes of [{ worker: { unknown: workerRoute } }, { reviewer: "other" }, { planner: { model: "partial" } }, { tester: { ...workerRoute, reasoningEffort: "invalid" } }]) assert.throws(() => validateRuntimeSettings(runtimes));
});

test("persistent project chat runtimes resolve without a delivery family and remain independent", () => {
  const defaults = {
    delegator: { model: "gpt-6-luna", reasoningEffort: "xhigh" },
    coordinator: { model: "gpt-6.1-sol", reasoningEffort: "high" },
    refinement: { model: "gpt-6-astra", reasoningEffort: "xhigh" },
    workflow: { model: "gpt-6.1-sol", reasoningEffort: "xhigh" },
  };
  for (const [role, expected] of Object.entries(defaults)) {
    assert.deepEqual(resolveRuntime({}, role), expected);
    const override = { model: "project-model", reasoningEffort: "medium" };
    const config = { runtimes: { [role]: override } };
    assert.deepEqual(resolveRuntime(config, role), override);
    for (const other of Object.keys(defaults).filter((entry) => entry !== role)) {
      assert.deepEqual(resolveRuntime(config, other), defaults[other]);
    }
    assert.deepEqual(resolveRuntime(config, "planner"), resolveRuntime({}, "planner"));
    assert.deepEqual(resolveRuntime(config, "tester"), resolveRuntime({}, "tester"));
    for (const invalid of ["worker", { model: "partial" }, { ...override, reasoningEffort: "invalid" }]) {
      assert.throws(() => validateRuntimeSettings({ [role]: invalid }));
    }
  }
  assert.throws(() => validateRuntimeSettings({ orchestrator: defaults.coordinator }));
});

test("saved runtime snapshots survive configuration changes and explicit escalation is idempotent", () => fixture(({ root, configPath, state, invoke }) => {
  const args = ["--classification", "bounded", "--rationale", "Initial small change"];
  state("record-route", args);
  const initial = state("show").executionRoute;
  const config = JSON.parse(readFileSync(configPath));
  config.runtimes = { worker: { bounded: { model: "new-default", reasoningEffort: "low" } }, tester: { model: "test-model", reasoningEffort: "high" } };
  write(configPath, config);
  assert.equal(state("record-route", args).status, "already-recorded");
  assert.deepEqual(state("runtime", ["--role", "worker"]), { model: initial.model, thinking: initial.reasoningEffort });
  assert.deepEqual(state("runtime", ["--role", "reviewer"]), { model: initial.model, thinking: initial.reasoningEffort });
  assert.deepEqual(state("runtime", ["--role", "tester"]), { model: "test-model", thinking: "high" });
  state("register-task", ["--role", "worker", "--thread", "worker", "--worktree", root, "--branch", "main"]);
  const escalation = ["--expected-revision", "1", "--classification", "complex", "--signal", "heavyValidation", "--rationale", "Observed cross-module failures"];
  state("escalate-route", escalation);
  assert.equal(state("escalate-route", escalation).status, "already-recorded");
  assert.deepEqual(state("show").executionRouteHistory, [{ revision: 1, route: initial }]);
  const stale = invoke(["escalate-route", "--issue", "TASK-42", ...escalation.slice(0, 3), "high-risk", ...escalation.slice(4)]);
  assert.equal(stale.status, 1); assert.match(stale.stderr, /stale execution route/);
  const sha = git(root, "rev-parse", "HEAD");
  state("claim-gate", ["--gate", "review", "--thread", "reviewer", "--worktree", root, "--sha", sha]);
  const blocked = invoke(["escalate-route", "--issue", "TASK-42", "--expected-revision", "2", "--classification", "high-risk", "--signal", "heavyValidation", "--rationale", "New evidence"]);
  assert.equal(blocked.status, 1); assert.match(blocked.stderr, /active checkout gate/);
  state("end-gate", ["--gate", "review", "--thread", "reviewer"]);
}));

test("review at A and testing a Worker correction at B need no PR or fresh review verdict", () => fixture(({ root, state, invoke }) => {
  state("register-task", ["--role", "worker", "--thread", "worker", "--worktree", root, "--branch", "main"]);
  const a = git(root, "rev-parse", "HEAD");
  const review = `.agents/evidence/TASK-42/${a}/reviewer-1.md`;
  state("claim-gate", ["--gate", "review", "--thread", "reviewer", "--worktree", root, "--sha", a]);
  write(path.join(root, review), `# Review\nObserved: ${a}\nCHANGES_REQUESTED\nREV-1: repair the behavior.\n`);
  state("record-gate", ["--gate", "review", "--sha", a, "--result", review]);
  const conflict = invoke(["claim-gate", "--issue", "TASK-42", "--gate", "test", "--thread", "tester", "--worktree", root, "--sha", a]);
  assert.equal(conflict.status, 1); assert.match(conflict.stderr, /another checkout gate/);
  assert.equal(state("show").tasks.tester, undefined);
  assert.equal(invoke(["end-gate", "--issue", "TASK-42", "--gate", "review", "--thread", "other"]).status, 1);
  state("end-gate", ["--gate", "review", "--thread", "reviewer"]);
  write(path.join(root, "change.txt"), "Worker correction");
  git(root, "add", "change.txt"); git(root, "commit", "--quiet", "-m", "fix");
  const b = git(root, "rev-parse", "HEAD");
  const wrongCommit = invoke(["claim-gate", "--issue", "TASK-42", "--gate", "test", "--thread", "tester", "--worktree", root, "--sha", a]);
  assert.equal(wrongCommit.status, 1); assert.match(wrongCommit.stderr, /commit does not match/);
  state("claim-gate", ["--gate", "test", "--thread", "tester", "--worktree", root, "--sha", b]);
  state("end-gate", ["--gate", "test", "--thread", "tester"]);
  assert.deepEqual(state("show").gates.review, { observedSha: a, resultPath: review });
  assert.equal(state("show").delivery, undefined);
  assert.match(readFileSync(path.join(root, review), "utf8"), /CHANGES_REQUESTED/);
}));
