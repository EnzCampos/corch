#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { WorkflowValidationError, redactText } from "./lib/validation.mjs";
import { prepareReport } from "./lib/report.mjs";

function usage() {
  return `Prepare a local evidence report and a text-only PR comment together.

Usage:
  node prepare-report.mjs --issue TASK-N --pr N --gate review|test|handoff \\
    --head-branch codex/task-n-<slug> --result <json-path> \\
    [--profile frontend|backend|mixed|general] [--evidence-url <https-url>] [--dry-run]

Review/test require --profile; handoff derives it from the selection and rejects
a conflicting override. Both outputs require validated results and evidence under
.agents/evidence/<issue>/<observedSha>/. Output includes commentBody, files and
prComment (marker/body). An optional evidence URL must identify already-published
evidence. This helper writes no files, reads no credentials and publishes nothing.`;
}

function parseArguments(argv) {
  const args = { dryRun: false };
  const fields = {
    "--issue": "issueKey",
    "--pr": "pullRequestNumber",
    "--gate": "gate",
    "--head-branch": "headBranch",
    "--profile": "profile",
    "--result": "resultPath",
    "--evidence-url": "evidenceUrl",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--help" || current === "-h") args.help = true;
    else if (current === "--dry-run") args.dryRun = true;
    else if (Object.hasOwn(fields, current)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) {
        throw new WorkflowValidationError([`${current} requires a value`]);
      }
      args[fields[current]] = current === "--pr" ? Number(value) : value;
    } else throw new WorkflowValidationError([`unknown argument: ${current}`]);
  }
  if (args.help) return args;
  const required = ["issueKey", "pullRequestNumber", "gate", "headBranch", "resultPath"];
  if (args.gate !== "handoff") required.push("profile");
  const missing = required.filter((field) => !args[field]);
  if (missing.length) {
    throw new WorkflowValidationError([`missing arguments: ${missing.join(", ")}`]);
  }
  if (!["review", "test", "handoff"].includes(args.gate)) {
    throw new WorkflowValidationError(["--gate must be review, test, or handoff"]);
  }
  if (!Number.isInteger(args.pullRequestNumber) || args.pullRequestNumber < 1) {
    throw new WorkflowValidationError(["--pr must be a positive integer"]);
  }
  return args;
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const root = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(), encoding: "utf8", shell: false, windowsHide: true,
  });
  if (root.status !== 0) {
    throw new WorkflowValidationError(["Report preparation requires a Git repository"]);
  }
  process.stdout.write(`${JSON.stringify(prepareReport(args, root.stdout.trim()), null, 2)}\n`);
}

try {
  main();
} catch (error) {
  const messages = error instanceof WorkflowValidationError ? error.errors : [error.message];
  process.stderr.write(`${redactText(messages.join("\n"))}\n`);
  process.exitCode = 1;
}
