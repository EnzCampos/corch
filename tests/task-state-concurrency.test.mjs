import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createExecutionRoute } from "../.agents/skills/corch-development-workflow/scripts/lib/runtime-policy.mjs";
import { workItem } from "./helpers.mjs";

const script = fileURLToPath(
  new URL(
    "../.agents/skills/corch-development-workflow/scripts/task-state.mjs",
    import.meta.url,
  ),
);
const issue = "TASK-42";
const stateRelative = `.agents/task-state/${issue}.json`;
const sha = "a".repeat(40);

// Test-only interception controls the interleaving of real CLI subprocesses.
// On the old implementation the second writer reaches read; with locking it waits.
const preloadSource = String.raw`
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const read = fs.readFileSync;
const open = fs.openSync;
const rename = fs.renameSync;
let waiting = false;
fs.openSync = function(file, flags, ...args) {
  try { return open.call(this, file, flags, ...args); }
  catch (error) {
    if (String(file) === process.env.CORCH_TEST_LOCK && error.code === 'EEXIST' && !waiting) {
      waiting = true;
      process.send?.('waiting');
    }
    throw error;
  }
};
fs.readFileSync = function(file, ...args) {
  const value = read.call(this, file, ...args);
  if (String(file) === process.env.CORCH_TEST_READ) {
    process.send?.('read');
    if (process.env.CORCH_TEST_RELEASE) {
      const deadline = Date.now() + 10000;
      while (!fs.existsSync(process.env.CORCH_TEST_RELEASE)) {
        if (Date.now() > deadline) throw new Error('test barrier timed out');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    if (process.env.CORCH_TEST_REPLACE_OWNER) {
      fs.writeFileSync(process.env.CORCH_TEST_LOCK, JSON.stringify({pid:process.pid, token:'replacement'}));
    }
  }
  return value;
};
fs.renameSync = function(from, to) {
  if (String(to) === process.env.CORCH_TEST_FAIL_WRITE) {
    throw new Error('injected state write failure');
  }
  return rename.call(this, from, to);
};
syncBuiltinESMExports();
`;

async function fixture(action) {
  const root = mkdtempSync(path.join(os.tmpdir(), "corch-state-concurrency-"));
  const children = new Set();
  const command = (cwd, executable, args) =>
    spawnSync(executable, args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    });
  const git = (...args) => {
    const result = command(root, "git", args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git("init", "--quiet", "-b", "main");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.test");
    writeFileSync(path.join(root, ".gitignore"), ".agents/task-state/\n");
    git("add", ".gitignore");
    git("commit", "--quiet", "-m", "fixture");
    const statePath = path.join(root, stateRelative);
    const lockPath = `${statePath}.lock`;
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({
        schemaVersion: "task-state/v2",
        workflowProtocol: "delivery-v3",
        issueKey: issue,
        tasks: Object.fromEntries(
          ["worker", "reviewer", "tester"].map((role) => [
            role,
            { threadId: role, worktree: root, branch: "main", retired: false },
          ]),
        ),
        gates: {},
        deliveredEvents: {},
      }),
    );
    const preload = path.join(path.dirname(statePath), "barrier.cjs");
    writeFileSync(preload, preloadSource);
    const invoke = (args, cwd = root) =>
      command(cwd, process.execPath, [script, ...args]);
    const start = (
      args,
      {
        cwd = root,
        readPath = statePath,
        release,
        failWrite,
        replaceOwner,
        input,
      } = {},
    ) => {
      const child = fork(script, args, {
        cwd,
        silent: true,
        windowsHide: true,
        execArgv: ["--require", preload],
        env: {
          ...process.env,
          CORCH_TEST_READ: readPath,
          CORCH_TEST_LOCK: `${path.join(cwd, stateRelative)}.lock`,
          CORCH_TEST_RELEASE: release || "",
          CORCH_TEST_FAIL_WRITE: failWrite || "",
          CORCH_TEST_REPLACE_OWNER: replaceOwner ? "1" : "",
        },
      });
      const messages = [];
      if (input !== undefined) child.stdin.end(JSON.stringify(input));
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("message", (message) => messages.push(message));
      child.on("error", (error) => {
        stderr += error.message;
      });
      const timeout = setTimeout(() => child.kill(), 15_000);
      const controller = {
        child,
        finished: new Promise((resolve) =>
          child.once("close", (code) => {
            clearTimeout(timeout);
            children.delete(controller);
            resolve({ code, stdout, stderr });
          }),
        ),
        waitFor: (...events) => {
          const found = messages.find((message) => events.includes(message));
          if (found) return Promise.resolve(found);
          return new Promise((resolve, reject) => {
            const finish = (error, value) => {
              clearTimeout(timer);
              child.removeListener("message", onMessage);
              child.removeListener("close", onClose);
              if (error) reject(error);
              else resolve(value);
            };
            const onMessage = (message) => {
              if (events.includes(message)) finish(undefined, message);
            };
            const onClose = () =>
              finish(new Error(`CLI exited before ${events}: ${stderr}`));
            const timer = setTimeout(
              () => finish(new Error(`No ${events} message`)),
              8_000,
            );
            child.on("message", onMessage);
            child.once("close", onClose);
          });
        },
      };
      children.add(controller);
      return controller;
    };
    const compete = async (firstArgs, secondArgs, options = {}) => {
      const release = path.join(root, "release");
      const first = start(firstArgs, {
        ...options,
        release,
        input: options.firstInput,
      });
      await first.waitFor("read");
      const second = start(secondArgs, {
        ...options,
        input: options.secondInput,
      });
      const reached = await second.waitFor("waiting", "read");
      // If serialization regresses, let the competing stale write finish first.
      if (reached === "read") await second.finished;
      writeFileSync(release, "release");
      return Promise.all([first.finished, second.finished]);
    };
    await action({ root, statePath, lockPath, git, invoke, start, compete });
  } finally {
    for (const controller of children) controller.child.kill();
    await Promise.all([...children].map((controller) => controller.finished));
    // root is the absolute fixture directory created above, never a project checkout.
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
}

const event = (name, target = "worker") => [
  "record-event",
  "--issue",
  issue,
  "--event",
  `task-42:${name}`,
  "--target",
  target,
];

test("concurrent context revisions preserve the winning user decision and reject stale overwrite", () =>
  fixture(async ({ statePath, compete }) => {
    const args = [
      "record-context",
      "--issue",
      issue,
      "--expected-revision",
      "0",
    ];
    const firstInput = workItem({ userDecisions: ["First explicit decision"] });
    const secondInput = workItem({
      userDecisions: ["Conflicting stale decision"],
    });
    const results = await compete(args, args, { firstInput, secondInput });
    assert.deepEqual(
      results.map((result) => result.code),
      [0, 1],
    );
    assert.match(results[1].stderr, /stale workItem revision/);
    assert.deepEqual(JSON.parse(readFileSync(statePath)).workItem, {
      revision: 1,
      ...firstInput,
    });
  }));

test("concurrent checkout gate acquisitions have exactly one winner", () =>
  fixture(async ({ root, statePath, lockPath, compete, git }) => {
    const gate = (name, role) => [
      "begin-gate",
      "--issue",
      issue,
      "--gate",
      name,
      "--thread",
      role,
      "--worktree",
      root,
      "--sha",
      git("rev-parse", "HEAD"),
    ];
    const results = await compete(
      gate("review", "reviewer"),
      gate("test", "tester"),
    );
    assert.deepEqual(
      results.map((result) => result.code),
      [0, 1],
    );
    assert.match(results[1].stderr, /another checkout gate is already active/);
    assert.equal(
      JSON.parse(readFileSync(statePath)).activeCheckoutGate.role,
      "reviewer",
    );
    assert.equal(existsSync(lockPath), false);
  }));

test("concurrent distinct events survive without lost updates", () =>
  fixture(async ({ statePath, compete }) => {
    const results = await compete(event("first"), event("second"));
    assert.deepEqual(
      results.map((result) => result.code),
      [0, 0],
    );
    assert.deepEqual(JSON.parse(readFileSync(statePath)).deliveredEvents, {
      "task-42:first": "worker",
      "task-42:second": "worker",
    });
  }));

test("concurrent escalations reject a stale competitor and deduplicate identical retries", () =>
  fixture(async ({ statePath, compete }) => {
    const initial = JSON.parse(readFileSync(statePath));
    initial.tasks.worker.branch = "main";
    initial.executionRoute = createExecutionRoute({
      issueKey: issue,
      classification: "bounded",
      rationale: "Initial bounded work.",
    });
    const request = (classification) => [
      "escalate-route",
      "--issue",
      issue,
      "--expected-revision",
      "1",
      "--classification",
      classification,
      "--signal",
      "heavyValidation",
      "--rationale",
      "Controlled evidence requires stronger execution.",
    ];
    for (const duplicate of [false, true]) {
      writeFileSync(statePath, JSON.stringify(initial));
      // Each controlled interleaving needs its own barrier file.
      const release = path.join(
        path.dirname(path.dirname(path.dirname(statePath))),
        "release",
      );
      rmSync(release, { force: true });
      const results = await compete(
        request("complex"),
        request(duplicate ? "complex" : "high-risk"),
      );
      assert.deepEqual(
        results.map((result) => result.code),
        duplicate ? [0, 0] : [0, 1],
      );
      if (duplicate)
        assert.equal(JSON.parse(results[1].stdout).status, "already-recorded");
      else assert.match(results[1].stderr, /stale execution route revision/);
      const saved = JSON.parse(readFileSync(statePath));
      assert.equal(saved.executionRouteRevision, 2);
      assert.deepEqual(saved.executionRouteHistory, [
        { revision: 1, route: initial.executionRoute },
      ]);
      assert.equal(saved.executionRoute.classification, "complex");
    }
  }));

test("concurrent fresh claims register only the lease winner", () =>
  fixture(async ({ root, statePath, git, compete }) => {
    const initial = JSON.parse(readFileSync(statePath));
    initial.tasks = { worker: { ...initial.tasks.worker, branch: "main" } };
    writeFileSync(statePath, JSON.stringify(initial));
    const currentSha = git("rev-parse", "HEAD");
    const claim = (gate, id) => [
      "claim-gate",
      "--issue",
      issue,
      "--gate",
      gate,
      "--thread",
      id,
      "--worktree",
      root,
      "--sha",
      currentSha,
    ];
    const results = await compete(
      claim("review", "review-first"),
      claim("test", "test-second"),
    );
    assert.deepEqual(
      results.map((result) => result.code),
      [0, 1],
    );
    const saved = JSON.parse(readFileSync(statePath));
    assert.equal(saved.tasks.reviewer.threadId, "review-first");
    assert.equal(saved.tasks.tester, undefined);
    assert.equal(saved.activeCheckoutGate.threadId, "review-first");
  }));

test("concurrent duplicate events retain idempotent results", () =>
  fixture(async ({ compete }) => {
    const results = await compete(event("same"), event("same"));
    assert.deepEqual(
      results.map((result) => result.code),
      [0, 0],
    );
    assert.deepEqual(
      results.map((result) => JSON.parse(result.stdout).status),
      ["recorded", "already-recorded"],
    );
  }));

test("concurrent conflicting registrations cannot replace the winner", () =>
  fixture(async ({ statePath, compete }) => {
    const state = JSON.parse(readFileSync(statePath));
    delete state.tasks.worker;
    writeFileSync(statePath, JSON.stringify(state));
    const register = (id) => [
      "register-task",
      "--issue",
      issue,
      "--role",
      "worker",
      "--thread",
      id,
    ];
    const results = await compete(
      register("first-worker"),
      register("second-worker"),
    );
    assert.deepEqual(
      results.map((result) => result.code),
      [0, 1],
    );
    assert.match(results[1].stderr, /another active task/);
    assert.equal(
      JSON.parse(readFileSync(statePath)).tasks.worker.threadId,
      "first-worker",
    );
  }));

test("first concurrent linked-worktree mutations reread the newly local state", () =>
  fixture(async ({ root, statePath, git, compete }) => {
    const checkout = path.join(root, "linked");
    git("worktree", "add", "--quiet", "-b", "corch/task-42-lock", checkout);
    const results = await compete(event("first"), event("second"), {
      cwd: checkout,
    });
    assert.deepEqual(
      results.map((result) => result.code),
      [0, 0],
    );
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(checkout, stateRelative)))
        .deliveredEvents,
      {
        "task-42:first": "worker",
        "task-42:second": "worker",
      },
    );
    assert.deepEqual(JSON.parse(readFileSync(statePath)).deliveredEvents, {});
  }));

test("a live task-state lock times out without blocking show or being stolen", () =>
  fixture(async ({ statePath, lockPath, invoke }) => {
    const owner = { pid: process.pid, token: "live-owner" };
    writeFileSync(lockPath, JSON.stringify(owner));
    const before = readFileSync(statePath, "utf8");
    assert.equal(invoke(["show", "--issue", issue]).status, 0);
    assert.equal(
      invoke([
        "record-event",
        "--issue",
        "TASK-43",
        "--event",
        "task-43:independent",
        "--target",
        "worker",
      ]).status,
      0,
    );
    const result = invoke(event("blocked"));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /timed out after 5 seconds/);
    assert.deepEqual(JSON.parse(readFileSync(lockPath)), owner);
    assert.equal(readFileSync(statePath, "utf8"), before);
  }));

test("stale and unverifiable task-state locks require explicit recovery", () =>
  fixture(async ({ lockPath, invoke }) => {
    const exited = spawnSync(process.execPath, ["-e", ""], {
      windowsHide: true,
    });
    assert.equal(exited.status, 0);
    assert.throws(() => process.kill(exited.pid, 0), /ESRCH/);
    for (const owner of [
      { pid: exited.pid, token: "stale-owner" },
      { pid: 0, token: "invalid" },
    ]) {
      writeFileSync(lockPath, JSON.stringify(owner));
      const result = invoke(event("blocked"));
      assert.equal(result.status, 1);
      assert.match(result.stderr, /stale owner|ownership cannot be verified/);
      assert.match(
        result.stderr,
        /Verify that no task-state writer is running/,
      );
      assert.deepEqual(JSON.parse(readFileSync(lockPath)), owner);
    }
    writeFileSync(lockPath, "{");
    const malformed = invoke(event("malformed-lock"));
    assert.equal(malformed.status, 1);
    assert.match(
      malformed.stderr,
      /ownership cannot be verified after 5 seconds/,
    );
    assert.equal(readFileSync(lockPath, "utf8"), "{");
  }));

test("task-state validation and write failures release only their own lock", () =>
  fixture(async ({ statePath, lockPath, invoke, start }) => {
    const before = readFileSync(statePath, "utf8");
    writeFileSync(statePath, "{}");
    assert.equal(invoke(event("invalid")).status, 1);
    assert.equal(existsSync(lockPath), false);
    writeFileSync(statePath, before);
    const failure = await start(event("failed-write"), { failWrite: statePath })
      .finished;
    assert.equal(failure.code, 1);
    assert.match(failure.stderr, /injected state write failure/);
    assert.equal(readFileSync(statePath, "utf8"), before);
    assert.equal(existsSync(lockPath), false);
    assert.equal(
      readdirSync(path.dirname(statePath)).some((name) =>
        name.endsWith(".tmp"),
      ),
      false,
    );
    const replaced = await start(event("replaced-owner"), {
      replaceOwner: true,
    }).finished;
    assert.equal(replaced.code, 1);
    assert.match(replaced.stderr, /ownership changed before release/);
    assert.equal(JSON.parse(readFileSync(lockPath)).token, "replacement");
  }));
