import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CONFIG, validateConfig } from "../.agents/skills/corch-development-workflow/scripts/lib/workflow-config.mjs";
import { resolveRuntime, runtimeArguments } from "../.agents/skills/corch-development-workflow/scripts/lib/runtime-policy.mjs";
import { assessGateDelta, buildGateDispatch } from "../.agents/skills/corch-development-workflow/scripts/gate.mjs";
import { buildWorkerContinuation, validateRouteState } from "../.agents/skills/corch-development-workflow/scripts/lib/delivery-state.mjs";
import { createExecutionRoute, validateExecutionRoute } from "../.agents/skills/corch-development-workflow/scripts/lib/bootstrap.mjs";

const scripts = fileURLToPath(new URL("../.agents/skills/corch-development-workflow/scripts/", import.meta.url));
const issueKey = "TASK-42";
const branch = "codex/task-42-runtime";
const route = () => createExecutionRoute({ issueKey, classification: "bounded", rationale: "Bounded initial implementation." });
const pair = (model, reasoningEffort = "high") => ({ model, reasoningEffort });
const exec = (cwd, program, args, options = {}) => spawnSync(program, args, { cwd, encoding: "utf8", windowsHide: true, timeout: 15_000, ...options });
function fixture(action) {
  const root = mkdtempSync(path.join(os.tmpdir(), "corch fresh gates "));
  const git = (...args) => {
    const result = exec(root, "git", args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git("init", "--quiet", "-b", "main");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.test");
    writeFileSync(path.join(root, ".gitignore"), ".agents/task-state/\n.agents/task-context/\n.agents/evidence/\n");
    git("add", ".gitignore");
    git("commit", "--quiet", "-m", "fixture");
    const sha = git("rev-parse", "HEAD");
    const worktree = path.join(root, "worker checkout");
    git("worktree", "add", "--quiet", "-b", branch, worktree);
    const stateFile = path.join(worktree, ".agents/task-state/TASK-42.json");
    const contextFile = path.join(worktree, ".agents/task-context/TASK-42.md");
    mkdirSync(path.dirname(stateFile), { recursive: true });
    mkdirSync(path.dirname(contextFile), { recursive: true });
    writeFileSync(contextFile, "# TASK-42\nLocal user target\n");
    writeFileSync(path.join(worktree, ".agents/task-state/TASK-42-plan.md"), "# TASK-42 Implementation plan\nApproved edits\n");
    const state = {
      schemaVersion: "task-state/v2", workflowProtocol: "delivery-v3", issueKey,
      tasks: { worker: { threadId: "worker-42", worktree, branch, retired: false } },
      gates: {}, deliveredEvents: {}, executionRoute: route(),
      implementationPlan: { schemaVersion: "implementation-plan/v4", path: ".agents/task-state/TASK-42-plan.md", revision: 2 },
    };
    const save = (value = state) => writeFileSync(stateFile, JSON.stringify(value));
    const load = () => JSON.parse(readFileSync(stateFile));
    save();
    const input = {
      issueKey, gate: "review", worktree, projectId: "fixture-project", projectPath: root,
      observedSha: sha, comparedFromSha: null,
      pullRequest: { number: 9, url: "https://github.com/example/project/pull/9" },
      acceptanceCriteria: ["The current user decision is honored."], userDecisions: ["Keep the approved local behavior."],
      waivers: [], validation: [], reviewDecision: { decision: "required", rationale: "Changed behavior needs review." },
      resultPath: `.agents/evidence/${issueKey}/${sha}/review.json`, attempt: 1,
    };
    const bootstrap = {
      schemaVersion: "worker-bootstrap/v2", issue: { key: issueKey, summary: "Runtime fixture", sourceRef: null },
      reservedBranch: branch, executionRoute: route(), taskContextPath: ".agents/task-context/TASK-42.md",
      deliveryTarget: { repository: "example/project", remoteUrl: "https://github.com/example/project.git", baseBranch: "main", headBranch: branch,
        sourceRef: null, push: true, draftPullRequest: true, readyForHumanReview: true },
    };
    const invoke = (name, args = [], { cwd = worktree, input: data, config } = {}) => exec(cwd, process.execPath,
      [path.join(scripts, name), ...args], { input: data === undefined ? undefined : JSON.stringify(data),
        env: { ...process.env, ...(config ? { CORCH_CONFIG: config } : {}) } });
    const stateCommand = (command, args = [], options) => invoke("task-state.mjs", [command, "--issue", issueKey, ...args], options);
    action({ root, worktree, sha, state, stateFile, input, bootstrap, save, load, invoke, stateCommand });
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

test("runtime configuration supports partial overrides and validates structure without an availability allowlist", () => {
  const defaults = { ...CONFIG, runtimes: undefined };
  assert.deepEqual(resolveRuntime(defaults, "planner"), pair("gpt-6-astra", "xhigh"));
  assert.deepEqual(resolveRuntime(defaults, "tester"), pair("gpt-6-luna", "xhigh"));
  const runtimes = { planner: pair("custom-planner", "ultra"), worker: { complex: pair("custom-worker", "low") }, reviewer: pair("custom-reviewer"), tester: pair("custom-tester") };
  const config = validateConfig({ ...CONFIG, runtimes });
  for (const role of ["planner", "reviewer", "tester"]) assert.deepEqual(resolveRuntime(config, role), runtimes[role]);
  assert.deepEqual(resolveRuntime(config, "worker", { classification: "complex" }), runtimes.worker.complex);
  assert.deepEqual(resolveRuntime(config, "worker", { classification: "bounded" }), pair("gpt-6-luna", "xhigh"));
  assert.deepEqual(resolveRuntime({ ...config, runtimes: { reviewer: "worker" } }, "reviewer", { workerRoute: pair("saved-old-model", "medium") }), pair("saved-old-model", "medium"));
  for (const invalid of [null, [], "worker", { unknown: {} }, { worker: [] }, { worker: { invalid: pair("x") } },
    { worker: { bounded: { model: "x" } } }, { planner: { reasoningEffort: "high" } }, { tester: "worker" },
    { reviewer: { ...pair("x"), extra: true } }, { planner: pair("x", "invalid") }, { planner: pair("x\ninjected") }]) {
    assert.throws(() => validateConfig({ ...CONFIG, runtimes: invalid }), /Invalid Corch configuration/);
  }
  const saved = { ...route(), model: "historical-model", reasoningEffort: "low" };
  assert.equal(validateExecutionRoute(saved), saved);
});

test("escalation snapshots, upward ordering, revisions, retries and continuation use the latest route", () => fixture(({ state, stateFile, worktree, bootstrap, save, load, stateCommand, invoke }) => {
  const request = (revision, classification, rationale = "Observed coupled state transitions require deeper reasoning.") => [
    "--expected-revision", String(revision), "--classification", classification, "--signal", "crossPackageCoupling", "--rationale", rationale,
  ];
  const unchanged = readFileSync(stateFile, "utf8");
  for (const args of [request(1, "routine"), request(2, "complex"), request(1, "complex", " "), request(1, "complex").slice(0, -2)]) {
    assert.equal(stateCommand("escalate-route", args).status, 1);
    assert.equal(readFileSync(stateFile, "utf8"), unchanged);
    assert.equal(existsSync(`${stateFile}.lock`), false);
  }
  assert.equal(stateCommand("escalate-route", ["--expected-revision", "1", "--classification", "complex", "--rationale", "Missing risk evidence."]).status, 1);
  assert.equal(stateCommand("escalate-route", request(1, "complex")).status, 0);
  const escalated = load();
  assert.equal(escalated.executionRouteRevision, 2);
  assert.deepEqual(escalated.executionRouteHistory, [{ revision: 1, route: state.executionRoute }]);
  assert.deepEqual(escalated.implementationPlan, state.implementationPlan);
  const config = path.join(worktree, ".agents/changed-config.json");
  writeFileSync(config, JSON.stringify({ ...CONFIG, runtimes: { worker: { complex: pair("new-config-model") } } }));
  const retried = stateCommand("escalate-route", request(1, "complex"), { config });
  assert.equal(retried.status, 0, retried.stderr);
  assert.equal(JSON.parse(retried.stdout).status, "already-recorded");
  assert.deepEqual(load(), escalated);
  const dispatch = invoke("prepare-worker-bootstrap.mjs", ["--role", "worker", "--plan-revision", "2", "--worktree", worktree], { input: bootstrap, config });
  assert.equal(dispatch.status, 0, dispatch.stderr);
  const next = JSON.parse(dispatch.stdout);
  assert.deepEqual(next.runtime, pairToArgs(escalated.executionRoute));
  assert.equal(next.threadId, "worker-42");
  assert.equal(next.routeRevision, 2);
  assert.match(next.prompt, /worker-route:2/);
  assert.equal(next.delivered, false);
  stateCommand("record-event", ["--event", next.eventKey, "--target", next.threadId]);
  assert.equal(buildWorkerContinuation(bootstrap, load(), 2).delivered, true);
  assert.throws(() => buildWorkerContinuation(bootstrap, load(), 1), /recorded plan revision/);
  const leased = load();
  leased.activeCheckoutGate = { gate: "review" };
  save(leased);
  assert.match(stateCommand("escalate-route", request(2, "high-risk")).stderr, /active checkout gate/);
  assert.match(stateCommand("escalate-route", request(1, "complex")).stderr, /active checkout gate/);
  assert.throws(() => buildWorkerContinuation(bootstrap, load(), 2), /active checkout gate/);
  delete leased.activeCheckoutGate;
  save(leased);
  assert.equal(stateCommand("escalate-route", request(2, "high-risk")).status, 0);
  assert.equal(stateCommand("escalate-route", request(3, "exceptional")).status, 0);
  assert.equal(stateCommand("escalate-route", request(4, "complex")).status, 1);
  assert.equal(validateRouteState(load()), 4);
  const malformed = load();
  malformed.executionRouteHistory[0].revision = 5;
  assert.throws(() => validateRouteState(malformed), /history revision/);
}));
const pairToArgs = (runtime) => runtimeArguments({ model: runtime.model, reasoningEffort: runtime.reasoningEffort });

test("all role CLI dispatches honor overrides while Worker snapshots survive edits", () => fixture(({ root, input, bootstrap, state, save, load, invoke, stateCommand }) => {
  const runtimes = { planner: pair("configured-planner"), worker: { bounded: pair("configured-worker", "max") }, reviewer: pair("configured-reviewer"), tester: pair("configured-tester") };
  const config = path.join(root, "custom-config.json");
  writeFileSync(config, JSON.stringify({ ...CONFIG, runtimes }));
  delete state.executionRoute;
  save();
  const recorded = stateCommand("record-route", ["--classification", "bounded", "--rationale", "Initial configured route."], { config });
  assert.equal(recorded.status, 0, recorded.stderr);
  const savedRoute = load().executionRoute;
  for (const role of ["planner", "worker"]) {
    const args = role === "planner" ? ["--role", role, "--coordinator", "coordinator-1"] : ["--role", role, "--plan-revision", "2"];
    const result = invoke("prepare-worker-bootstrap.mjs", args, { input: bootstrap, config });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).runtime, pairToArgs(role === "worker" ? runtimes.worker.bounded : runtimes.planner));
    assert.deepEqual(JSON.parse(result.stdout).bootstrap.executionRoute, savedRoute);
  }
  for (const gate of ["review", "test"]) {
    const result = invoke("gate.mjs", ["dispatch"], { input: { ...input, gate, reviewDecision: { decision: "skipped", rationale: "Explicit user waiver." } }, config });
    assert.equal(result.status, 0, result.stderr);
    const args = JSON.parse(result.stdout).arguments;
    assert.deepEqual({ model: args.model, thinking: args.thinking }, pairToArgs(runtimes[gate === "review" ? "reviewer" : "tester"]));
  }
}));

test("bootstrap normalizes omitted and historical routes from saved state without writes or configuration drift", () => fixture(({ root, worktree, stateFile, bootstrap, state, invoke }) => {
  const { executionRoute, ...identity } = bootstrap;
  const config = path.join(root, "changed-runtime.json");
  writeFileSync(config, JSON.stringify({ ...CONFIG, runtimes: {
    planner: pair("new-planner", "max"), worker: { bounded: pair("new-worker", "low") },
  } }));
  const saved = readFileSync(stateFile, "utf8");
  const status = exec(worktree, "git", ["status", "--short", "--untracked-files=all"]).stdout;
  for (const raw of [identity, { ...bootstrap, executionRoute: { ...executionRoute, model: "historical-model" } }]) {
    for (const role of ["planner", "worker"]) {
      const args = ["--role", role, "--worktree", worktree,
        ...(role === "planner" ? ["--coordinator", "coordinator-1"] : ["--plan-revision", "2"])];
      const result = invoke("prepare-worker-bootstrap.mjs", args, { cwd: root, input: raw, config });
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.deepEqual(output.bootstrap, { ...identity, executionRoute: state.executionRoute });
      assert.deepEqual(output.runtime, role === "planner" ? { model: "new-planner", thinking: "max" } : pairToArgs(state.executionRoute));
      assert.ok(output.prompt.includes(state.executionRoute.model));
      if (role === "worker") {
        assert.equal(output.threadId, "worker-42");
        assert.equal(output.routeRevision, 1);
        assert.equal(output.eventKey, "worker-route:1");
      }
      assert.equal(readFileSync(stateFile, "utf8"), saved);
      assert.equal(exec(worktree, "git", ["status", "--short", "--untracked-files=all"]).stdout, status);
      assert.equal(existsSync(`${stateFile}.lock`), false);
    }
  }
}));

test("bootstrap rejects missing or malformed saved state and invalid embedded snapshots for both roles", () => fixture(({ stateFile, state, bootstrap, invoke }) => {
  const { executionRoute, ...identity } = bootstrap;
  const run = (role, input) => invoke("prepare-worker-bootstrap.mjs",
    role === "planner" ? ["--coordinator", "coordinator-1"] : ["--role", "worker", "--plan-revision", "2"], { input });
  for (const badState of [null, "{", { ...state, executionRoute: undefined },
    { ...state, schemaVersion: "task-state/v1" }, { ...state, issueKey: "TASK-43" },
    { ...state, executionRoute: { ...executionRoute, model: "" } },
    { ...state, executionRouteRevision: 2, executionRouteHistory: [] }]) {
    if (badState === null) rmSync(stateFile);
    else writeFileSync(stateFile, typeof badState === "string" ? badState : JSON.stringify(badState));
    const saved = existsSync(stateFile) ? readFileSync(stateFile, "utf8") : null;
    for (const role of ["planner", "worker"]) {
      // Even a complete legacy packet must not bypass invalid or absent state.
      for (const raw of [identity, bootstrap]) {
        const result = run(role, raw);
        assert.equal(result.status, 1);
        assert.equal(result.stdout, "");
        assert.equal(existsSync(stateFile) ? readFileSync(stateFile, "utf8") : null, saved);
        assert.equal(existsSync(`${stateFile}.lock`), false);
      }
    }
  }
  writeFileSync(stateFile, JSON.stringify(state));
  for (const badRoute of [null, {}, { ...executionRoute, issueKey: "TASK-43" }, { ...executionRoute, reasoningEffort: "invalid" }]) {
    for (const role of ["planner", "worker"]) {
      const result = run(role, { ...bootstrap, executionRoute: badRoute });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
    }
  }
}));

test("fresh gate startup claims the linked Worker checkout from the primary directory atomically", () => fixture(({ root, worktree, sha, stateFile, input, load, invoke, stateCommand }) => {
  // Execute the exact generated argument array as a new saved-project chat would.
  cpSync(scripts, path.join(worktree, ".agents/skills/corch-development-workflow/scripts"), { recursive: true });
  writeFileSync(path.join(worktree, ".agents/workflow.json"), JSON.stringify(CONFIG));
  const dispatch = buildGateDispatch(input);
  assert.equal(dispatch.action, "create");
  assert.deepEqual(dispatch.arguments.target, { type: "project", projectId: "fixture-project", environment: { type: "local" } });
  assert.equal(dispatch.arguments.title, "[TASK-42] Reviewer");
  assert.match(dispatch.arguments.prompt, /claim-gate/);
  assert.match(dispatch.arguments.prompt, /current user decision/);
  const hook = invoke("workflow-hook.mjs", ["session-start"], { cwd: root, input: { cwd: root, session_id: "fresh-review" } });
  assert.equal(hook.status, 0, hook.stderr);
  assert.match(JSON.parse(hook.stdout).hookSpecificOutput.additionalContext, /Corch session ID: fresh-review/);
  for (const session_id of [undefined, 123, ["looks-valid"], " ", "injected\nidentity"]) {
    const missing = invoke("workflow-hook.mjs", ["session-start"], { cwd: root, input: { cwd: root, session_id } });
    assert.match(JSON.parse(missing.stdout).hookSpecificOutput.additionalContext, /session ID unavailable/);
  }
  const claim = JSON.parse(dispatch.arguments.prompt.split("\n").find((line) => line.startsWith("[\"")));
  const identityIndex = claim.indexOf("--thread") + 1;
  const before = readFileSync(stateFile, "utf8");
  const call = (args) => exec(root, args[0], args.slice(1));
  assert.equal(call(claim).status, 1); // placeholder is never a valid session ID
  claim[identityIndex] = "fresh-review";
  const wrongSha = [...claim]; wrongSha[wrongSha.indexOf("--sha") + 1] = "b".repeat(40);
  assert.match(call(wrongSha).stderr, /commit does not match/);
  const wrongCheckout = [...claim]; wrongCheckout[wrongCheckout.indexOf("--worktree") + 1] = root;
  assert.equal(call(wrongCheckout).status, 1);
  assert.equal(readFileSync(stateFile, "utf8"), before);
  const claimed = call(claim);
  assert.equal(claimed.status, 0, claimed.stderr);
  assert.equal(load().activeCheckoutGate.observedSha, sha);
  assert.equal(load().tasks.reviewer.threadId, "fresh-review");
  assert.equal(JSON.parse(call(claim).stdout).status, "already-recorded");
  const different = [...claim]; different[identityIndex] = "other-review";
  assert.match(call(different).stderr, /another active task/);
  const tester = [...claim]; tester[tester.indexOf("--gate") + 1] = "test"; tester[identityIndex] = "fresh-test";
  assert.match(call(tester).stderr, /another checkout gate/);
  assert.equal(load().tasks.tester, undefined);
  assert.equal(existsSync(`${stateFile}.lock`), false);
  assert.throws(() => buildGateDispatch(input), /active checkout gate/);
  assert.equal(stateCommand("end-gate", ["--gate", "review", "--thread", "fresh-review"]).status, 0);
  const reuse = buildGateDispatch({ ...input, attempt: 2 });
  assert.equal(reuse.action, "reuse");
  assert.equal(reuse.arguments.threadId, "fresh-review");
  assert.equal(reuse.arguments.model, undefined);
  assert.equal(reuse.arguments.thinking, undefined);
}));

test("gate dispatch sequencing, creation recovery, and reference guards preserve existing families", () => fixture(({ input, state, save, load, worktree, sha, stateCommand, invoke }) => {
  const testerInput = { ...input, gate: "test", resultPath: `.agents/evidence/${issueKey}/${sha}/test.json` };
  assert.throws(() => buildGateDispatch(testerInput), /complete Reviewer/);
  const review = {
    schemaVersion: "review-result/v2", issueKey, repository: "example/project", pullRequest: input.pullRequest,
    baseBranch: "main", headBranch: branch, observedSha: sha, comparedFromSha: null, verdict: "APPROVED", summary: "Current target reviewed.",
    acceptance: [{ criterion: input.acceptanceCriteria[0], status: "PASS", evidence: "Inspected current behavior." }], findings: [], artifacts: [],
  };
  const resultPath = path.join(worktree, input.resultPath);
  mkdirSync(path.dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, JSON.stringify(review));
  assert.equal(stateCommand("record-gate", ["--gate", "review", "--sha", sha, "--result", input.resultPath]).status, 0);
  assert.equal(buildGateDispatch(testerInput).action, "create");
  assert.throws(() => buildGateDispatch({ ...testerInput, acceptanceCriteria: ["New approved target."] }), /refresh Reviewer/);
  writeFileSync(resultPath, JSON.stringify({ ...review, verdict: "BLOCKED" }));
  assert.throws(() => buildGateDispatch(testerInput), /Reviewer verdict/);
  assert.equal(buildGateDispatch({ ...testerInput, reviewDecision: { decision: "skipped", rationale: "User waived review." } }).action, "create");
  const created = buildGateDispatch(input);
  const current = load(); current.deliveredEvents[created.eventKey] = "pending-review"; save(current);
  assert.equal(buildGateDispatch(input).action, "recover");
  current.tasks.reviewer = { threadId: "pending-review", worktree, retired: false }; save(current);
  assert.equal(buildGateDispatch(input).action, "delivered");
  assert.equal(buildGateDispatch({ ...input, attempt: 2 }).action, "reuse");
  const assessed = invoke("gate.mjs", ["assess", "--gate", "review", "--from", sha, "--to", sha,
    "--impact", "irrelevant", "--rationale", "The reviewed commit remains unchanged."]);
  assert.equal(assessed.status, 0, assessed.stderr);
  const delta = JSON.parse(assessed.stdout);
  const correction = buildGateDispatch({ ...input, attempt: 2, comparedFromSha: sha, delta });
  assert.equal(correction.action, "reuse");
  assert.match(correction.arguments.prompt, /carry-forward/);
  assert.match(correction.arguments.prompt, /review-result\/v2/);
  assert.throws(() => buildGateDispatch({ ...input, delta }), /delta assessment identity/);
  current.deliveredEvents[created.eventKey] = "different-review"; save(current);
  assert.throws(() => buildGateDispatch(input), /conflicts/);
  save(state);
  for (const change of [{ workerTranscript: "private history" }, { projectPath: worktree }, { observedSha: "c".repeat(40) },
    { resultPath: "../outside.json" }, { delta: { implementationNarrative: "prior reasoning" } }, { userDecisions: undefined }]) {
    assert.throws(() => buildGateDispatch({ ...input, ...change }));
  }
  rmSync(path.join(worktree, ".agents/task-state/TASK-42-plan.md"));
  assert.throws(() => buildGateDispatch(input), /ENOENT/);
}));

test("compact correction dispatch matches standalone assessment without files or state writes", () => fixture(({ root, worktree, sha, input, invoke }) => {
  const git = (...args) => {
    const result = exec(worktree, "git", args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const snapshot = (directory) => readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map((entry) => {
    const filename = path.join(directory, entry.name);
    return [entry.name, entry.isDirectory() ? snapshot(filename) : readFileSync(filename, "hex")];
  });
  writeFileSync(path.join(worktree, "feature.js"), "export const value = 1;\n");
  git("add", "feature.js"); git("commit", "--quiet", "-m", "feature");
  const descendant = git("rev-parse", "HEAD");
  const cases = [[sha, descendant, "irrelevant", "carry-forward"], [sha, descendant, "affected", "targeted-delta"],
    [sha, descendant, "material", "coherent-recheck"], [descendant, descendant, "affected", "carry-forward"]];
  const run = (from, to, impact, action) => {
    const delta = { impact, rationale: "The current correction has the documented gate impact.",
      acceptanceFocus: input.acceptanceCriteria, priorFindingIds: ["R1", "R1"] };
    const request = { ...input, observedSha: to, comparedFromSha: from,
      resultPath: `.agents/evidence/${issueKey}/${to}/review.json`, attempt: 2, delta };
    const before = snapshot(worktree);
    const assessed = invoke("gate.mjs", ["assess", "--gate", "review", "--from", from, "--to", to,
      "--impact", impact, "--rationale", delta.rationale, "--acceptance", input.acceptanceCriteria[0], "--finding", "R1", "--finding", "R1"]);
    assert.equal(assessed.status, 0, assessed.stderr);
    const assessment = JSON.parse(assessed.stdout);
    assert.equal(assessment.action, action);
    const former = buildGateDispatch({ ...request, delta: assessment });
    const compact = invoke("gate.mjs", ["dispatch"], { cwd: root, input: request });
    assert.equal(compact.status, 0, compact.stderr);
    assert.deepEqual(JSON.parse(compact.stdout), former);
    assert.deepEqual(buildGateDispatch(request), former);
    const contradictions = [{ fromSha: "b".repeat(40) }, { toSha: "b".repeat(40) }, { role: "test" },
      { comparisonRange: "wrong" }, { descendant: !assessment.descendant }, { rewrittenHistory: !assessment.rewrittenHistory },
      { changedFiles: ["fabricated.js"] }, { statistics: [{ path: "fabricated.js", additions: 99, deletions: 0 }] },
      { action: "unsupported" }, { requestedResult: "invalid" }, { extra: true }];
    for (const change of action === "targeted-delta" ? contradictions : []) {
      assert.throws(() => buildGateDispatch({ ...request, delta: { ...assessment, ...change } }), /assessment identity|contradicts/);
    }
    assert.deepEqual(snapshot(worktree), before, "preparation must not create an assessment file or modify state/evidence");
    return request;
  };
  for (const args of cases) run(...args);
  writeFileSync(path.join(worktree, "feature.js"), "export const value = 2;\n");
  git("add", "feature.js"); git("commit", "--quiet", "--amend", "-m", "rewritten feature");
  const rewritten = git("rev-parse", "HEAD");
  const request = run(descendant, rewritten, "irrelevant", "coherent-recheck");
  assert.throws(() => buildGateDispatch({ ...request, comparedFromSha: "c".repeat(40) }), /valid object|Not a valid|bad object/i);
  for (const delta of [{ impact: "invalid", rationale: "Invalid impact test." }, { impact: "affected", rationale: "short" },
    { ...request.delta, acceptanceFocus: "wrong" }, { ...request.delta, priorFindingIds: [null] },
    { ...request.delta, role: "test" }, { ...request.delta, implementationNarrative: "forbidden" }]) {
    assert.throws(() => buildGateDispatch({ ...request, delta }));
  }
}));

test("Git failures fail assessment and dispatch instead of pretending history was rewritten", () => fixture(({ root, worktree, sha, input, invoke }) => {
  const git = (...args) => {
    const result = exec(worktree, "git", args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const commits = [];
  for (const version of [1, 2]) {
    writeFileSync(path.join(worktree, "feature.txt"), `version ${version}\n`);
    git("add", "feature.txt"); git("commit", "--quiet", "-m", `version ${version}`);
    commits.push(git("rev-parse", "HEAD"));
  }
  // Both endpoint commits exist, but their intermediate parent is unreadable.
  const parentObject = path.join(root, ".git", "objects", commits[0].slice(0, 2), commits[0].slice(2));
  assert.ok(existsSync(parentObject));
  rmSync(parentObject);
  const judgment = { impact: "affected", rationale: "The changed feature needs a targeted review." };
  assert.throws(() => assessGateDelta({ gate: "review", fromSha: sha, toSha: commits[1], ...judgment }, worktree), /read|parse|bad object/i);
  const request = { ...input, observedSha: commits[1], comparedFromSha: sha, delta: judgment,
    resultPath: `.agents/evidence/${issueKey}/${commits[1]}/review.json` };
  const result = invoke("gate.mjs", ["dispatch"], { input: request });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.throws(() => assessGateDelta({ gate: "review", fromSha: sha, toSha: sha, ...judgment }, path.join(root, "missing")), /ENOENT/);
}));

test("a first gate claim from primary copies shared fallback into the Worker checkout only", () => fixture(({ root, worktree, sha, state, stateFile, stateCommand, load }) => {
  const sharedFile = path.join(root, ".agents/task-state/TASK-42.json");
  mkdirSync(path.dirname(sharedFile), { recursive: true });
  writeFileSync(sharedFile, JSON.stringify(state));
  rmSync(stateFile);
  const result = stateCommand("claim-gate", ["--gate", "review", "--thread", "first-gate", "--worktree", worktree, "--sha", sha], { cwd: root });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(load().tasks.reviewer.threadId, "first-gate");
  assert.equal(JSON.parse(readFileSync(sharedFile)).tasks.reviewer, undefined);
}));
