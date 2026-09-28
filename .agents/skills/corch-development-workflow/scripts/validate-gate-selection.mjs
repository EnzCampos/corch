#!/usr/bin/env node
import { REPOSITORY, BASE_BRANCH } from "./workflow-config.mjs";


import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  WorkflowValidationError,
  artifactMetadata,
  buildGateSelectionMarker,
  parseJsonDocument,
  redactText,
  resolveEvidenceFiles,
  resultArtifactPaths,
  validateHandoffEvidence,
  validateGateSelection,
} from "./workflow-lib.mjs";

function usage() {
  return `Validate a risk-selected gate-selection/v2 document.

Usage:
  node validate-gate-selection.mjs --issue TASK-N --pr N \\
    --head-branch codex/task-n-<slug> --selection <path>

The selection records observedSha for audit and delta context. Validation does
not require a detached checkout, a clean tree, Git-config bindings, or equality
with the latest remote head.`;
}

function parseArguments(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--help" || current === "-h") {
      args.help = true;
    } else if (current === "--issue") {
      args.issueKey = argv[++index];
    } else if (current === "--pr") {
      args.pullRequestNumber = Number(argv[++index]);
    } else if (current === "--head-branch") {
      args.headBranch = argv[++index];
    } else if (current === "--selection") {
      args.selectionPath = argv[++index];
    } else {
      throw new WorkflowValidationError([`unknown argument: ${current}`]);
    }
  }
  if (args.help) {
    return args;
  }
  const missing = ["issueKey", "pullRequestNumber", "headBranch", "selectionPath"]
    .filter((field) => !args[field]);
  if (missing.length > 0) {
    throw new WorkflowValidationError([`missing arguments: ${missing.join(", ")}`]);
  }
  return args;
}

function gitRoot() {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new WorkflowValidationError(["gate selection validation requires a Git repository"]);
  }
  return result.stdout.trim();
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const root = gitRoot();
  const selection = validateGateSelection(
    parseJsonDocument(readFileSync(path.resolve(root, args.selectionPath), "utf8")),
    {
      issueKey: args.issueKey,
      repository: REPOSITORY,
      pullRequestNumber: args.pullRequestNumber,
      baseBranch: BASE_BRANCH,
      headBranch: args.headBranch,
    },
  );
  const evidencePaths = resultArtifactPaths(selection);
  const evidence = resolveEvidenceFiles({
    repositoryRoot: root,
    issueKey: selection.issueKey,
    observedSha: selection.observedSha,
    files: evidencePaths,
    metadata: artifactMetadata(selection),
  });
  if (selection.actual.test.decision === "skipped") {
    validateHandoffEvidence(selection, evidence);
  }
  process.stdout.write(`${JSON.stringify({
    status: "valid",
    issueKey: selection.issueKey,
    pullRequestNumber: selection.pullRequest.number,
    observedSha: selection.observedSha,
    review: selection.actual.review.decision,
    test: selection.actual.test.decision,
    artifacts: evidence.map((item) => item.suppliedPath),
    marker: buildGateSelectionMarker({
      issueKey: selection.issueKey,
      pullRequestNumber: selection.pullRequest.number,
      observedSha: selection.observedSha,
      review: selection.actual.review.decision,
      test: selection.actual.test.decision,
      waivers: selection.waivers,
    }),
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  const messages = error instanceof WorkflowValidationError ? error.errors : [error.message];
  process.stderr.write(`${redactText(messages.join("\n"))}\n`);
  process.exitCode = 1;
}
