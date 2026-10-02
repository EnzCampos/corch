#!/usr/bin/env node
import {
  ISSUE_PATTERN,
  CONFIG,
  readConfig,
} from "./lib/workflow-config.mjs";

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { run, runCommand } from "./lib/command-execution.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { redactText, containedPath } from "./lib/validation.mjs";

const MAX_DIAGNOSTIC_LENGTH = 2_000;
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

function git(cwd, args) {
  const result = run("git", args, { cwd, timeout: 15_000 });
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout.trim();
}

function writeJsonAtomically(target, value) {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) rmSync(temporary);
  }
}

function stateDirectory(root) {
  const directory = path.join(root, ".agents", "task-state");
  for (const entry of [path.join(root, ".agents"), directory]) {
    if (
      existsSync(entry) &&
      (lstatSync(entry).isSymbolicLink() || !lstatSync(entry).isDirectory())
    ) {
      throw new Error("Bootstrap state must use real directories");
    }
    mkdirSync(entry, { recursive: true });
  }
  return directory;
}

function readJsonFile(target) {
  if (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink()) {
    throw new Error(
      `Bootstrap input must be a regular file: ${path.basename(target)}`,
    );
  }
  return JSON.parse(readFileSync(target, "utf8"));
}

async function withSetupLock(root, action, timeoutMs = 120_000) {
  const lock = path.join(stateDirectory(root), "worktree-bootstrap.lock");
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: "wx" });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const owner = readJsonFile(lock);
        if (!Number.isInteger(owner.pid) || owner.pid < 1)
          throw new Error("Invalid setup lock owner");
        try {
          process.kill(owner.pid, 0);
        } catch (probe) {
          if (probe.code !== "ESRCH") throw probe;
          throw new Error(
            "Interrupted bootstrap left a stale lock; verify no setup children remain before removing worktree-bootstrap.lock",
          );
        }
      } catch (probe) {
        if (probe.code === "ENOENT") continue;
        // A competing process may still be writing the lock; never steal a live lock.
        if (!(probe instanceof SyntaxError)) throw probe;
      }
      if (Date.now() >= deadline)
        throw new Error(
          "Bootstrap lock timed out; another setup may still be running",
        );
      await delay(100);
    }
  }
  try {
    return await action();
  } finally {
    rmSync(lock, { force: true });
  }
}

function assertCommand(result, stage) {
  if (result.status !== 0 || result.error) {
    const detail = redactText(`${result.stderr || ""}\n${result.stdout || ""}`)
      .trim()
      .slice(-MAX_DIAGNOSTIC_LENGTH);
    throw new Error(`${stage} failed${detail ? `: ${detail}` : ""}`);
  }
}

async function prepareDependencies(root, execute) {
  const localConfig = path.join(root, ".agents", "workflow.json");
  const config = existsSync(localConfig) ? readConfig(localConfig) : CONFIG;
  const markerPath = path.join(stateDirectory(root), "worktree-bootstrap.json");
  const marker = existsSync(markerPath)
    ? readJsonFile(markerPath)
    : { schemaVersion: "worktree-bootstrap/v2", steps: {} };
  const completed = marker.steps ?? {};
  const executedSteps = [];
  const fingerprints = [];
  let upstreamChanged = false;
  for (const step of config.setup.steps) {
    const hash = createHash("sha256").update(
      JSON.stringify({ step, fingerprints }),
    );
    for (const input of step.inputs)
      hash.update(readFileSync(containedPath(root, input)));
    const fingerprint = hash.digest("hex");
    const outputs = step.outputs.map((output) => containedPath(root, output));
    const stale =
      upstreamChanged ||
      completed[step.name] !== fingerprint ||
      outputs.some((output) => !existsSync(output));
    if (stale) {
      assertCommand(
        await execute(step.command, step.args, { cwd: root }),
        `Setup step ${step.name}`,
      );
      for (const output of step.outputs) {
        if (!existsSync(containedPath(root, output)))
          throw new Error(
            `Setup step ${step.name} completed without creating ${output}`,
          );
      }
      completed[step.name] = fingerprint;
      // If a later step fails, never reuse a stale cache for it on retry.
      const index = config.setup.steps.indexOf(step);
      for (const later of config.setup.steps.slice(index + 1))
        delete completed[later.name];
      writeJsonAtomically(markerPath, {
        schemaVersion: "worktree-bootstrap/v2",
        steps: completed,
      });
      executedSteps.push(step.name);
      upstreamChanged = true;
    }
    fingerprints.push(fingerprint);
  }
  return { status: "ready", executedSteps };
}

export async function prepareWorktree({
  cwd = process.cwd(),
  issueKey,
  threadId,
  execute = runCommand,
  lockTimeoutMs,
} = {}) {
  if (
    (issueKey !== undefined || threadId !== undefined) &&
    (!ISSUE_PATTERN.test(issueKey ?? "") ||
      (threadId !== undefined &&
        (typeof threadId !== "string" ||
          !/^[a-zA-Z0-9_-]{1,128}$/u.test(threadId))))
  ) {
    throw new Error("Planner bootstrap requires a valid issue and optional thread ID");
  }
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  const gitDirectory = path.resolve(
    root,
    git(root, ["rev-parse", "--git-dir"]),
  );
  const commonDirectory = path.resolve(
    root,
    git(root, ["rev-parse", "--git-common-dir"]),
  );
  if (gitDirectory === commonDirectory) {
    if (issueKey)
      throw new Error(
        "Planner bootstrap requires a linked worktree, not the primary checkout",
      );
    return { status: "skipped-primary-checkout" };
  }
  const invokeState = (...args) => {
    const result = run(process.execPath, [path.join(SCRIPT_DIRECTORY, "task-state.mjs"), ...args], { cwd: root, timeout: 20_000 });
    assertCommand(result, "Task state");
    return JSON.parse(result.stdout);
  };
  return withSetupLock(
    root,
    async () => {
      let reservedBranch;
      if (issueKey) {
        const state = invokeState("show", "--issue", issueKey);
        if (!state.workItem?.acceptance?.length || !state.delivery) throw new Error("Planner preparation requires task context and delivery metadata");
        if (state.activeCheckoutGate) throw new Error("end the active checkout gate before preparation");
        reservedBranch = state.delivery.headBranch;
        if (git(root, ["remote", "get-url", "origin"]) !== state.delivery.remoteUrl) throw new Error("Repository origin does not match staged delivery target");
        const planner = state.tasks?.planner;
        if (
          planner &&
          !planner.retired &&
          (planner.kind !== "task" || planner.threadId !== threadId)
        ) {
          throw new Error("Issue already has another active Planner");
        }
        if (
          planner &&
          !planner.retired &&
          (path.resolve(planner.worktree ?? "") !== path.resolve(root) ||
            planner.branch !== reservedBranch)
        ) {
          throw new Error("Registered Planner belongs to a different checkout");
        }
        const branch = git(root, ["branch", "--show-current"]);
        if (branch !== reservedBranch) {
          if (
            branch ||
            git(root, ["status", "--porcelain"]) ||
            git(root, ["rev-parse", "HEAD"]) !==
              git(root, ["rev-parse", `refs/heads/${reservedBranch}`])
          ) {
            throw new Error(
              "Cannot safely attach the reserved branch: checkout is changed or has a different identity",
            );
          }
          git(root, ["switch", reservedBranch]);
        }
        if (threadId !== undefined) {
          invokeState("register-task", "--issue", issueKey, "--role", "planner", "--kind", "task",
            "--thread", threadId, "--worktree", root, "--branch", reservedBranch);
        }

      }
      const result = await prepareDependencies(root, execute);
      if (issueKey) {
        const current = invokeState("show", "--issue", issueKey);
        const planner = current.tasks.planner;
        const plannerChanged = threadId !== undefined
          ? planner?.threadId !== threadId
          : planner && !planner.retired;
        if (git(root, ["branch", "--show-current"]) !== reservedBranch || !current.workItem?.acceptance?.length ||
            current.delivery?.headBranch !== reservedBranch || plannerChanged || current.activeCheckoutGate)
          throw new Error("Prepared checkout identity or context changed during setup");
      }
      return result;
    },
    lockTimeoutMs,
  );
}

function parseArguments(argv) {
  if (argv.length === 0) return {};
  const options = {};
  const keys = { "--issue": "issueKey", "--thread": "threadId", "--worktree": "cwd" };
  for (let index = 0; index < argv.length; index += 2) {
    const key = Object.hasOwn(keys, argv[index]) ? keys[argv[index]] : undefined;
    const value = argv[index + 1];
    if (!key || Object.hasOwn(options, key) || !value || value.startsWith("--")) {
      throw new Error(`Unknown, duplicate or incomplete argument: ${argv[index]}`);
    }
    options[key] = value;
  }
  if (
    !options.issueKey ||
    !options.cwd || !path.isAbsolute(options.cwd)
  ) {
    throw new Error(
      "Planner preparation requires --issue and an absolute --worktree; --thread is optional",
    );
  }
  return options;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const argv = process.argv.slice(2);
    if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) {
      process.stdout.write(
        "Usage: node prepare-worker-worktree.mjs [--issue KEY --worktree ABSOLUTE_PATH [--thread ID]]\nWith no arguments, verify Local Environment dependencies only.\nWith --issue and --worktree, prepare before Planner creation; --thread also registers an existing Planner.\n",
      );
    } else {
      process.stdout.write(
        `${JSON.stringify(await prepareWorktree(parseArguments(argv)))}\n`,
      );
    }
  } catch (error) {
    process.stderr.write(
      `${redactText(String(error.message || error)).replaceAll(/[\r\n]+/gu, " ")}\n`,
    );
    process.exitCode = 1;
  }
}
