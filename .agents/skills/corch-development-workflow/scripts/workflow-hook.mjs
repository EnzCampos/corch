#!/usr/bin/env node
import { REPOSITORY, ISSUE_PREFIX, BRANCH_PATTERN } from "./workflow-config.mjs";


import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { redactText } from "./workflow-lib.mjs";
import { plannerLaunchFromPrompt, prepareWorktree } from "./prepare-worker-worktree.mjs";


function readStdin() {
  const text = readFileSync(0, "utf8");
  return text.trim() ? JSON.parse(text) : {};
}

function run(cwd, command, args) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 15_000,
  });
}

function git(cwd, args, { optional = false } = {}) {
  const result = run(cwd, "git", args);
  if (result.status !== 0) {
    if (optional) {
      return undefined;
    }
    throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  }
  return result.stdout.trim();
}

function repositoryContext(cwd) {
  const root = git(cwd, ["rev-parse", "--show-toplevel"], { optional: true });
  if (!root) {
    return undefined;
  }
  const branch = git(root, ["branch", "--show-current"]);
  const match = branch.match(BRANCH_PATTERN);
  const gitDirectory = path.resolve(root, git(root, ["rev-parse", "--git-dir"]));
  const commonDirectory = path.resolve(root, git(root, ["rev-parse", "--git-common-dir"]));
  const issueKey = match ? `${ISSUE_PREFIX}-${match[1]}` : undefined;
  const taskStateRoot = path.dirname(commonDirectory);
  const localTaskStatePath = issueKey
    ? path.join(root, ".agents", "task-state", `${issueKey}.json`)
    : undefined;
  const sharedTaskStatePath = issueKey
    ? path.join(taskStateRoot, ".agents", "task-state", `${issueKey}.json`)
    : undefined;
  const taskStatePath = localTaskStatePath && existsSync(localTaskStatePath)
    ? localTaskStatePath
    : sharedTaskStatePath;
  let taskState;
  if (taskStatePath && existsSync(taskStatePath)) {
    try {
      taskState = JSON.parse(readFileSync(taskStatePath, "utf8"));
    } catch {
      taskState = undefined;
    }
  }
  return {
    root,
    taskStateRoot,
    taskStatePath,
    branch,
    issueKey,
    headSha: git(root, ["rev-parse", "--verify", "HEAD"], { optional: true }) ?? "unborn",
    worktree: gitDirectory !== commonDirectory,
    taskContextPath: issueKey ? `.agents/task-context/${issueKey}.md` : undefined,
    taskState,
  };
}

function hookContext(eventName, additionalContext) {
  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext,
    },
  };
}

function sessionStart(event) {
  const context = repositoryContext(event.cwd || process.cwd());
  if (!context) {
    return hookContext("SessionStart", "This session is not inside a Git repository.");
  }
  const localContextPath = context.issueKey ? path.join(context.root, context.taskContextPath) : undefined;
  const identity = context.issueKey
    ? `Issue ${context.issueKey}; protocol ${context.taskState?.workflowProtocol ?? "unregistered"}; context ${existsSync(localContextPath) ? context.taskContextPath : "missing"}.`
    : "No work-item Worker branch is active. Use $corch-development-workflow: eligible bounded delivery stays in this task and checkout; work requiring tracked ownership, coordination, or material risk follows the assigned delivery roles.";
  const protocolInstruction = "Use the task's exact role skill; do not load $corch-development-workflow after the role is known.";
  return hookContext("SessionStart", [
    `Corch ${REPOSITORY}; ${context.worktree ? "worktree" : "primary"}; branch ${context.branch || "detached"}; commit ${context.headSha}.`,
    identity,
    "This is read-only session context, not a readiness check. New Planner launch prompts prepare the checkout before planning.",
    "The explicit task role controls authority. Direct implementers and assigned Workers may edit tracked files within user authorization. Gate roles use the serialized shared-checkout lease and write ignored evidence only.",
    protocolInstruction,
  ].join(" "));
}

export async function userPromptSubmit(event, options = {}) {
  const launch = plannerLaunchFromPrompt(event.prompt);
  if (!launch) return {};
  try {
    await prepareWorktree({ ...options, cwd: event.cwd || process.cwd(), launch, sessionId: event.session_id });
    return hookContext("UserPromptSubmit", `${launch.issueKey} bootstrap ready: ${launch.branch}; context and Planner identity registered; configured setup steps verified. Start planning now.`);
  } catch (error) {
    return { decision: "block", reason: `Corch startup failed: ${redactText(String(error.message)).slice(-2_000)}` };
  }
}

async function main() {
  const command = process.argv[2];
  const event = readStdin();
  let output;
  if (command === "session-start") {
    output = sessionStart(event);
  } else if (command === "user-prompt-submit") {
    output = await userPromptSubmit(event);
  } else {
    throw new Error(`Unknown workflow hook command: ${command || "<missing>"}`);
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`Corch workflow hook failed: ${redactText(error.message)}\n`);
    process.exitCode = 1;
  }
}
