#!/usr/bin/env node
import { ISSUE_PATTERN } from "./lib/workflow-config.mjs";

import {
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { WorkflowValidationError, redactText, containedPath } from "./lib/validation.mjs";
import { runCommand } from "./lib/command-execution.mjs";

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,79}$/;
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const FAILURE_TAIL_BYTES = 4_000;

function usage() {
  return `Run a validation command while keeping model-visible output bounded.

Usage:
  node run-bounded-check.mjs --issue TASK-N --name <label> [--timeout-ms 180000] -- <command> [args...]

Executables run directly; Windows npm/pnpm/Corepack shims run through Git Bash
with literal arguments. CORCH_BASH may select an absolute Git Bash executable path.
Sanitized output is stored below the
current checkout's .agents/task-state/logs/TASK-N/. Success emits a
one-line JSON summary; failure also includes at most the final 4000 characters.`;
}

function parseArguments(argv) {
  const separator = argv.indexOf("--");
  const options = separator < 0 ? argv : argv.slice(0, separator);
  const command = separator < 0 ? [] : argv.slice(separator + 1);
  const args = { command, timeoutMs: 180_000 };
  for (let index = 0; index < options.length; index += 1) {
    if (options[index] === "--help" || options[index] === "-h")
      args.help = true;
    else if (options[index] === "--issue") args.issueKey = options[++index];
    else if (options[index] === "--name") args.name = options[++index];
    else if (options[index] === "--timeout-ms") args.timeoutMs = Number(options[++index]);
    else
      throw new WorkflowValidationError([
        `unknown argument: ${options[index]}`,
      ]);
  }
  if (!args.help) {
    if (!ISSUE_PATTERN.test(args.issueKey ?? ""))
      throw new WorkflowValidationError([
        "--issue must match the configured issue prefix and a positive number",
      ]);
    if (!NAME_PATTERN.test(args.name ?? ""))
      throw new WorkflowValidationError(["--name is invalid"]);
    if (!Number.isSafeInteger(args.timeoutMs) || args.timeoutMs < 1) throw new Error("--timeout-ms must be positive");
    if (args.command.length === 0)
      throw new WorkflowValidationError(["a command is required after --"]);
  }
  return args;
}

function git(args) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new WorkflowValidationError([
      "run-bounded-check requires a Git repository",
    ]);
  return result.stdout.trim();
}

function writeAtomically(targetPath, content) {
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    renameSync(temporaryPath, targetPath);
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath);
  }
}

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
  } else {
    const checkoutRoot = git(["rev-parse", "--show-toplevel"]);
    const logDirectory = path.join(
      checkoutRoot,
      ".agents",
      "task-state",
      "logs",
      args.issueKey,
    );
    containedPath(checkoutRoot, path.relative(checkoutRoot, logDirectory).replaceAll("\\", "/"));
    mkdirSync(logDirectory, { recursive: true });
    if (lstatSync(logDirectory).isSymbolicLink())
      throw new WorkflowValidationError([
        "log directory must not be a symlink",
      ]);
    const logPath = path.join(logDirectory, `${args.name}.log`);
    if (existsSync(logPath) && lstatSync(logPath).isSymbolicLink()) {
      throw new WorkflowValidationError(["log target must not be a symlink"]);
    }
    const started = Date.now();
    const result = await runCommand(args.command[0], args.command.slice(1), {
      cwd: checkoutRoot,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      maxOutput: MAX_LOG_BYTES * 2,
      timeoutMs: args.timeoutMs,
    });
    const raw = `${result.stdout || ""}${result.stderr || ""}${result.error ? `\n${result.error.message}` : ""}`;
    const sanitized = redactText(raw).split(checkoutRoot).join("<repo>");
    const capped =
      sanitized.length > MAX_LOG_BYTES
        ? `[output truncated to final ${MAX_LOG_BYTES} characters]\n${sanitized.slice(-MAX_LOG_BYTES)}`
        : sanitized;
    writeAtomically(logPath, capped);
    const passed = result.status === 0 && !result.error;
    const summary = {
      schemaVersion: "bounded-check-result/v1",
      issueKey: args.issueKey,
      name: args.name,
      command: path.basename(args.command[0]),
      status: passed ? "PASS" : "FAIL",
      exitCode: Number.isInteger(result.status) ? result.status : null,
      durationMs: Date.now() - started,
      logPath: path.relative(checkoutRoot, logPath).replaceAll("\\", "/"),
      outputBytes: Buffer.byteLength(capped),
      ...(passed ? {} : { failureTail: capped.slice(-FAILURE_TAIL_BYTES) }),
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if (!passed) process.exitCode = result.status > 0 && result.status < 256 ? result.status : 1;
  }
} catch (error) {
  const messages =
    error instanceof WorkflowValidationError ? error.errors : [error.message];
  process.stderr.write(`${redactText(messages.join("\n"))}\n`);
  process.exitCode = 1;
}
