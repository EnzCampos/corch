import { CONFIG } from "../.agents/skills/corch-development-workflow/scripts/lib/workflow-config.mjs";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createExecutionRoute } from "../.agents/skills/corch-development-workflow/scripts/lib/runtime-policy.mjs";
import { workItem, delivery } from "./helpers.mjs";
import { runCommand as runSetupCommand } from "../.agents/skills/corch-development-workflow/scripts/lib/command-execution.mjs";
import {
  prepareWorktree,
} from "../.agents/skills/corch-development-workflow/scripts/prepare-worker-worktree.mjs";

const scripts = fileURLToPath(
  new URL(
    "../.agents/skills/corch-development-workflow/scripts/",
    import.meta.url,
  ),
);
function write(target, value) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(
    target,
    typeof value === "string" ? value : JSON.stringify(value),
  );
}
function command(cwd, executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
    ...options,
  });
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
    git(
      primary,
      "remote",
      "add",
      "origin",
      "https://github.com/example/project.git",
    );
    write(
      path.join(primary, ".gitignore"),
      ".agents/task-state/\n.agents/task-context/\nnode_modules/\n",
    );
    write(path.join(primary, "dependencies.lock"), "fixture lock\n");
    write(path.join(primary, "schema.txt"), "fixture schema\n");
    write(path.join(primary, ".agents/workflow.json"), {
      ...CONFIG,
      setup: {
        steps: [
          {
            name: "install",
            command: process.execPath,
            args: ["fixture", "install"],
            inputs: ["dependencies.lock"],
            outputs: ["node_modules/.ready"],
          },
          {
            name: "generate",
            command: process.execPath,
            args: ["fixture", "generate"],
            inputs: ["schema.txt"],
            outputs: ["node_modules/generated.js"],
          },
        ],
      },
    });
    git(primary, "add", ".");
    git(primary, "commit", "-m", "fixture");
    const create = (number) => {
      const issue = `TASK-${number}`;
      const branch = `corch/task-${number}-fixture`;
      const cwd = path.join(root, issue);
      git(primary, "branch", branch);
      git(primary, "worktree", "add", "--detach", cwd, branch);
      const input = { delivery: delivery(issue) };
      write(path.join(primary, ".agents/task-state/" + issue + ".json"), {
        schemaVersion: "task-state/v2", workflowProtocol: "delivery-v3", issueKey: issue,
        tasks: {}, gates: {}, deliveredEvents: {},
        workItem: { revision: 1, ...workItem() }, delivery: { revision: 1, ...input.delivery },
        executionRoute: createExecutionRoute({ issueKey: issue, classification: "bounded", rationale: "A bounded fixture." }),
      });
      return {
        cwd,
        issue,
        branch,
        input,
        issueKey: issue,
        threadId: `planner-${number}`,
      };
    };
    const calls = [];
    const execute = async (_command, args, { cwd }) => {
      calls.push({ cwd, action: args[1] });
      await delay(20);
      if (args[1] === "install")
        write(path.join(cwd, "node_modules/.ready"), "fixture");
      else
        write(
          path.join(cwd, "node_modules/generated.js"),
          "export const generated = true;",
        );
      return { status: 0, stdout: "", stderr: "" };
    };
    await action({ root, primary, create, execute, calls });
  } finally {
    // Only the explicit mkdtemp fixture tree is removed, never a project checkout.
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
}

test("explicit simultaneous preparation attaches different branches and registers one task record before planning", () =>
  fixture(async ({ create, execute, calls }) => {
    const tasks = [create(70), create(93)];
    assert.equal(
      git(tasks[0].cwd, "rev-parse", "HEAD"),
      git(tasks[1].cwd, "rev-parse", "HEAD"),
    );
    assert.equal(git(tasks[0].cwd, "branch", "--show-current"), "");
    const results = await Promise.all(
      tasks.map((task) => prepareWorktree({ ...task, execute })),
    );
    for (const [index, task] of tasks.entries()) {
      assert.equal(results[index].status, "ready");
      assert.equal(git(task.cwd, "branch", "--show-current"), task.branch);
      const state = JSON.parse(
        readFileSync(
          path.join(task.cwd, `.agents/task-state/${task.issue}.json`),
        ),
      );
      assert.equal(state.tasks.planner.threadId, task.threadId);
      assert.equal(state.tasks.planner.kind, "task");
      assert.deepEqual(state.workItem.acceptance, workItem().acceptance);
      const planPath = path.join(
        task.cwd,
        `.agents/task-state/${task.issue}-plan.md`,
      );
      write(planPath, "Existing approved plan");
      await prepareWorktree({ ...task, execute });
      assert.equal(readFileSync(planPath, "utf8"), "Existing approved plan");
    }
    assert.equal(
      calls.length,
      4,
      "one install and generation per checkout, no repeat setup",
    );
  }));

test("Orchestrator prepares the worktree before a Planner exists and registers it afterward", () =>
  fixture(async ({ primary, create, execute, calls }) => {
    const task = create(89);
    const stateScript = path.join(scripts, "task-state.mjs");
    const preparation = { cwd: task.cwd, issueKey: task.issue, execute };
    const result = await prepareWorktree(preparation);
    assert.equal(result.status, "ready");
    assert.deepEqual(result.executedSteps, ["install", "generate"]);
    assert.equal(git(task.cwd, "branch", "--show-current"), task.branch);
    assert.deepEqual(JSON.parse(command(task.cwd, process.execPath,
      [stateScript, "show", "--issue", task.issue])).tasks, {});
    assert.deepEqual((await prepareWorktree(preparation)).executedSteps, []);
    command(task.cwd, process.execPath, [stateScript, "register-task",
      "--issue", task.issue, "--role", "planner", "--kind", "task",
      "--thread", task.threadId, "--worktree", task.cwd,
      "--branch", task.branch, "--host", "local"]);
    const state = JSON.parse(command(task.cwd, process.execPath,
      [stateScript, "show", "--issue", task.issue]));
    assert.equal(state.tasks.planner.threadId, task.threadId);
    assert.equal(state.tasks.planner.hostId, "local");
    assert.equal(state.tasks.planner.worktree, task.cwd);
    assert.deepEqual(JSON.parse(readFileSync(path.join(primary,
      `.agents/task-state/${task.issue}.json`))).tasks, {});
    assert.deepEqual((await prepareWorktree({ ...task, execute })).executedSteps, []);
    assert.equal(calls.length, 2, "startup recovery reuses completed setup");
    await assert.rejects(prepareWorktree(preparation), /another active Planner/);
    assert.equal(calls.length, 2, "pre-creation setup cannot modify an active Planner checkout");
  }));

test("failed preparation before chat creation leaves no Planner and retries completed steps", () =>
  fixture(async ({ create, execute, calls }) => {
    const task = create(88);
    const preparation = { cwd: task.cwd, issueKey: task.issue };
    await assert.rejects(prepareWorktree({ ...preparation,
      execute: (...args) => args[1][1] === "generate"
        ? { status: 1, stderr: "generation failed" }
        : execute(...args),
    }), /Setup step generate failed/);
    const state = JSON.parse(command(task.cwd, process.execPath,
      [path.join(scripts, "task-state.mjs"), "show", "--issue", task.issue]));
    assert.deepEqual(state.tasks, {});
    const result = await prepareWorktree({ ...preparation, execute });
    assert.equal(result.status, "ready");
    assert.deepEqual(result.executedSteps, ["generate"]);
    assert.deepEqual(calls.map((call) => call.action), ["install", "generate"]);
  }));

test("repreparation preserves newer local context over a stale primary record", () =>
  fixture(async ({ primary, create, execute }) => {
    const task = create(90);
    await prepareWorktree({ ...task, execute });
    const localPath = path.join(task.cwd, `.agents/task-state/${task.issue}.json`);
    const local = JSON.parse(readFileSync(localPath));
    local.workItem.revision = 2;
    local.workItem.userDecisions = ["Keep the newer local target"];
    write(localPath, local);
    const primaryPath = path.join(primary, `.agents/task-state/${task.issue}.json`);
    const shared = JSON.parse(readFileSync(primaryPath));
    shared.workItem.outcome = "Stale primary target";
    write(primaryPath, shared);
    await prepareWorktree({ ...task, execute });
    assert.deepEqual(JSON.parse(readFileSync(localPath)), local);
  }));

test("same-worktree environment and explicit setup serialize and reuse dependencies", () =>
  fixture(async ({ create, execute, calls }) => {
    const task = create(71);
    await Promise.all([
      prepareWorktree({ cwd: task.cwd, execute }),
      prepareWorktree({ ...task, execute }),
    ]);
    assert.deepEqual(
      calls.map((call) => call.action),
      ["install", "generate"],
    );
    write(path.join(task.cwd, "schema.txt"), "changed schema");
    await prepareWorktree({ ...task, execute });
    assert.deepEqual(
      calls.map((call) => call.action),
      ["install", "generate", "generate"],
    );
  }));

test("Planner CLI prepares before creation with optional identity and reuses environment setup", () =>
  fixture(async ({ primary, create, execute, calls }) => {
    const task = create(72);
    const script = path.join(scripts, "prepare-worker-worktree.mjs");
    const args = ["--issue", task.issue, "--thread", task.threadId, "--worktree", task.cwd];
    for (const invalid of [
      args.slice(0, 2), args.slice(0, 4), args.slice(2),
      [...args.slice(0, 5), "relative"], [...args, "--issue", task.issue],
      ["--unknown", "value"], [...args, "constructor", "value"],
      [...args.slice(0, 3), "bad\nidentity", ...args.slice(4)],
    ]) {
      const result = spawnSync(process.execPath, [script, ...invalid], { cwd: primary, encoding: "utf8", windowsHide: true });
      assert.equal(result.status, 1, result.stdout);
      assert.equal(result.stdout, "");
    }
    assert.equal(existsSync(path.join(task.cwd, ".agents/task-state")), false);
    await prepareWorktree({ cwd: task.cwd, execute });
    const beforeCreation = JSON.parse(command(primary, process.execPath,
      [script, "--issue", task.issue, "--worktree", task.cwd]));
    assert.equal(beforeCreation.status, "ready");
    assert.deepEqual(beforeCreation.executedSteps, []);
    assert.equal(git(task.cwd, "branch", "--show-current"), task.branch);
    assert.equal(existsSync(path.join(task.cwd, `.agents/task-state/${task.issue}.json`)), false);
    const ready = JSON.parse(command(primary, process.execPath, [script, ...args]));
    assert.equal(ready.status, "ready");
    assert.deepEqual(ready.executedSteps, []);
    assert.equal(calls.length, 2);
    assert.equal(git(task.cwd, "branch", "--show-current"), task.branch);
    const statePath = path.join(task.cwd, `.agents/task-state/${task.issue}.json`);
    const stateBefore = readFileSync(statePath, "utf8");
    assert.equal(JSON.parse(stateBefore).tasks.planner.threadId, task.threadId);
    assert.equal(JSON.parse(command(primary, process.execPath, [script, ...args])).status, "ready");
    assert.equal(readFileSync(statePath, "utf8"), stateBefore);
  }));

test("missing context and install failures block startup, release lock, and do not claim ready", () =>
  fixture(async ({ primary, create, execute, calls }) => {
    const task = create(73);
    const statePath = path.join(primary, ".agents/task-state/" + task.issue + ".json");
    const saved = JSON.parse(readFileSync(statePath));
    const missing = structuredClone(saved);
    delete missing.workItem;
    write(statePath, missing);
    await assert.rejects(prepareWorktree({ ...task, execute }), /requires task context/);
    assert.equal(calls.length, 0);
    write(statePath, saved);
    await assert.rejects(prepareWorktree({ ...task,
      execute: async () => ({
        status: 1,
        stderr: "Authorization: Bearer fixture-secret-value",
        stdout: "",
      }),
    }), (error) => {
      assert.match(error.message, /Setup step install failed/);
      assert.doesNotMatch(error.message, /fixture-secret-value/);
      return true;
    });
    assert.equal(
      existsSync(
        path.join(task.cwd, ".agents/task-state/worktree-bootstrap.lock"),
      ),
      false,
    );
    assert.equal(
      existsSync(
        path.join(task.cwd, ".agents/task-state/worktree-bootstrap.json"),
      ),
      false,
    );
    assert.equal(JSON.parse(readFileSync(path.join(task.cwd, `.agents/task-state/${task.issue}.json`))).tasks.planner.threadId, task.threadId);
    assert.equal((await prepareWorktree({ ...task, execute })).status, "ready");
  }));

test("failed generation retry does not reinstall successful dependencies", () =>
  fixture(async ({ create, execute, calls }) => {
    const task = create(74);
    await assert.rejects(
      prepareWorktree({
        ...task,
        execute: (...args) =>
          args[1][1] === "generate"
            ? { status: 1, stderr: "generation failed" }
            : execute(...args),
      }),
      /Setup step generate failed/,
    );
    await prepareWorktree({ ...task, execute });
    assert.deepEqual(
      calls.map((call) => call.action),
      ["install", "generate"],
    );
  }));

test("dirty detached, wrong head, claimed branch and duplicate Planner never reset or steal checkout", () =>
  fixture(async ({ primary, create, execute, calls }) => {
    const dirty = create(75);
    write(path.join(dirty.cwd, "user-change.txt"), "preserve me");
    await assert.rejects(
      prepareWorktree({ cwd: dirty.cwd, issueKey: dirty.issue, execute }),
      /Cannot safely attach/,
    );
    assert.equal(
      readFileSync(path.join(dirty.cwd, "user-change.txt"), "utf8"),
      "preserve me",
    );
    const wrong = create(76);
    git(wrong.cwd, "commit", "--allow-empty", "-m", "different head");
    await assert.rejects(
      prepareWorktree({ ...wrong, execute }),
      /Cannot safely attach/,
    );
    const claimed = create(77);
    git(primary, "switch", claimed.branch);
    await assert.rejects(
      prepareWorktree({ ...claimed, execute }),
      /already|used by|checked out/,
    );
    assert.equal(calls.length, 0);
    const duplicate = create(78);
    await prepareWorktree({ ...duplicate, execute });
    await assert.rejects(
      prepareWorktree({ ...duplicate, threadId: "other-planner", execute }),
      /another active Planner/,
    );
  }));

test("mismatched or unsupported staged identity blocks explicit preparation", () =>
  fixture(async ({ primary, create, execute, calls }) => {
    const task = create(79);
    const statePath = path.join(primary, ".agents/task-state/" + task.issue + ".json");
    const saved = JSON.parse(readFileSync(statePath));
    saved.delivery.headBranch = "corch/task-179-fixture";
    write(statePath, saved);
    await assert.rejects(prepareWorktree({ ...task, execute }), /delivery identity/);
    assert.equal(git(task.cwd, "branch", "--show-current"), "");
    write(statePath, { schemaVersion: "task-state/v1" });
    await assert.rejects(prepareWorktree({ ...task, execute }), /schema or issue identity/);
    assert.equal(calls.length, 0);
  }));

test("live setup locks time out without stealing ownership", () =>
  fixture(async ({ create, execute }) => {
    const task = create(80);
    const lock = path.join(
      task.cwd,
      ".agents/task-state/worktree-bootstrap.lock",
    );
    write(lock, { pid: process.pid });
    await assert.rejects(
      prepareWorktree({ ...task, execute, lockTimeoutMs: 30 }),
      /lock timed out/,
    );
    assert.equal(JSON.parse(readFileSync(lock)).pid, process.pid);
  }));

test("success exit codes without dependency artifacts cannot report ready", () =>
  fixture(async ({ create, execute }) => {
    const task = create(81);
    const success = async () => ({ status: 0, stdout: "", stderr: "" });
    await assert.rejects(
      prepareWorktree({ ...task, execute: success }),
      /without creating/,
    );
    await assert.rejects(
      prepareWorktree({
        ...task,
        execute: (...args) =>
          args[1][1] === "install" ? execute(...args) : success(),
      }),
      /without creating node_modules\/generated.js/,
    );
    const marker = JSON.parse(
      readFileSync(
        path.join(task.cwd, ".agents/task-state/worktree-bootstrap.json"),
      ),
    );
    assert.equal(marker.steps.generate, undefined);
  }));

test("wrong repository and invalid registration block before dependency execution", () =>
  fixture(async ({ primary, create, execute, calls }) => {
    const task = create(82);
    git(
      primary,
      "remote",
      "set-url",
      "origin",
      "https://github.com/example/other.git",
    );
    await assert.rejects(
      prepareWorktree({ ...task, execute }),
      /Repository origin/,
    );
    assert.equal(git(task.cwd, "branch", "--show-current"), "");
    git(
      primary,
      "remote",
      "set-url",
      "origin",
      task.input.delivery.remoteUrl,
    );
    const statePath = path.join(
      primary,
      `.agents/task-state/${task.issue}.json`,
    );
    const state = JSON.parse(readFileSync(statePath));
    delete state.gates;
    write(statePath, state);
    await assert.rejects(
      prepareWorktree({ ...task, execute }),
      /task-state is incomplete/,
    );
    assert.equal(calls.length, 0);
  }));

test("interruption stops command and releases the setup lock for a later retry", () =>
  fixture(async ({ create, execute }) => {
    const task = create(83);
    const interrupted = (...args) => {
      const pending = runSetupCommand(
        process.execPath,
        ["-e", "setInterval(()=>{},1000)"],
        { cwd: args[2].cwd },
      );
      const timer = setTimeout(() => process.emit("SIGTERM"), 300);
      return pending.finally(() => clearTimeout(timer));
    };
    await assert.rejects(
      prepareWorktree({ ...task, execute: interrupted }),
      /Command interrupted/,
    );
    assert.equal(
      existsSync(
        path.join(task.cwd, ".agents/task-state/worktree-bootstrap.lock"),
      ),
      false,
    );
    assert.equal((await prepareWorktree({ ...task, execute })).status, "ready");
  }));

test("timed-out setup kills its child process tree", async () => {
  const result = await runSetupCommand(
    process.execPath,
    [
      "-e",
      "const {spawn}=require('node:child_process');const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(process.pid,p.pid);setInterval(()=>{},1000)",
    ],
    { timeoutMs: 800 },
  );
  assert.ok(result.status !== 0 || result.error);
  assert.match(result.stderr, /timed out/);
  const pids = result.stdout.trim().split(/\s+/).map(Number);
  assert.equal(pids.length, 2);
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), /ESRCH/);
});
