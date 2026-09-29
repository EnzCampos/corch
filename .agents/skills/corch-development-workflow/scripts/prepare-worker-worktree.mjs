#!/usr/bin/env node
import {
  ISSUE_PATTERN,
  issueFromBranch,
  CONFIG,
  readConfig,
} from "./workflow-config.mjs";

import { createHash } from "node:crypto";
import {
  existsSync,
  realpathSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { redactText, validateWorkerBootstrap } from "./workflow-lib.mjs";

const MAX_DIAGNOSTIC_LENGTH = 2_000;
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

export function run(command, args, options = {}) {
  if (
    process.platform !== "win32" ||
    !new Set(["corepack", "npm", "pnpm"]).has(command)
  ) {
    return spawnSync(command, args, {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      ...options,
    });
  }
  // Only simple tokens reach cmd.exe, including colon-bearing script names.
  // Quoting each token makes it treat the first quote as part of the command name.
  const values = [command, ...args];
  if (values.some((value) => !/^[a-zA-Z0-9@._/:-]+$/u.test(value))) {
    throw new Error("Unsupported Corepack argument");
  }
  return spawnSync("cmd.exe", ["/d", "/s", "/c", values.join(" ")], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    ...options,
  });
}

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

// Async child supervision lets SIGINT/SIGTERM and deadlines terminate the whole install tree.
export function runSetupCommand(
  command,
  args,
  { cwd, timeoutMs = 180_000 } = {},
) {
  let executable = command;
  let parameters = args;
  if (
    process.platform === "win32" &&
    new Set(["corepack", "npm", "pnpm"]).has(command)
  ) {
    if (
      [command, ...args].some((value) => !/^[a-zA-Z0-9@._/:-]+$/u.test(value))
    ) {
      throw new Error("Unsupported Corepack argument");
    }
    executable = "cmd.exe";
    parameters = ["/d", "/s", "/c", [command, ...args].join(" ")];
  }
  return new Promise((resolve) => {
    const child = spawn(executable, parameters, {
      cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let failure;
    const append = (chunk) => {
      output = (output + chunk.toString()).slice(-64_000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const stop = (reason) => {
      if (failure) return;
      failure = reason;
      if (!child.pid) return;
      if (process.platform === "win32") {
        spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          timeout: 10_000,
        });
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") child.kill("SIGKILL");
        }
      }
    };
    const interrupt = () => stop("Bootstrap interrupted");
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    const timer = setTimeout(
      () => stop("Bootstrap command timed out"),
      timeoutMs,
    );
    child.once("error", (error) => {
      failure = error.message;
    });
    child.once("close", (status) => {
      clearTimeout(timer);
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
      resolve({
        status: failure ? 1 : status,
        stdout: output,
        stderr: failure || "",
      });
    });
  });
}

function assertCommand(result, stage) {
  if (result.status !== 0) {
    const detail = redactText(`${result.stderr || ""}\n${result.stdout || ""}`)
      .trim()
      .slice(-MAX_DIAGNOSTIC_LENGTH);
    throw new Error(`${stage} failed${detail ? `: ${detail}` : ""}`);
  }
}

function containedPath(root, relative) {
  const candidate = path.resolve(root, relative);
  const resolvedRoot = realpathSync(root);
  let ancestor = candidate;
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const canonical = realpathSync(ancestor);
  const difference = path.relative(resolvedRoot, canonical);
  if (
    difference === ".." ||
    difference.startsWith(`..${path.sep}`) ||
    path.isAbsolute(difference)
  ) {
    throw new Error(`Setup path escapes the checkout: ${relative}`);
  }
  return candidate;
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

export function plannerLaunchFromPrompt(prompt) {
  let input = String(prompt ?? "")
    .replaceAll("\r\n", "\n")
    .trim();
  if (input.startsWith("<codex_delegation>")) {
    const wrapped = input.match(
      /^<codex_delegation>\s*(?:<source_thread_id>[^<]+<\/source_thread_id>\s*)?<input>([\s\S]*)<\/input>\s*<\/codex_delegation>$/u,
    );
    if (!wrapped) return undefined;
    input = wrapped[1].trim();
  }
  const match = input.match(
    /^\[([A-Z][A-Z0-9]*-[1-9]\d*)\] Planner\r?\nUse \$corch-planner for this issue\.\r?\nCorch bootstrap: \1\r?\n/u,
  );
  if (!match || !ISSUE_PATTERN.test(match[1])) return undefined;
  const branch = input.match(/^Reserved branch: (.+)$/mu)?.[1];
  if (issueFromBranch(branch) !== match[1]) return undefined;
  return { issueKey: match[1], branch };
}

export async function prepareWorktree({
  cwd = process.cwd(),
  launch,
  sessionId,
  execute = runSetupCommand,
  lockTimeoutMs,
} = {}) {
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
    if (launch)
      throw new Error(
        "Planner bootstrap requires a linked worktree, not the primary checkout",
      );
    return { status: "skipped-primary-checkout" };
  }
  const sharedRoot = path.dirname(commonDirectory);
  const sharedState =
    launch && ISSUE_PATTERN.test(launch.issueKey)
      ? readJsonFile(
          path.join(
            sharedRoot,
            ".agents",
            "task-state",
            `${launch.issueKey}.json`,
          ),
        )
      : undefined;
  return withSetupLock(
    root,
    async () => {
      if (launch) {
        if (
          !ISSUE_PATTERN.test(launch.issueKey) ||
          !/^[a-zA-Z0-9_-]{1,128}$/u.test(sessionId ?? "")
        ) {
          throw new Error(
            "Planner bootstrap requires an issue and hook session ID",
          );
        }
        if (
          sharedState.schemaVersion !== "task-state/v2" ||
          sharedState.workflowProtocol !== "delivery-v3" ||
          sharedState.issueKey !== launch.issueKey
        ) {
          throw new Error(
            "Planner bootstrap requires staged delivery-v3 state",
          );
        }
        const input = validateWorkerBootstrap(
          readJsonFile(
            path.join(
              sharedRoot,
              ".agents",
              "task-state",
              `${launch.issueKey}-bootstrap-input.json`,
            ),
          ),
        );
        if (
          input.issue.key !== launch.issueKey ||
          input.reservedBranch !== launch.branch
        )
          throw new Error("Launch identity does not match staged bootstrap");
        if (
          git(root, ["remote", "get-url", "origin"]) !==
          input.deliveryTarget.remoteUrl
        )
          throw new Error(
            "Repository origin does not match staged delivery target",
          );
        const localStatePath = path.join(
          root,
          ".agents",
          "task-state",
          `${launch.issueKey}.json`,
        );
        const state = existsSync(localStatePath)
          ? readJsonFile(localStatePath)
          : sharedState;
        const planner = state.tasks?.planner;
        if (
          planner &&
          !planner.retired &&
          (planner.kind !== "task" || planner.threadId !== sessionId)
        ) {
          throw new Error("Issue already has another active Planner");
        }
        if (
          planner &&
          !planner.retired &&
          (path.resolve(planner.worktree ?? "") !== path.resolve(root) ||
            planner.branch !== launch.branch)
        ) {
          throw new Error("Registered Planner belongs to a different checkout");
        }
        const branch = git(root, ["branch", "--show-current"]);
        if (branch !== launch.branch) {
          if (
            branch ||
            git(root, ["status", "--porcelain"]) ||
            git(root, ["rev-parse", "HEAD"]) !==
              git(root, ["rev-parse", `refs/heads/${launch.branch}`])
          ) {
            throw new Error(
              "Cannot safely attach the reserved branch: checkout is changed or has a different identity",
            );
          }
          git(root, ["switch", launch.branch]);
        }
        const invoke = (script, args) =>
          run(
            process.execPath,
            [path.join(SCRIPT_DIRECTORY, script), ...args],
            { cwd: root, timeout: 20_000 },
          );
        assertCommand(
          invoke("materialize-task-context.mjs", [
            "hydrate",
            "--issue",
            launch.issueKey,
            "--worktree",
            root,
          ]),
          "Context hydration",
        );
        assertCommand(
          invoke("task-state.mjs", [
            "register-task",
            "--issue",
            launch.issueKey,
            "--role",
            "planner",
            "--kind",
            "task",
            "--thread",
            sessionId,
            "--worktree",
            root,
            "--branch",
            launch.branch,
          ]),
          "Planner registration",
        );
      }
      const result = await prepareDependencies(root, execute);
      if (
        launch &&
        (git(root, ["branch", "--show-current"]) !== launch.branch ||
          !existsSync(
            path.join(root, ".agents", "task-context", `${launch.issueKey}.md`),
          ))
      ) {
        throw new Error(
          "Prepared checkout identity or context changed during setup",
        );
      }
      return result;
    },
    lockTimeoutMs,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    process.stdout.write(`${JSON.stringify(await prepareWorktree())}\n`);
  } catch (error) {
    process.stderr.write(
      `${redactText(String(error.message || error)).replaceAll(/[\r\n]+/gu, " ")}\n`,
    );
    process.exitCode = 1;
  }
}
