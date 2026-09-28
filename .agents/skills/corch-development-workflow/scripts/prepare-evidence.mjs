#!/usr/bin/env node
import { REPOSITORY, BASE_BRANCH } from "./workflow-config.mjs";


import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  WorkflowValidationError,
  artifactMetadata,
  buildGateSelectionMarker,
  buildIdempotencyMarker,
  buildEvidenceComment,
  parseJsonDocument,
  redactText,
  resolveEvidenceFiles,
  resultArtifactPaths,
  validateEvidenceProfile,
  validateGateResult,
  validateGateSelection,
  validateReadyHandoff,
  validateHandoffEvidence,
  validateUniqueLogicalEvidenceFilenames,
} from "./workflow-lib.mjs";

function usage() {
  return `Prepare sanitized gate or handoff evidence for local review or an authorized destination.

Usage:
  node prepare-evidence.mjs --issue TASK-N --pr N \\
    --gate review|test|handoff --head-branch codex/task-n-<slug> \\
    --profile frontend|backend|mixed|general --result <json-path> [--dry-run]

Artifacts are selected by captioned entries in the result document and must
remain under .agents/evidence/<issue>/<observedSha>/. This helper performs no
network requests, reads no credentials, and uploads nothing. Keep its commentBody
locally, or pass it to an authorized destination after checking the marker for
idempotency. An external tracker or comment URL is not required.`;
}

function parseArguments(argv) {
  const args = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--help" || current === "-h") {
      args.help = true;
    } else if (current === "--dry-run") {
      args.dryRun = true;
    } else if (current === "--issue") {
      args.issueKey = argv[++index];
    } else if (current === "--pr") {
      args.pullRequestNumber = Number(argv[++index]);
    } else if (current === "--gate") {
      args.gate = argv[++index];
    } else if (current === "--head-branch") {
      args.headBranch = argv[++index];
    } else if (current === "--profile") {
      args.profile = argv[++index];
    } else if (current === "--result") {
      args.resultPath = argv[++index];
    } else {
      throw new WorkflowValidationError([`unknown argument: ${current}`]);
    }
  }
  if (args.help) {
    return args;
  }
  const missing = ["issueKey", "pullRequestNumber", "gate", "headBranch", "profile", "resultPath"]
    .filter((field) => !args[field]);
  if (missing.length > 0) {
    throw new WorkflowValidationError([`missing arguments: ${missing.join(", ")}`]);
  }
  if (!new Set(["review", "test", "handoff"]).has(args.gate)) {
    throw new WorkflowValidationError(["--gate must be review, test, or handoff"]);
  }
  if (!Number.isInteger(args.pullRequestNumber) || args.pullRequestNumber < 1) {
    throw new WorkflowValidationError(["--pr must be a positive integer"]);
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
    throw new WorkflowValidationError(["Evidence preparation requires a Git repository"]);
  }
  return result.stdout.trim();
}

function publicationModel(args, raw) {
  if (args.gate === "handoff") {
    const selection = validateGateSelection(raw, {
      issueKey: args.issueKey,
      repository: REPOSITORY,
      pullRequestNumber: args.pullRequestNumber,
      headBranch: args.headBranch,
      baseBranch: BASE_BRANCH,
    });
    validateReadyHandoff(selection);
    return {
      ...selection,
      verdict: "READY",
      marker: buildGateSelectionMarker({
        issueKey: selection.issueKey,
        pullRequestNumber: selection.pullRequest.number,
        observedSha: selection.observedSha,
        review: selection.actual.review.decision,
        test: selection.actual.test.decision,
        waivers: selection.waivers,
      }),
    };
  }
  const role = args.gate === "review" ? "reviewer" : "tester";
  const result = validateGateResult(role, raw, {
    issueKey: args.issueKey,
    repository: REPOSITORY,
    pullRequestNumber: args.pullRequestNumber,
    headBranch: args.headBranch,
    baseBranch: BASE_BRANCH,
  });
  return {
    ...result,
    marker: buildIdempotencyMarker({
      schemaVersion: result.schemaVersion,
      issueKey: result.issueKey,
      observedSha: result.observedSha,
      gate: args.gate,
    }),
  };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const root = gitRoot();
  const model = publicationModel(
    args,
    parseJsonDocument(readFileSync(path.resolve(root, args.resultPath), "utf8")),
  );
  const metadata = artifactMetadata(model);
  const evidence = resolveEvidenceFiles({
    repositoryRoot: root,
    issueKey: model.issueKey,
    observedSha: model.observedSha,
    files: resultArtifactPaths(model),
    metadata,
  });
  validateUniqueLogicalEvidenceFilenames(evidence);
  if (args.gate === "handoff") {
    if (args.profile !== model.evidenceProfile) {
      throw new WorkflowValidationError(["handoff profile must match the gate selection"]);
    }
    validateHandoffEvidence(model, evidence);
  } else {
    validateEvidenceProfile(args.profile, evidence, { gate: args.gate, verdict: model.verdict });
  }
  const files = evidence.map((file, index) => {
    const sha256 = createHash("sha256").update(readFileSync(file.absolutePath)).digest("hex");
    const safeBasename = path.basename(file.suppliedPath).replace(/[^A-Za-z0-9._-]/g, "_").slice(-100);
    return {
      ...file,
      sha256,
      filename: `${model.issueKey}_${model.observedSha.slice(0, 12)}_${args.gate}_${index + 1}_${sha256.slice(0, 12)}_${safeBasename}`,
    };
  });
  const preparedFiles = files.map((file) => ({
    filename: file.filename,
    caption: file.caption,
    acceptanceCriteria: file.acceptanceCriteria,
    extension: file.extension,
    sha256: file.sha256,
    size: file.size,
  }));
  const commentBody = buildEvidenceComment({
    marker: model.marker,
    result: model,
    profile: args.profile,
    attachments: [],
    localArtifacts: preparedFiles,
    gate: args.gate,
  });
  process.stdout.write(`${JSON.stringify({
    status: args.dryRun ? "dry-run" : "prepared",
    marker: model.marker,
    result: model.schemaVersion,
    observedSha: model.observedSha,
    commentBody,
    files: preparedFiles,
    publication: { performed: false, destination: null },
  }, null, 2)}\n`);
}

main().catch((error) => {
  const messages = error instanceof WorkflowValidationError ? error.errors : [error.message];
  process.stderr.write(`${redactText(messages.join("\n"))}\n`);
  process.exitCode = 1;
});
