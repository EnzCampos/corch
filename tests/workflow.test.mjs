import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { fixture, scripts, git, write, workItem, delivery, command } from "./helpers.mjs";
import { redactText, detectUnsafeText } from "../.agents/skills/corch-development-workflow/scripts/lib/validation.mjs";

test("full local helper cycle prepares a single record and records results before adding a PR", () => fixture(({ root, state, invoke }) => {
  state("record-context", ["--expected-revision", "0"], { input: workItem() });
  state("record-delivery", ["--expected-revision", "0"], { input: delivery() });
  state("record-route", ["--classification", "bounded", "--rationale", "Small fixture"]);
  const checkout = path.join(root, "worker");
  git(root, "branch", delivery().headBranch);
  git(root, "worktree", "add", "--quiet", "--detach", checkout, delivery().headBranch);
  const prepared = command(root, process.execPath, [path.join(scripts, "prepare-worker-worktree.mjs"), "--issue", "TASK-42", "--thread", "planner", "--worktree", checkout]);
  assert.equal(prepared.status, 0, prepared.stderr);
  const local = (name, args = [], options = {}) => state(name, args, { cwd: checkout, ...options });
  const plan = ".agents/task-state/TASK-42-plan.md";
  write(path.join(checkout, plan), "# TASK-42 Implementation plan\n\nChange the existing owner and verify AC-1.\n");
  local("record-plan", ["--revision", "1", "--path", plan]);
  local("register-task", ["--role", "worker", "--thread", "worker", "--worktree", checkout, "--branch", delivery().headBranch]);
  const sha = git(checkout, "rev-parse", "HEAD");
  for (const [gate, role, verdict] of [["review", "reviewer", "APPROVED"], ["test", "tester", "PASS"]]) {
    local("register-task", ["--role", role, "--thread", role, "--worktree", checkout, "--branch", delivery().headBranch]);
    local("claim-gate", ["--gate", gate, "--thread", role, "--worktree", checkout, "--sha", sha]);
    const event = `gate:${gate}:${sha}:1`;
    local("record-event", ["--event", event, "--target", role]);
    assert.equal(local("record-event", ["--event", event, "--target", role]).status, "already-recorded");
    const result = `.agents/evidence/TASK-42/${sha}/${role}-1.md`;
    write(path.join(checkout, result), `# TASK-42 ${role}\nObserved commit: ${sha}\nVerdict: ${verdict}\nAC-1: fixture verified. Evidence remains local.\n`);
    local("record-gate", ["--gate", gate, "--sha", sha, "--result", result]);
    local("end-gate", ["--gate", gate, "--thread", role]);
  }
  const before = local("show");
  assert.equal(before.delivery.pullRequest, null);
  const pr = { number: 17, url: "https://github.com/example/project/pull/17" };
  local("record-delivery", ["--expected-revision", "1"], { input: delivery("TASK-42", { pullRequest: pr }) });
  const after = local("show");
  assert.deepEqual(after.gates, before.gates);
  assert.deepEqual(after.tasks, before.tasks);
  assert.deepEqual(after.implementationPlan, before.implementationPlan);
  assert.equal(after.activeCheckoutGate, undefined);
  assert.deepEqual(after.delivery.pullRequest, pr);
  assert.equal(state("show").tasks.worker, undefined, "worktree updates do not overwrite primary state");
  assert.equal(existsSync(path.join(checkout, ".agents/task-context")), false);
  assert.equal(readdirSync(path.join(checkout, ".agents/task-state")).some((name) => /bootstrap-input|amendment|report/.test(name)), false);
  const changed = invoke(["record-delivery", "--issue", "TASK-42", "--expected-revision", "2"], { cwd: checkout, input: delivery("TASK-42", { headBranch: "corch/task-42-other" }) });
  assert.equal(changed.status, 1); assert.match(changed.stderr, /identity cannot change/);
  const forged = invoke(["record-delivery", "--issue", "TASK-42", "--expected-revision", "2"], { cwd: checkout, input: delivery("TASK-42", { pullRequest: { number: 17, url: "https://github.com/other/repo/pull/17" } }) });
  assert.equal(forged.status, 1);
}));

test("independent roles claim and record an uncommitted candidate with no commit authority", () => fixture(({ root, state }) => {
  write(path.join(root, "candidate.txt"), "Baseline fixture\n");
  git(root, "add", "candidate.txt");
  git(root, "commit", "--quiet", "-m", "baseline fixture");
  const branch = delivery().headBranch;
  git(root, "switch", "-c", branch);
  state("record-context", ["--expected-revision", "0"], { input: workItem() });
  state("record-delivery", ["--expected-revision", "0"], { input: delivery() });
  state("register-task", ["--role", "worker", "--thread", "worker", "--worktree", root, "--branch", branch]);
  const head = git(root, "rev-parse", "HEAD");
  write(path.join(root, "candidate.txt"), "Staged candidate\n");
  git(root, "add", "candidate.txt");
  write(path.join(root, "candidate.txt"), "Working candidate\n");
  write(path.join(root, "new-candidate.txt"), "Untracked candidate\n");
  const status = git(root, "status", "--porcelain");
  assert.match(status, /MM candidate.txt/);
  assert.match(status, /\?\? new-candidate.txt/);
  const staged = git(root, "diff", "--cached", "--binary");
  const unstaged = git(root, "diff", "--binary");
  for (const [gate, role, verdict] of [["review", "reviewer", "APPROVED"], ["test", "tester", "PASS"]]) {
    state("claim-gate", ["--gate", gate, "--thread", role, "--worktree", root, "--sha", head]);
    assert.equal(state("show").activeCheckoutGate.observedSha, head);
    assert.equal(readFileSync(path.join(root, "candidate.txt"), "utf8"), "Working candidate\n");
    const result = `.agents/evidence/TASK-42/${head}/${role}-1.md`;
    write(path.join(root, result), `# TASK-42 ${role}\nTarget: working-tree at HEAD ${head}\nStaged:\n${staged}\nUnstaged:\n${unstaged}\nNew file: new-candidate.txt (Untracked candidate)\nVerdict: ${verdict}\n`);
    state("record-gate", ["--gate", gate, "--sha", head, "--result", result]);
    state("end-gate", ["--gate", gate, "--thread", role]);
  }
  const recorded = state("show");
  assert.deepEqual(recorded.delivery.allowedOperations, []);
  assert.equal(recorded.delivery.pullRequest, null);
  assert.equal(recorded.tasks.reviewer.threadId, "reviewer");
  assert.equal(recorded.tasks.tester.threadId, "tester");
  assert.equal(recorded.gates.review.observedSha, head);
  assert.equal(recorded.gates.test.observedSha, head);
  assert.equal(recorded.activeCheckoutGate, undefined);
  assert.equal(git(root, "rev-parse", "HEAD"), head, "roles need no candidate commit");
  assert.equal(git(root, "status", "--porcelain"), status, "staged, unstaged and untracked changes are preserved");
}));

test("idle legacy state upgrades preserve identities, approval references, outcomes and events", () => fixture(({ root, state }) => {
  const legacyDelivery = delivery("TASK-42", { headBranch: "codex/task-42-fixture" });
  git(root, "switch", "-c", legacyDelivery.headBranch);
  state("record-route", ["--classification", "routine", "--rationale", "Existing delivery"]);
  state("register-task", ["--role", "worker", "--thread", "historical-worker", "--worktree", root, "--branch", legacyDelivery.headBranch]);
  state("escalate-route", ["--expected-revision", "1", "--classification", "complex", "--signal", "heavyValidation", "--rationale", "Recorded validation risk"]);
  const old = state("show");
  const sha = git(root, "rev-parse", "HEAD");
  Object.assign(old, {
    tasks: { worker: { threadId: "historical-worker", branch: legacyDelivery.headBranch, worktree: root, retired: false } },
    context: { materialRevision: 3, sharedPath: ".agents/task-context/TASK-42.md" },
    implementationPlan: { schemaVersion: "implementation-plan/v4", path: ".agents/task-state/TASK-42-plan.md", revision: 4 },
    gates: { review: { observedSha: sha, resultPath: `.agents/evidence/TASK-42/${sha}/review-result.json` } },
    deliveredEvents: { "worker-route:1": "historical-worker" },
  });
  write(path.join(root, ".agents/task-state/TASK-42.json"), old);
  state("record-context", ["--expected-revision", "0"], { input: workItem() });
  state("record-delivery", ["--expected-revision", "0"], { input: legacyDelivery });
  const upgraded = state("show");
  for (const key of Object.keys(old)) assert.deepEqual(upgraded[key], old[key], key);
  assert.equal(upgraded.workItem.revision, 1);
  assert.equal(upgraded.executionRouteHistory.length, 1);
  assert.equal(upgraded.delivery.headBranch, legacyDelivery.headBranch);
  assert.equal(git(root, "branch", "--show-current"), legacyDelivery.headBranch);
  const pr = { number: 17, url: "https://github.com/example/project/pull/17" };
  state("record-delivery", ["--expected-revision", "1"], { input: { ...legacyDelivery, pullRequest: pr } });
  assert.deepEqual(state("show").delivery.pullRequest, pr);
}));

test("plan references reject missing files, wrong identity and stale revisions while preserving registration metadata", () => fixture(({ root, state, invoke }) => {
  const plan = ".agents/task-state/TASK-42-plan.md";
  const record = (revision) => ["record-plan", "--issue", "TASK-42", "--revision", String(revision), "--path", plan];
  assert.equal(invoke(record(1)).status, 1);
  write(path.join(root, plan), "# TASK-41 Wrong plan\nBody");
  assert.equal(invoke(record(1)).status, 1);
  write(path.join(root, plan), "# TASK-42 Implementation plan\nBody");
  assert.equal(invoke(record(0)).status, 1);
  assert.equal(invoke(record(1)).status, 0);
  assert.equal(JSON.parse(invoke(record(1)).stdout).status, "already-recorded");
  assert.equal(invoke(record(2)).status, 0);
  assert.equal(invoke(record(1)).status, 1);
  assert.equal(state("show").implementationPlan.revision, 2);
  state("register-task", ["--role", "worker", "--thread", "worker", "--worktree", root, "--branch", "main", "--host", "local"]);
  const before = state("show").tasks.worker;
  assert.equal(state("register-task", ["--role", "worker", "--thread", "worker"]).status, "already-recorded");
  assert.deepEqual(state("show").tasks.worker, before);
}));

test("legacy begin-gate and claim-gate serialize the same target checkout even from another cwd", () => fixture(({ root, state, invoke }) => {
  const checkout = path.join(root, "linked");
  const branch = delivery().headBranch;
  git(root, "worktree", "add", "--quiet", "-b", branch, checkout);
  for (const role of ["worker", "reviewer", "tester"]) state("register-task", ["--role", role, "--thread", role, "--worktree", checkout, "--branch", branch]);
  state("record-event", ["--event", "local:initialized", "--target", "worker"], { cwd: checkout });
  const sha = git(checkout, "rev-parse", "HEAD");
  state("begin-gate", ["--gate", "review", "--thread", "reviewer", "--worktree", checkout, "--sha", sha]);
  assert.equal(state("show").activeCheckoutGate, undefined);
  assert.equal(state("show", [], { cwd: checkout }).activeCheckoutGate.threadId, "reviewer");
  const conflict = invoke(["claim-gate", "--issue", "TASK-42", "--gate", "test", "--thread", "tester", "--worktree", checkout, "--sha", sha]);
  assert.equal(conflict.status, 1); assert.match(conflict.stderr, /another checkout gate/);
  state("end-gate", ["--gate", "review", "--thread", "reviewer"], { cwd: checkout });
}));

test("an active lease blocks migration and result references cannot escape their task directory", () => fixture(({ root, state, invoke }) => {
  state("register-task", ["--role", "worker", "--thread", "worker", "--worktree", root, "--branch", "main"]);
  const sha = git(root, "rev-parse", "HEAD");
  state("claim-gate", ["--gate", "review", "--thread", "reviewer", "--worktree", root, "--sha", sha]);
  for (const [name, input] of [["record-context", workItem()], ["record-delivery", delivery()]]) {
    const result = invoke([name, "--issue", "TASK-42", "--expected-revision", "0"], { input });
    assert.equal(result.status, 1); assert.match(result.stderr, /active checkout gate/);
  }
  assert.equal(state("show").activeCheckoutGate.threadId, "reviewer");
  for (const resultPath of ["../outside.md", `.agents/evidence/TASK-42/${sha}/../../outside.md`, `.agents/evidence/TASK-43/${sha}/result.md`]) {
    assert.equal(invoke(["record-gate", "--issue", "TASK-42", "--gate", "review", "--sha", sha, "--result", resultPath]).status, 1);
  }
  state("end-gate", ["--gate", "review", "--thread", "reviewer"]);
}));

test("log redaction keeps commit/CI identity while removing secret and customer data", () => {
  const sha = "1234567890".repeat(4);
  assert.deepEqual(detectUnsafeText(sha), []);
  const url = "https://github.com/example/project/actions/runs/12345678901";
  assert.equal(redactText(url), url);
  const text = redactText("token=" + "z".repeat(30) + " customer fixture@example.test phone 11999991234");
  assert.doesNotMatch(text, /z{30}|fixture@example|11999991234/);
});

test("result and log directories cannot escape a linked checkout through a symlink", (context) => fixture(({ root, invoke }) => {
  const checkout = path.join(root, "linked");
  git(root, "worktree", "add", "--quiet", "--detach", checkout);
  const foreign = path.join(root, "foreign");
  write(path.join(foreign, "result.md"), "Do not publish outside evidence");
  const sha = git(checkout, "rev-parse", "HEAD");
  mkdirSync(path.join(checkout, ".agents/evidence/TASK-42"), { recursive: true });
  try { symlinkSync(foreign, path.join(checkout, ".agents/evidence/TASK-42", sha), process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (["EPERM", "EACCES"].includes(error.code)) { context.skip("symlink creation unavailable"); return; } throw error; }
  const result = invoke(["record-gate", "--issue", "TASK-42", "--gate", "test", "--sha", sha, "--result", `.agents/evidence/TASK-42/${sha}/result.md`], { cwd: checkout });
  assert.equal(result.status, 1); assert.match(result.stderr, /escapes the checkout/);
  symlinkSync(foreign, path.join(checkout, ".agents/task-state/logs"), process.platform === "win32" ? "junction" : "dir");
  const check = command(checkout, process.execPath, [path.join(scripts, "run-bounded-check.mjs"), "--issue", "TASK-42", "--name", "escape", "--", process.execPath, "--version"]);
  assert.equal(check.status, 1); assert.match(check.stderr, /escapes the checkout/);
  assert.equal(existsSync(path.join(foreign, "TASK-42/escape.log")), false);
}));

test("distributed skill and environment command references resolve in the installed toolkit", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const skillsRoot = path.join(root, ".agents/skills");
  for (const role of readdirSync(skillsRoot).filter((name) => name.startsWith("corch-"))) {
    const text = readFileSync(path.join(skillsRoot, role, "SKILL.md"), "utf8");
    const frontmatter = parseYaml(text.split("---")[1]);
    assert.equal(frontmatter.name, role); assert.ok(frontmatter.description);
    for (const [, filename] of text.matchAll(/\b([a-z][a-z-]*\.mjs)\b/g)) {
      assert.ok(existsSync(path.join(scripts, filename)) || existsSync(path.join(scripts, "lib", filename)), `${role}: ${filename}`);
    }
    for (const [, skill] of text.matchAll(/\$(corch-[a-z-]+)/g)) assert.ok(existsSync(path.join(skillsRoot, skill, "SKILL.md")), skill);
  }
  const environment = readFileSync(path.join(root, ".codex/environments/environment.toml"), "utf8");
  const script = environment.match(/script = "node ([^"]+)"/)[1];
  assert.ok(existsSync(path.join(root, script)));
  for (const directory of [scripts, path.join(scripts, "lib")]) {
    for (const file of readdirSync(directory).filter((name) => name.endsWith(".mjs"))) {
      const source = readFileSync(path.join(directory, file), "utf8");
      for (const [, imported] of source.matchAll(/from "([^"]+)"/g)) {
        assert.ok(imported.startsWith("node:") || (imported.startsWith(".") && existsSync(path.resolve(directory, imported))), `${file}: ${imported}`);
      }
    }
  }
});
