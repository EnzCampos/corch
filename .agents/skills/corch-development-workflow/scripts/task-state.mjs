#!/usr/bin/env node
import {
  CONFIG,
  ISSUE_PATTERN,
  REPOSITORY,
  REMOTE_URL,
  BASE_BRANCH,
  issueFromBranch,
} from "./lib/workflow-config.mjs";

import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  ROUTE_LEVELS,
  validateRouteState,
  createExecutionRoute,
  resolveRuntime,
  runtimeArguments,
} from "./lib/runtime-policy.mjs";

import {
  WorkflowValidationError,
  parseJsonDocument,
  redactText,
  plainObject,
  nonEmptyString,
  isSourceRef,
  isHttpsUrl,
  detectUnsafeText,
  containedPath,
} from "./lib/validation.mjs";
const TASK_STATE_SCHEMA = "task-state/v2";
const WORKFLOW_PROTOCOL = "delivery-v3";
const MARKDOWN_PLAN_SCHEMA = "implementation-plan/v4";

function gitValue(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 15_000,
  });
  if (result.status !== 0)
    throw new Error(result.stderr?.trim() || `git ${args[0]} failed`);
  return result.stdout.trim();
}

function sameCheckout(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    path.isAbsolute(left) &&
    path.isAbsolute(right) &&
    realpathSync(left) === realpathSync(right)
  );
}

function verifyWorkerCheckout(state, worktree, sha) {
  const worker = state.tasks?.worker;
  if (
    !worker?.threadId ||
    worker.retired ||
    !sameCheckout(worker.worktree, worktree)
  ) {
    throw new Error(
      "an active Worker with the matching registered checkout is required",
    );
  }
  if (
    !sameCheckout(
      gitValue(worktree, ["rev-parse", "--show-toplevel"]),
      worktree,
    ) ||
    !worker.branch ||
    worker.branch !== gitValue(worktree, ["branch", "--show-current"])
  ) {
    throw new Error(
      "Worker checkout root or branch does not match registration",
    );
  }
  if (sha && gitValue(worktree, ["rev-parse", "HEAD"]) !== sha)
    throw new Error("Worker checkout commit does not match requested commit");
  return worker;
}

const ROLE_PATTERN = /^(worker|planner|reviewer|tester)$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const EVENT_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,199}$/;
const STATE_LOCK_TIMEOUT_MS = 5_000;
const STATE_LOCK_RETRY_MS = 50;

function usage() {
  return `Maintain ignored task-family identity and event-deduplication state.

Usage:
  node task-state.mjs show --issue TASK-N
  node task-state.mjs register-task --issue TASK-N --role worker|planner|reviewer|tester --thread <id> [--host <id>] [--worktree <absolute-path>] [--branch <name>] [--pr N]
  node task-state.mjs record-route --issue TASK-N --classification bounded|routine|standard|complex|high-risk|exceptional --rationale <text> [--signal <name>]...
  node task-state.mjs record-context --issue TASK-N --expected-revision N
  node task-state.mjs record-delivery --issue TASK-N --expected-revision N
  node task-state.mjs runtime --issue TASK-N --role planner|worker|reviewer|tester
  node task-state.mjs escalate-route --issue TASK-N --expected-revision N --classification standard|complex|high-risk|exceptional --signal <name> --rationale <evidence>
  node task-state.mjs record-plan --issue TASK-N --revision 1 --path .agents/task-state/TASK-N-plan.md
  node task-state.mjs record-event --issue TASK-N --event <stable-key> --target <thread-id>
  node task-state.mjs record-gate --issue TASK-N --gate review|test --sha <40-hex> --result <path>
  node task-state.mjs begin-gate --issue TASK-N --gate review|test --thread <id> --worktree <absolute-path> --sha <40-hex>
  node task-state.mjs end-gate --issue TASK-N --gate review|test --thread <id>
  node task-state.mjs claim-gate --issue TASK-N --gate review|test --thread <thread-id> --worktree <absolute-worker-checkout> --sha <40-hex>
  node task-state.mjs retire-task --issue TASK-N --role worker|planner|reviewer|tester --thread <id>

Planner registration requires --kind task and identifies a visible Codex task.
record-context and record-delivery read one JSON object from standard input.
Use the host shell's stdin syntax or a subprocess input API to supply it.
Replace placeholders and choose one value from each pipe-separated option.

register-task and record-event return already-recorded for identical entries and
fail on conflicting identity. Before retrying an ambiguous app operation, the
coordinator must still inspect live tasks or messages; this file is not live UI state.`;
}

function parseArguments(argv) {
  if (argv[0] === "--help" || argv[0] === "-h") {
    return { help: true };
  }
  const args = { command: argv[0], riskSignals: [] };
  for (let index = 1; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--help" || current === "-h") {
      args.help = true;
    } else if (current === "--issue") {
      args.issueKey = argv[++index];
    } else if (current === "--role") {
      args.role = argv[++index];
    } else if (current === "--thread") {
      args.threadId = argv[++index];
    } else if (current === "--kind") {
      args.kind = argv[++index];
    } else if (current === "--host") {
      args.hostId = argv[++index];
    } else if (current === "--worktree") {
      args.worktree = argv[++index];
    } else if (current === "--branch") {
      args.branch = argv[++index];
    } else if (current === "--pr") {
      args.pullRequestNumber = Number(argv[++index]);
    } else if (current === "--classification") {
      args.classification = argv[++index];
    } else if (current === "--expected-revision") {
      args.expectedRevision = Number(argv[++index]);
    } else if (current === "--rationale") {
      args.rationale = argv[++index];
    } else if (current === "--signal") {
      args.riskSignals.push(argv[++index]);
    } else if (current === "--event") {
      args.eventKey = argv[++index];
    } else if (current === "--target") {
      args.targetThreadId = argv[++index];
    } else if (current === "--gate") {
      args.gate = argv[++index];
    } else if (current === "--sha") {
      args.observedSha = argv[++index];
    } else if (current === "--result") {
      args.resultPath = argv[++index];
    } else if (current === "--revision") {
      args.contextRevision = Number(argv[++index]);
    } else if (current === "--path") {
      const suppliedPath = argv[++index];
      if (args.command === "record-plan") {
        args.planPath = suppliedPath;
      } else {
        args.contextPath = suppliedPath;
      }
    } else {
      throw new WorkflowValidationError([`unknown argument: ${current}`]);
    }
  }
  if (args.help) {
    return args;
  }
  if (
    !new Set([
      "show",
      "runtime",
      "record-delivery",
      "register-task",
      "record-route",
      "escalate-route",
      "claim-gate",
      "record-context",
      "record-plan",
      "record-event",
      "record-gate",
      "begin-gate",
      "end-gate",
      "retire-task",
    ]).has(args.command)
  ) {
    throw new WorkflowValidationError([
      "select show, register-task, record-route, escalate-route, record-context, record-plan, record-event, record-gate, claim-gate, begin-gate, end-gate, or retire-task",
    ]);
  }
  if (!ISSUE_PATTERN.test(args.issueKey ?? "")) {
    throw new WorkflowValidationError([
      "--issue must match the configured issue prefix and a positive number",
    ]);
  }
  if (new Set(["register-task", "retire-task"]).has(args.command)) {
    if (!ROLE_PATTERN.test(args.role ?? "") || !args.threadId) {
      throw new WorkflowValidationError([
        "task operations require --role and --thread",
      ]);
    }
  }
  if (
    ["record-route", "escalate-route"].includes(args.command) &&
    (!args.classification || !args.rationale)
  ) {
    throw new WorkflowValidationError([
      `${args.command} requires --classification and --rationale`,
    ]);
  }
  if (
    args.command === "escalate-route" &&
    (!Number.isSafeInteger(args.expectedRevision) ||
      args.expectedRevision < 1 ||
      args.riskSignals.length === 0)
  ) {
    throw new WorkflowValidationError([
      "escalate-route requires a positive --expected-revision and concrete --signal evidence with --rationale",
    ]);
  }
  if (
    ["record-context", "record-delivery"].includes(args.command) &&
    (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0)
  ) {
    throw new WorkflowValidationError([
      "record-context/record-delivery require a nonnegative --expected-revision",
    ]);
  }
  if (args.command === "runtime" && !ROLE_PATTERN.test(args.role ?? "")) {
    throw new WorkflowValidationError(["runtime requires a role"]);
  }
  if (
    args.kind !== undefined &&
    (args.command !== "register-task" ||
      args.role !== "planner" ||
      args.kind !== "task")
  ) {
    throw new WorkflowValidationError([
      "--kind task applies only to Planner registration",
    ]);
  }
  if (
    args.command === "register-task" &&
    args.role === "planner" &&
    args.kind !== "task"
  ) {
    throw new WorkflowValidationError([
      "Planner registration requires --kind task",
    ]);
  }
  if (
    args.command === "record-plan" &&
    args.planPath !== `.agents/task-state/${args.issueKey}-plan.md`
  ) {
    throw new WorkflowValidationError([
      "record-plan requires the issue-local ignored plan --path",
    ]);
  }
  if (
    args.command === "record-event" &&
    (!EVENT_PATTERN.test(args.eventKey ?? "") || !args.targetThreadId)
  ) {
    throw new WorkflowValidationError([
      "record-event requires a stable --event and --target",
    ]);
  }
  if (args.command === "record-gate") {
    if (
      !new Set(["review", "test"]).has(args.gate) ||
      !SHA_PATTERN.test(args.observedSha ?? "") ||
      !args.resultPath
    ) {
      throw new WorkflowValidationError([
        "record-gate requires --gate, --sha, and --result",
      ]);
    }
  }
  if (
    new Set(["claim-gate", "begin-gate", "end-gate"]).has(args.command) &&
    (!new Set(["review", "test"]).has(args.gate) || !args.threadId)
  ) {
    throw new WorkflowValidationError([
      "checkout gate operations require --gate and --thread",
    ]);
  }
  if (
    args.command === "claim-gate" &&
    !/^[a-zA-Z0-9_-]{1,128}$/.test(args.threadId ?? "")
  ) {
    throw new WorkflowValidationError([
      "claim-gate requires a valid --thread ID",
    ]);
  }
  if (
    ["claim-gate", "begin-gate"].includes(args.command) &&
    (!SHA_PATTERN.test(args.observedSha ?? "") || !args.worktree)
  ) {
    throw new WorkflowValidationError([
      `${args.command} requires --worktree and --sha`,
    ]);
  }
  if (args.worktree !== undefined && !path.isAbsolute(args.worktree)) {
    throw new WorkflowValidationError(["--worktree must be absolute"]);
  }
  if (
    args.pullRequestNumber !== undefined &&
    (!Number.isInteger(args.pullRequestNumber) || args.pullRequestNumber < 1)
  ) {
    throw new WorkflowValidationError(["--pr must be a positive integer"]);
  }
  return args;
}

function repositoryRoot(cwd = process.cwd()) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new WorkflowValidationError(["task-state requires a Git repository"]);
  }
  return result.stdout.trim();
}

function taskStateRoot(checkoutRoot) {
  const result = spawnSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    {
      cwd: checkoutRoot,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    throw new WorkflowValidationError([
      "task-state cannot resolve the shared Git directory",
    ]);
  }
  return path.dirname(path.resolve(checkoutRoot, result.stdout.trim()));
}

function isLinkedWorktree(checkoutRoot) {
  const gitDirectory = spawnSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-dir"],
    {
      cwd: checkoutRoot,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    },
  );
  const commonDirectory = spawnSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    {
      cwd: checkoutRoot,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    },
  );
  if (gitDirectory.status !== 0 || commonDirectory.status !== 0) {
    throw new WorkflowValidationError([
      "task-state cannot resolve worktree identity",
    ]);
  }
  return (
    path.resolve(gitDirectory.stdout.trim()) !==
    path.resolve(commonDirectory.stdout.trim())
  );
}

function emptyState(issueKey) {
  return {
    schemaVersion: TASK_STATE_SCHEMA,
    workflowProtocol: WORKFLOW_PROTOCOL,
    issueKey,
    tasks: {},
    gates: {},
    deliveredEvents: {},
  };
}

function validateState(value, issueKey) {
  if (
    value.schemaVersion !== TASK_STATE_SCHEMA ||
    value.issueKey !== issueKey
  ) {
    throw new WorkflowValidationError([
      "task-state schema or issue identity is invalid",
    ]);
  }
  if (![value.tasks, value.gates, value.deliveredEvents].every(plainObject)) {
    throw new WorkflowValidationError(["task-state is incomplete"]);
  }
  if (value.executionRoute !== undefined) {
    validateRouteState(value);
  } else if (
    value.executionRouteRevision !== undefined ||
    value.executionRouteHistory !== undefined
  ) {
    throw new WorkflowValidationError([
      "route metadata requires an execution route",
    ]);
  }
  if (value.implementationPlan !== undefined) {
    validatePlanReference(value.implementationPlan, issueKey);
  }
  for (const field of ["workItem", "delivery"]) {
    if (value[field] !== undefined) {
      const { revision, ...record } = value[field];
      if (!Number.isSafeInteger(revision) || revision < 1)
        throw new Error("invalid " + field + " revision");
      if (field === "workItem") validateWorkItem(record);
      else validateDelivery(record, issueKey);
    }
  }
  if (value.tasks.planner && value.tasks.planner.kind !== "task") {
    throw new WorkflowValidationError([
      "Planner identity must be a visible task",
    ]);
  }
  if (value.workflowProtocol !== WORKFLOW_PROTOCOL) {
    throw new WorkflowValidationError([
      "task-state workflow protocol is invalid",
    ]);
  }
  return value;
}

function stateLocation(root, issueKey) {
  const directory = path.join(root, ".agents", "task-state");
  if (!existsSync(directory)) {
    containedPath(root, ".agents/task-state");
    mkdirSync(directory, { recursive: true });
  }
  containedPath(root, ".agents/task-state");
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new WorkflowValidationError([
      ".agents/task-state must be a real directory",
    ]);
  }
  return path.join(directory, `${issueKey}.json`);
}

function readState(targetPath, issueKey) {
  if (!existsSync(targetPath)) {
    return emptyState(issueKey);
  }
  const stat = lstatSync(targetPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new WorkflowValidationError([
      "task-state target must be a regular file",
    ]);
  }
  return validateState(
    parseJsonDocument(readFileSync(targetPath, "utf8")),
    issueKey,
  );
}

function writeState(targetPath, value) {
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    renameSync(temporaryPath, targetPath);
  } finally {
    if (existsSync(temporaryPath)) {
      rmSync(temporaryPath);
    }
  }
}

function readLockOwner(lockPath) {
  const stat = lstatSync(lockPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("lock must be a regular file");
  }
  const owner = JSON.parse(readFileSync(lockPath, "utf8"));
  if (
    !Number.isInteger(owner?.pid) ||
    owner.pid < 1 ||
    typeof owner.token !== "string" ||
    !owner.token
  ) {
    throw new Error("lock owner is invalid");
  }
  return owner;
}

async function withStateLock(targetPath, action) {
  const lockPath = `${targetPath}.lock`;
  const owner = { pid: process.pid, token: randomUUID() };
  const recovery = `Verify that no task-state writer is running before removing ${path.basename(lockPath)}; then retry. Do not clear the checkout gate lease.`;
  const fail = (reason) =>
    new WorkflowValidationError([`Task-state lock ${reason}. ${recovery}`]);
  const deadline = Date.now() + STATE_LOCK_TIMEOUT_MS;
  let descriptor;
  while (true) {
    try {
      descriptor = openSync(lockPath, "wx");
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let existing;
      let incompleteOwner = false;
      try {
        existing = readLockOwner(lockPath);
        process.kill(existing.pid, 0);
      } catch (probe) {
        if (probe.code === "ENOENT") continue;
        if (probe.code === "ESRCH") {
          // The owner may have released its lock and exited since our read.
          try {
            const current = readLockOwner(lockPath);
            if (
              current.pid !== existing.pid ||
              current.token !== existing.token
            )
              continue;
          } catch (refresh) {
            if (refresh.code === "ENOENT" || refresh instanceof SyntaxError)
              continue;
            throw fail("ownership cannot be verified");
          }
          throw fail("has a stale owner");
        }
        // Exclusive creation precedes writing the owner; a peer may see partial JSON.
        if (!(probe instanceof SyntaxError)) {
          throw fail("ownership cannot be verified");
        }
        incompleteOwner = true;
      }
      if (Date.now() >= deadline) {
        throw fail(
          incompleteOwner
            ? "ownership cannot be verified after 5 seconds"
            : "timed out after 5 seconds",
        );
      }
      await delay(STATE_LOCK_RETRY_MS);
    }
  }
  try {
    writeFileSync(descriptor, JSON.stringify(owner), "utf8");
    closeSync(descriptor);
    descriptor = undefined;
    return action();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      const current = readLockOwner(lockPath);
      if (current.pid !== owner.pid || current.token !== owner.token) {
        throw fail("ownership changed before release");
      }
      rmSync(lockPath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        if (error instanceof WorkflowValidationError) throw error;
        throw fail("could not be verified or released");
      }
    }
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (["record-context", "record-delivery"].includes(args.command)) {
    const input = readFileSync(0, "utf8");
    if (Buffer.byteLength(input) > 64 * 1024)
      throw new Error("task input exceeds 64 KiB");
    args.input = parseJsonDocument(input);
    if (detectUnsafeText(input).length)
      throw new Error("task input contains unsafe data");
  }
  const targetsCheckout = ["claim-gate", "begin-gate"].includes(args.command);
  const checkoutRoot = repositoryRoot(
    targetsCheckout ? args.worktree : process.cwd(),
  );
  if (targetsCheckout && !sameCheckout(checkoutRoot, args.worktree)) {
    throw new WorkflowValidationError([
      "claim-gate requires the Worker checkout root",
    ]);
  }
  const sharedRoot = taskStateRoot(checkoutRoot);
  const localRoot = isLinkedWorktree(checkoutRoot) ? checkoutRoot : sharedRoot;
  const targetPath = stateLocation(localRoot, args.issueKey);
  const sharedPath = path.join(
    sharedRoot,
    ".agents",
    "task-state",
    `${args.issueKey}.json`,
  );
  const readCurrentState = () =>
    readState(
      existsSync(targetPath) || targetPath === sharedPath
        ? targetPath
        : sharedPath,
      args.issueKey,
    );
  if (args.command === "show") {
    process.stdout.write(`${JSON.stringify(readCurrentState(), null, 2)}\n`);
    return;
  }
  if (args.command === "runtime") {
    const state = readCurrentState();
    validateRouteState(state);
    const runtime =
      args.role === "worker"
        ? state.executionRoute
        : resolveRuntime(CONFIG, args.role, {
            workerRoute: state.executionRoute,
          });
    process.stdout.write(
      JSON.stringify(
        runtimeArguments({
          model: runtime.model,
          reasoningEffort: runtime.reasoningEffort,
        }),
      ) + "\n",
    );
    return;
  }
  const result = await withStateLock(targetPath, () =>
    updateState(args, readCurrentState(), checkoutRoot, targetPath),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function validatePlanReference(value, issueKey) {
  if (
    value?.schemaVersion !== MARKDOWN_PLAN_SCHEMA ||
    value.path !== ".agents/task-state/" + issueKey + "-plan.md" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1
  )
    throw new Error("invalid implementation plan reference");
  return value;
}

function validateWorkItem(value) {
  const allowed = [
    "summary",
    "outcome",
    "acceptance",
    "userDecisions",
    "constraints",
    "sourceRef",
    "scrum",
    "dependencies",
  ];
  if (
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    !nonEmptyString(value.summary) ||
    !nonEmptyString(value.outcome)
  )
    throw new Error("work item requires summary/outcome and supported fields");
  if (
    !Array.isArray(value.acceptance) ||
    !value.acceptance.length ||
    value.acceptance.some(
      (item) =>
        !plainObject(item) ||
        !/^[A-Za-z0-9_-]+$/.test(item.id ?? "") ||
        !nonEmptyString(item.text),
    ) ||
    new Set(value.acceptance.map((item) => item.id)).size !==
      value.acceptance.length
  )
    throw new Error("acceptance requires unique IDs and text");
  for (const key of ["userDecisions", "constraints"]) {
    if (!Array.isArray(value[key]) || !value[key].every(nonEmptyString))
      throw new Error(key + " must be a string array");
  }
  if (!isSourceRef(value.sourceRef)) throw new Error("invalid sourceRef");
  if (
    value.scrum != null &&
    (!plainObject(value.scrum) ||
      Object.keys(value.scrum).some(
        (key) => !["provider", "key", "url"].includes(key),
      ) ||
      typeof value.scrum.provider !== "string" ||
      !/^[a-z][a-z0-9-]*$/.test(value.scrum.provider) ||
      !nonEmptyString(value.scrum.key) ||
      /[\s\0]/u.test(value.scrum.key) ||
      !isHttpsUrl(value.scrum.url))
  )
    throw new Error(
      "scrum requires provider, external item key and credential-free HTTPS URL",
    );
  if (
    !Array.isArray(value.dependencies) ||
    value.dependencies.some(
      (item) =>
        !plainObject(item) ||
        !nonEmptyString(item.key) ||
        !["hard", "coordination"].includes(item.kind) ||
        (item.kind === "hard" &&
          (!["merged", "done"].includes(item.requiredMilestone) ||
            typeof item.verified !== "boolean" ||
            !nonEmptyString(item.evidence))) ||
        (item.kind === "coordination" && !nonEmptyString(item.boundary)),
    )
  )
    throw new Error("invalid dependency structure");
  return { ...value, sourceRef: value.sourceRef ?? null };
}

function validateDelivery(value, issueKey) {
  const allowed = [
    "repository",
    "remoteUrl",
    "baseBranch",
    "headBranch",
    "pullRequest",
    "evidenceDestination",
    "allowedOperations",
  ];
  if (
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    value.repository !== REPOSITORY ||
    value.remoteUrl !== REMOTE_URL ||
    value.baseBranch !== BASE_BRANCH ||
    issueFromBranch(value.headBranch) !== issueKey
  )
    throw new Error(
      "delivery identity must match configured repository, base and task branch",
    );
  if (
    value.pullRequest != null &&
    (!Number.isSafeInteger(value.pullRequest.number) ||
      value.pullRequest.number < 1 ||
      value.pullRequest.url !==
        "https://github.com/" +
          value.repository +
          "/pull/" +
          value.pullRequest.number)
  )
    throw new Error("invalid pull request identity");
  if (
    value.evidenceDestination != null &&
    !isHttpsUrl(value.evidenceDestination)
  )
    throw new Error("invalid evidence destination");
  if (
    !Array.isArray(value.allowedOperations) ||
    !value.allowedOperations.every(nonEmptyString)
  )
    throw new Error("allowedOperations must be explicit");
  return {
    ...value,
    pullRequest: value.pullRequest ?? null,
    evidenceDestination: value.evidenceDestination ?? null,
  };
}

function updateState(args, state, checkoutRoot, targetPath) {
  let status = "recorded";
  if (
    state.activeCheckoutGate &&
    [
      "record-context",
      "record-delivery",
      "record-plan",
      "retire-task",
      "register-task",
    ].includes(args.command)
  ) {
    throw new Error(
      "end the active checkout gate before changing task metadata",
    );
  }
  if (
    ["record-route", "escalate-route"].includes(args.command) &&
    detectUnsafeText(JSON.stringify(args)).length
  ) {
    throw new Error("execution route contains unsafe data");
  }
  if (args.command === "register-task") {
    const existing = state.tasks[args.role];
    const next = {
      ...(existing && !existing.retired ? existing : {}),
      threadId: args.threadId,
      ...(args.kind ? { kind: args.kind } : {}),
      ...(args.hostId ? { hostId: args.hostId } : {}),
      ...(args.worktree ? { worktree: path.resolve(args.worktree) } : {}),
      ...(args.branch ? { branch: args.branch } : {}),
      ...(args.pullRequestNumber
        ? { pullRequestNumber: args.pullRequestNumber }
        : {}),
      retired: false,
    };
    const planner = state.tasks.planner;
    if (
      args.role === "worker" &&
      planner?.kind === "task" &&
      !planner.retired &&
      (!planner.worktree ||
        !next.worktree ||
        path.resolve(planner.worktree) !== path.resolve(next.worktree) ||
        !planner.branch ||
        planner.branch !== next.branch)
    ) {
      throw new WorkflowValidationError([
        "Worker must share the visible Planner worktree and branch",
      ]);
    }
    if (
      existing &&
      !existing.retired &&
      (existing.threadId !== args.threadId ||
        (existing.worktree &&
          args.worktree &&
          !sameCheckout(existing.worktree, args.worktree)) ||
        (existing.branch && args.branch && existing.branch !== args.branch))
    ) {
      throw new WorkflowValidationError([
        `${args.role} is already registered to another active task`,
      ]);
    }
    if (existing && JSON.stringify(existing) === JSON.stringify(next)) {
      status = "already-recorded";
    } else {
      state.tasks[args.role] = next;
    }
  } else if (args.command === "record-route") {
    const next = createExecutionRoute(args, CONFIG);
    if (
      state.executionRoute &&
      ["classification", "rationale", "riskSignals"].every(
        (key) =>
          JSON.stringify(state.executionRoute[key]) ===
          JSON.stringify(next[key]),
      )
    ) {
      status = "already-recorded";
    } else if (state.executionRoute) {
      throw new WorkflowValidationError([
        "execution route is already recorded with a different identity",
      ]);
    } else {
      state.executionRoute = next;
      state.executionRouteRevision = 1;
      state.executionRouteHistory = [];
    }
  } else if (args.command === "escalate-route") {
    const revision = validateRouteState(state);
    if (state.activeCheckoutGate)
      throw new WorkflowValidationError([
        "end the active checkout gate before escalation",
      ]);
    verifyWorkerCheckout(state, checkoutRoot);
    const next = createExecutionRoute(args, CONFIG);
    // Retry identity describes the request, not today's potentially edited configuration.
    const sameRequest = ["classification", "rationale", "riskSignals"].every(
      (key) =>
        JSON.stringify(state.executionRoute[key]) === JSON.stringify(next[key]),
    );
    if (args.expectedRevision === revision - 1 && sameRequest) {
      status = "already-recorded";
    } else {
      if (args.expectedRevision !== revision)
        throw new WorkflowValidationError([
          "stale execution route revision; read current state before escalating",
        ]);
      if (
        ROUTE_LEVELS[next.classification] <=
        ROUTE_LEVELS[state.executionRoute.classification]
      ) {
        throw new WorkflowValidationError([
          "escalation must move upward: bounded/routine -> standard/complex -> high-risk -> exceptional",
        ]);
      }
      state.executionRouteHistory = [
        ...(state.executionRouteHistory ?? []),
        { revision, route: state.executionRoute },
      ];
      state.executionRoute = next;
      state.executionRouteRevision = revision + 1;
    }
  } else if (["record-context", "record-delivery"].includes(args.command)) {
    const field = args.command === "record-context" ? "workItem" : "delivery";
    const next =
      field === "workItem"
        ? validateWorkItem(args.input)
        : validateDelivery(args.input, args.issueKey);
    const current = state[field];
    const revision = current?.revision ?? 0;
    const { revision: ignored, ...previous } = current ?? {};
    if (
      isDeepStrictEqual(previous, next) &&
      [revision, revision - 1].includes(args.expectedRevision)
    ) {
      status = "already-recorded";
    } else {
      if (args.expectedRevision !== revision)
        throw new Error("stale " + field + " revision; reread state");
      if (
        field === "delivery" &&
        current &&
        ["repository", "remoteUrl", "baseBranch", "headBranch"].some(
          (key) => current[key] !== next[key],
        )
      ) {
        throw new Error("recorded delivery checkout identity cannot change");
      }
      state[field] = { revision: revision + 1, ...next };
    }
  } else if (args.command === "record-plan") {
    const planPath = containedPath(checkoutRoot, args.planPath);
    if (!existsSync(planPath)) {
      throw new WorkflowValidationError([
        "implementation plan file does not exist",
      ]);
    }
    const planStat = lstatSync(planPath);
    if (!planStat.isFile() || planStat.isSymbolicLink()) {
      throw new WorkflowValidationError([
        "implementation plan path must be a regular file",
      ]);
    }
    const content = readFileSync(planPath, "utf8");
    if (
      !new RegExp(
        `^# ${args.issueKey}(?:[ \\t]+[^\\r\\n]*)?\\r?\\n\\s*\\S`,
        "u",
      ).test(content)
    ) {
      throw new WorkflowValidationError([
        "Markdown plan must start with its issue heading and contain a body",
      ]);
    }
    const next = validatePlanReference(
      {
        schemaVersion: MARKDOWN_PLAN_SCHEMA,
        path: args.planPath,
        revision: args.contextRevision,
      },
      args.issueKey,
    );
    if (JSON.stringify(state.implementationPlan) === JSON.stringify(next)) {
      status = "already-recorded";
    } else if (
      state.implementationPlan &&
      next.revision <= state.implementationPlan.revision
    ) {
      throw new WorkflowValidationError([
        "implementation plan revision must increase",
      ]);
    } else {
      state.implementationPlan = next;
    }
  } else if (args.command === "record-event") {
    const existing = state.deliveredEvents[args.eventKey];
    if (existing && existing !== args.targetThreadId) {
      throw new WorkflowValidationError([
        "event key is already recorded for another target",
      ]);
    }
    if (existing === args.targetThreadId) {
      status = "already-recorded";
    } else {
      state.deliveredEvents[args.eventKey] = args.targetThreadId;
    }
  } else if (args.command === "record-gate") {
    const prefix =
      ".agents/evidence/" + args.issueKey + "/" + args.observedSha + "/";
    if (!args.resultPath.startsWith(prefix))
      throw new Error("result path must belong to task and observed commit");
    const resultFile = containedPath(checkoutRoot, args.resultPath);
    if (
      !lstatSync(resultFile).isFile() ||
      lstatSync(resultFile).isSymbolicLink()
    )
      throw new Error("result must be a regular file");
    const next = { observedSha: args.observedSha, resultPath: args.resultPath };
    if (JSON.stringify(state.gates[args.gate]) === JSON.stringify(next)) {
      status = "already-recorded";
    } else {
      state.gates[args.gate] = next;
    }
  } else if (["begin-gate", "claim-gate"].includes(args.command)) {
    const role = args.gate === "review" ? "reviewer" : "tester";
    const worktree = path.resolve(args.worktree);
    const workerTask = state.tasks.worker;
    let roleTask = state.tasks[role];
    verifyWorkerCheckout(state, worktree, args.observedSha);
    if (args.command === "claim-gate") {
      if (
        roleTask &&
        !roleTask.retired &&
        roleTask.threadId !== args.threadId
      ) {
        throw new WorkflowValidationError([
          `${role} is already registered to another active task`,
        ]);
      }
      if (!roleTask || roleTask.retired) {
        roleTask = {
          threadId: args.threadId,
          worktree,
          branch: workerTask.branch,
          retired: false,
        };
      }
    }
    if (!workerTask || workerTask.retired || !workerTask.worktree) {
      throw new WorkflowValidationError([
        "an active Worker with a registered worktree is required",
      ]);
    }
    if (!roleTask || roleTask.retired || roleTask.threadId !== args.threadId) {
      throw new WorkflowValidationError([
        `${role} task identity is not actively registered`,
      ]);
    }
    if (
      path.resolve(workerTask.worktree) !== worktree ||
      !roleTask.worktree ||
      path.resolve(roleTask.worktree) !== worktree
    ) {
      throw new WorkflowValidationError([
        "gate task must use the Worker's registered worktree",
      ]);
    }
    const next = {
      gate: args.gate,
      role,
      threadId: args.threadId,
      worktree,
      observedSha: args.observedSha,
    };
    if (state.activeCheckoutGate) {
      if (JSON.stringify(state.activeCheckoutGate) === JSON.stringify(next)) {
        status = "already-recorded";
      } else {
        throw new WorkflowValidationError([
          "another checkout gate is already active",
        ]);
      }
    } else {
      state.activeCheckoutGate = next;
    }
    if (args.command === "claim-gate") state.tasks[role] = roleTask;
  } else if (args.command === "end-gate") {
    const active = state.activeCheckoutGate;
    if (!active) {
      status = "already-recorded";
    } else if (active.gate !== args.gate || active.threadId !== args.threadId) {
      throw new WorkflowValidationError([
        "checkout gate release identity does not match the active lease",
      ]);
    } else {
      delete state.activeCheckoutGate;
    }
  } else if (args.command === "retire-task") {
    const existing = state.tasks[args.role];
    if (!existing || existing.threadId !== args.threadId) {
      throw new WorkflowValidationError([
        "retirement identity does not match the registered task",
      ]);
    }
    if (existing.retired) {
      status = "already-recorded";
    } else {
      state.tasks[args.role] = { ...existing, retired: true };
    }
  }
  if (status !== "already-recorded") {
    writeState(targetPath, state);
  }
  return { status, issueKey: args.issueKey };
}

try {
  await main();
} catch (error) {
  const messages =
    error instanceof WorkflowValidationError ? error.errors : [error.message];
  process.stderr.write(`${redactText(messages.join("\n"))}\n`);
  process.exitCode = 1;
}
