import { CONFIG } from "../.agents/skills/corch-development-workflow/scripts/workflow-config.mjs";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { buildDeliveryTaskDispatch, createExecutionRoute } from "../.agents/skills/corch-development-workflow/scripts/workflow-lib.mjs";
import { plannerLaunchFromPrompt, prepareWorktree, runSetupCommand } from "../.agents/skills/corch-development-workflow/scripts/prepare-worker-worktree.mjs";
import { userPromptSubmit } from "../.agents/skills/corch-development-workflow/scripts/workflow-hook.mjs";


const scripts = fileURLToPath(new URL("../.agents/skills/corch-development-workflow/scripts/", import.meta.url));
function write(target, value) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value));
}
function command(cwd, executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8", windowsHide: true, timeout: 20_000, ...options });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
const git = (cwd, ...args) => command(cwd, "git", args);
async function fixture(action) {
  const root = mkdtempSync(path.join(os.tmpdir(), "corch-bootstrap-"));
  try {
    const primary = path.join(root, "primary");
    mkdirSync(primary);
    git(primary, "init", "-b", "main");
    git(primary, "config", "user.name", "Fixture");
    git(primary, "config", "user.email", "fixture@example.test");
    git(primary, "remote", "add", "origin", "https://github.com/example/project.git");
    write(path.join(primary, ".gitignore"), ".agents/task-state/\n.agents/task-context/\nnode_modules/\n");
    write(path.join(primary, "dependencies.lock"), "fixture lock\n");
    write(path.join(primary, "schema.txt"), "fixture schema\n");
    write(path.join(primary, ".agents/workflow.json"), { ...CONFIG, setup: { steps: [
      { name: "install", command: process.execPath, args: ["fixture", "install"], inputs: ["dependencies.lock"], outputs: ["node_modules/.ready"] },
      { name: "generate", command: process.execPath, args: ["fixture", "generate"], inputs: ["schema.txt"], outputs: ["node_modules/generated.js"] },
    ] } });
    git(primary, "add", ".");
    git(primary, "commit", "-m", "fixture");
    const create = (number) => {
      const issue = `TASK-${number}`;
      const branch = `codex/task-${number}-fixture`;
      const cwd = path.join(root, issue);
      git(primary, "branch", branch);
      git(primary, "worktree", "add", "--detach", cwd, branch);
      const input = {
        schemaVersion: "worker-bootstrap/v2",
        issue: { key: issue, summary: "Bootstrap fixture", sourceRef: null },
        reservedBranch: branch,
        taskContextPath: `.agents/task-context/${issue}.md`,
        executionRoute: createExecutionRoute({ issueKey: issue, classification: "bounded", riskSignals: [], rationale: "A bounded fixture." }),
        deliveryTarget: {
          repository: "example/project", remoteUrl: "https://github.com/example/project.git",
          baseBranch: "main", headBranch: branch, push: true, draftPullRequest: true,
          readyForHumanReview: true, sourceRef: null,
        },
      };
      write(path.join(primary, `.agents/task-state/${issue}-bootstrap-input.json`), input);
      write(path.join(primary, `.agents/task-state/${issue}.json`), {
        schemaVersion: "task-state/v2", workflowProtocol: "delivery-v3", issueKey: issue,
        tasks: {}, gates: {}, deliveredEvents: {},
      });
      write(path.join(primary, input.taskContextPath), `<!-- corch-task-context:v3 issue=${issue} -->\n# ${issue}\nScoped fixture.\n`);
      const prompt = buildDeliveryTaskDispatch(input, { coordinator: "coordinator-fixture" }).prompt;
      return { cwd, issue, branch, input, prompt, launch: plannerLaunchFromPrompt(prompt), sessionId: `planner-${number}` };
    };
    const calls = [];
    const execute = async (_command, args, { cwd }) => {
      calls.push({ cwd, action: args[1] });
      await delay(20);
      if (args[1] === "install") write(path.join(cwd, "node_modules/.ready"), "fixture");
      else write(path.join(cwd, "node_modules/generated.js"), "export const generated = true;");
      return { status: 0, stdout: "", stderr: "" };
    };
    await action({ root, primary, create, execute, calls });
  } finally {
    // Only the explicit mkdtemp fixture tree is removed, never a project checkout.
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

test("detached simultaneous starts attach different branches and hydrate/register before model execution", () => fixture(async ({ create, execute, calls }) => {
  const tasks = [create(70), create(93)];
  assert.equal(git(tasks[0].cwd, "rev-parse", "HEAD"), git(tasks[1].cwd, "rev-parse", "HEAD"));
  assert.equal(git(tasks[0].cwd, "branch", "--show-current"), "");
  const results = await Promise.all(tasks.map((task) => userPromptSubmit({ cwd: task.cwd, session_id: task.sessionId, prompt: task.prompt }, { execute })));
  for (const [index, task] of tasks.entries()) {
    assert.match(results[index].hookSpecificOutput.additionalContext, /bootstrap ready/);
    assert.equal(git(task.cwd, "branch", "--show-current"), task.branch);
    const state = JSON.parse(readFileSync(path.join(task.cwd, `.agents/task-state/${task.issue}.json`)));
    assert.equal(state.tasks.planner.threadId, task.sessionId);
    assert.equal(state.tasks.planner.kind, "task");
    assert.match(readFileSync(path.join(task.cwd, task.input.taskContextPath), "utf8"), new RegExp(task.issue));
    const planPath = path.join(task.cwd, `.agents/task-state/${task.issue}-plan.md`);
    write(planPath, "Existing approved plan");
    await prepareWorktree({ ...task, execute });
    const workerPrompt = buildDeliveryTaskDispatch(task.input, { role: "worker", planRevision: 1 }).prompt;
    assert.deepEqual(await userPromptSubmit({ cwd: task.cwd, session_id: "worker", prompt: workerPrompt }, { execute }), {});
    assert.equal(readFileSync(planPath, "utf8"), "Existing approved plan");
  }
  assert.equal(calls.length, 4, "one install and generation per checkout, no repeat setup");
}));

test("same-worktree environment and prompt setup serialize and reuse dependencies", () => fixture(async ({ create, execute, calls }) => {
  const task = create(71);
  await Promise.all([prepareWorktree({ cwd: task.cwd, execute }), prepareWorktree({ ...task, execute })]);
  assert.deepEqual(calls.map((call) => call.action), ["install", "generate"]);
  write(path.join(task.cwd, "schema.txt"), "changed schema");
  await prepareWorktree({ ...task, execute });
  assert.deepEqual(calls.map((call) => call.action), ["install", "generate", "generate"]);
}));

test("prompt matching handles delegation/CRLF and ignores ordinary or old task prompts", () => fixture(async ({ create }) => {
  const task = create(72);
  assert.deepEqual(plannerLaunchFromPrompt(`<codex_delegation>\n<source_thread_id>parent</source_thread_id>\n<input>${task.prompt.replaceAll("\n", "\r\n")}</input>\n</codex_delegation>`), task.launch);
  assert.equal(plannerLaunchFromPrompt(task.prompt.replace(`Corch bootstrap: ${task.issue}\n`, "")), undefined);
  assert.deepEqual(await userPromptSubmit({ prompt: "Continue planning" }), {});
}));

test("hydration and install failures block startup, release lock, and do not claim ready", () => fixture(async ({ primary, create, execute, calls }) => {
  const task = create(73);
  const event = { cwd: task.cwd, session_id: task.sessionId, prompt: task.prompt };
  rmSync(path.join(primary, task.input.taskContextPath));
  const missing = await userPromptSubmit(event, { execute });
  assert.equal(missing.decision, "block");
  assert.match(missing.reason, /Context hydration failed/);
  assert.equal(calls.length, 0);
  write(path.join(primary, task.input.taskContextPath), `<!-- corch-task-context:v3 issue=${task.issue} -->\nrestored`);
  const failed = await userPromptSubmit(event, { execute: async () => ({ status: 1, stderr: "Authorization: Bearer fixture-secret-value", stdout: "" }) });
  assert.equal(failed.decision, "block");
  assert.doesNotMatch(failed.reason, /fixture-secret-value/);
  assert.equal(existsSync(path.join(task.cwd, ".agents/task-state/worktree-bootstrap.lock")), false);
  assert.equal(existsSync(path.join(task.cwd, ".agents/task-state/worktree-bootstrap.json")), false);
  assert.equal((await prepareWorktree({ ...task, execute })).status, "ready");
}));

test("failed generation retry does not reinstall successful dependencies", () => fixture(async ({ create, execute, calls }) => {
  const task = create(74);
  await assert.rejects(prepareWorktree({ ...task, execute: (...args) => args[1][1] === "generate"
    ? { status: 1, stderr: "generation failed" } : execute(...args) }), /Setup step generate failed/);
  await prepareWorktree({ ...task, execute });
  assert.deepEqual(calls.map((call) => call.action), ["install", "generate"]);
}));

test("dirty detached, wrong head, claimed branch and duplicate Planner never reset or steal checkout", () => fixture(async ({ primary, create, execute, calls }) => {
  const dirty = create(75);
  write(path.join(dirty.cwd, "user-change.txt"), "preserve me");
  await assert.rejects(prepareWorktree({ ...dirty, execute }), /Cannot safely attach/);
  assert.equal(readFileSync(path.join(dirty.cwd, "user-change.txt"), "utf8"), "preserve me");
  const wrong = create(76);
  git(wrong.cwd, "commit", "--allow-empty", "-m", "different head");
  await assert.rejects(prepareWorktree({ ...wrong, execute }), /Cannot safely attach/);
  const claimed = create(77);
  git(primary, "switch", claimed.branch);
  await assert.rejects(prepareWorktree({ ...claimed, execute }), /already|used by|checked out/);
  assert.equal(calls.length, 0);
  const duplicate = create(78);
  await prepareWorktree({ ...duplicate, execute });
  await assert.rejects(prepareWorktree({ ...duplicate, sessionId: "other-planner", execute }), /another active Planner/);
}));

test("mismatched or unsupported staged state blocks; SessionStart remains read-only", () => fixture(async ({ primary, create, execute, calls }) => {
  const task = create(79);
  await assert.rejects(prepareWorktree({ ...task, launch: { ...task.launch, branch: "codex/task-79-other" }, execute }), /Launch identity/);
  const stateDir = path.join(task.cwd, ".agents/task-state");
  rmSync(stateDir, { recursive: true });
  const session = JSON.parse(command(task.cwd, process.execPath, [path.join(scripts, "workflow-hook.mjs"), "session-start"], { input: JSON.stringify({ cwd: task.cwd }) }));
  assert.match(session.hookSpecificOutput.additionalContext, /read-only session context/);
  assert.equal(existsSync(stateDir), false);
  write(path.join(primary, `.agents/task-state/${task.issue}.json`), { schemaVersion: "task-state/v1" });
  await assert.rejects(prepareWorktree({ ...task, execute }), /staged delivery-v3 state/);
  assert.equal(calls.length, 0);
}));

test("live setup locks time out without stealing ownership", () => fixture(async ({ create, execute }) => {
  const task = create(80);
  const lock = path.join(task.cwd, ".agents/task-state/worktree-bootstrap.lock");
  write(lock, { pid: process.pid });
  await assert.rejects(prepareWorktree({ ...task, execute, lockTimeoutMs: 30 }), /lock timed out/);
  assert.equal(JSON.parse(readFileSync(lock)).pid, process.pid);
}));

test("success exit codes without dependency artifacts cannot report ready", () => fixture(async ({ create, execute }) => {
  const task = create(81);
  const success = async () => ({ status: 0, stdout: "", stderr: "" });
  await assert.rejects(prepareWorktree({ ...task, execute: success }), /without creating/);
  await assert.rejects(prepareWorktree({ ...task, execute: (...args) => args[1][1] === "install" ? execute(...args) : success() }), /without creating node_modules\/generated.js/);
  const marker = JSON.parse(readFileSync(path.join(task.cwd, ".agents/task-state/worktree-bootstrap.json")));
  assert.equal(marker.steps.generate, undefined);
}));

test("wrong repository and invalid registration block before dependency execution", () => fixture(async ({ primary, create, execute, calls }) => {
  const task = create(82);
  git(primary, "remote", "set-url", "origin", "https://github.com/example/other.git");
  await assert.rejects(prepareWorktree({ ...task, execute }), /Repository origin/);
  assert.equal(git(task.cwd, "branch", "--show-current"), "");
  git(primary, "remote", "set-url", "origin", task.input.deliveryTarget.remoteUrl);
  const statePath = path.join(primary, `.agents/task-state/${task.issue}.json`);
  const state = JSON.parse(readFileSync(statePath));
  delete state.gates;
  write(statePath, state);
  await assert.rejects(prepareWorktree({ ...task, execute }), /Planner registration failed/);
  assert.equal(calls.length, 0);
}));

test("interruption stops command and releases the setup lock for a later retry", () => fixture(async ({ create, execute }) => {
  const task = create(83);
  const interrupted = (...args) => {
    const pending = runSetupCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], { cwd: args[2].cwd });
    const timer = setTimeout(() => process.emit("SIGTERM"), 300);
    return pending.finally(() => clearTimeout(timer));
  };
  await assert.rejects(prepareWorktree({ ...task, execute: interrupted }), /Bootstrap interrupted/);
  assert.equal(existsSync(path.join(task.cwd, ".agents/task-state/worktree-bootstrap.lock")), false);
  assert.equal((await prepareWorktree({ ...task, execute })).status, "ready");
}));

test("timed-out setup kills its child process tree", async () => {
  const result = await runSetupCommand(process.execPath, ["-e", "const {spawn}=require('node:child_process');const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(process.pid,p.pid);setInterval(()=>{},1000)"], { timeoutMs: 800 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /timed out/);
  const pids = result.stdout.trim().split(/\s+/).map(Number);
  assert.equal(pids.length, 2);
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), /ESRCH/);
});
