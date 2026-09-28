#!/usr/bin/env node
import { REPOSITORY, BASE_BRANCH } from "./workflow-config.mjs";
import { isHttpsUrl } from "./task-source.mjs";


import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  WorkflowValidationError,
  buildPullRequestCommentMarker,
  parseJsonDocument,
  redactText,
  validateGateResult,
  validateGateSelection,
  validateReadyHandoff,
  waiverSummaryLines,
} from "./workflow-lib.mjs";

function usage() {
  return `Prepare a text-only GitHub PR Conversation comment.

Usage:
  node prepare-pr-comment.mjs --issue TASK-N --pr N --gate review|test|handoff \\
    --head-branch codex/task-n-<slug> --result <json-path> \\
    [--evidence-url <https-url>]

The output contains a marker and Markdown body for the installed GitHub
connector API. It never emits upload paths, requires browser/UI interaction, or
requires GitHub-native evidence attachments.`;
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
    } else if (current === "--gate") {
      args.gate = argv[++index];
    } else if (current === "--head-branch") {
      args.headBranch = argv[++index];
    } else if (current === "--result") {
      args.resultPath = argv[++index];
    } else if (current === "--evidence-url") {
      args.evidenceUrl = argv[++index];
      if (args.evidenceUrl === undefined) throw new WorkflowValidationError(["--evidence-url requires a credential-free HTTPS URL"]);
    } else {
      throw new WorkflowValidationError([`unknown argument: ${current}`]);
    }
  }
  if (args.help) {
    return args;
  }
  const missing = [
    "issueKey", "pullRequestNumber", "gate", "headBranch", "resultPath",
  ].filter((field) => !args[field]);
  if (missing.length > 0) {
    throw new WorkflowValidationError([`missing arguments: ${missing.join(", ")}`]);
  }
  if (!new Set(["review", "test", "handoff"]).has(args.gate)) {
    throw new WorkflowValidationError(["--gate must be review, test, or handoff"]);
  }
  if (args.evidenceUrl !== undefined && !isHttpsUrl(args.evidenceUrl)) {
    throw new WorkflowValidationError(["--evidence-url must be a credential-free HTTPS URL"]);
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
    throw new WorkflowValidationError(["PR comment preparation requires a Git repository"]);
  }
  return result.stdout.trim();
}

function bulletAcceptance(acceptance) {
  return acceptance.map((item) => `- **${item.status}** — ${item.criterion}: ${item.evidence}`).join("\n");
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const root = gitRoot();
  const raw = parseJsonDocument(readFileSync(path.resolve(root, args.resultPath), "utf8"));
  let model;
  let verdict;
  let route;
  if (args.gate === "handoff") {
    model = validateGateSelection(raw, {
      issueKey: args.issueKey,
      repository: REPOSITORY,
      pullRequestNumber: args.pullRequestNumber,
      headBranch: args.headBranch,
      baseBranch: BASE_BRANCH,
    });
    validateReadyHandoff(model);
    verdict = `READY FOR HUMAN REVIEW${model.waivers?.length ? " WITH EXPLICIT CHECK WAIVERS" : ""}`;
    route = model.outcomes
      ? [
        `Reviewer: **${model.outcomes.review.status}** — ${model.outcomes.review.summary}`,
        `Tester: **${model.outcomes.test.status}** — ${model.outcomes.test.summary}`,
        `CI: **${model.outcomes.ci.status}** — ${model.outcomes.ci.summary}`
          + (model.outcomes.ci.runUrl ? ` — [GitHub Actions run](${model.outcomes.ci.runUrl})` : ""),
      ].join("\n\n")
      : [
        `Reviewer: **${model.actual.review.decision}** — ${model.actual.review.rationale}`,
        `Tester: **${model.actual.test.decision}** — ${model.actual.test.rationale}`,
      ].join("\n\n");
  } else {
    model = validateGateResult(args.gate === "review" ? "reviewer" : "tester", raw, {
      issueKey: args.issueKey,
      repository: REPOSITORY,
      pullRequestNumber: args.pullRequestNumber,
      headBranch: args.headBranch,
      baseBranch: BASE_BRANCH,
    });
    verdict = model.verdict;
  }
  const marker = buildPullRequestCommentMarker({
    issueKey: model.issueKey,
    pullRequestNumber: model.pullRequest.number,
    observedSha: model.observedSha,
    gate: args.gate,
    waivers: model.waivers,
  });
  const findings = model.findings ?? model.failures ?? [];
  const body = [
    marker,
    "",
    `## ${model.issueKey}: ${verdict}`,
    "",
    `Observed commit: \`${model.observedSha}\``,
    "",
    model.summary,
    ...(route ? ["", route] : []),
    ...(args.gate === "handoff" && model.commands.length > 0 ? [
      "", "### Validation commands", "",
      ...model.commands.map((item) => `- **${item.status}** — ${item.command}: ${item.summary}`),
    ] : []),
    ...(model.waivers?.length ? [
      "", "### Explicit check waivers and confidence gaps", "",
      ...waiverSummaryLines(model).map((line) => `- ${line}`),
    ] : []),
    "",
    "### Acceptance",
    "",
    bulletAcceptance(model.acceptance),
    ...(findings.length > 0 ? [
      "",
      `### ${model.findings ? "Findings" : "Failures"}`,
      "",
      ...findings.map((item) => `- **${item.id}: ${item.title}** — ${item.evidence}`),
    ] : []),
    "",
    args.evidenceUrl
      ? `Full evidence and attachments: [Delivery evidence](${args.evidenceUrl})`
      : "Evidence is retained in local task artifacts; the acceptance and validation results are summarized above.",
  ].join("\n");
  process.stdout.write(`${JSON.stringify({
    status: "ready",
    marker,
    body,
    evidenceUrl: args.evidenceUrl ?? null,
    nativeUploads: [],
    browserRequired: false,
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  const messages = error instanceof WorkflowValidationError ? error.errors : [error.message];
  process.stderr.write(`${redactText(messages.join("\n"))}\n`);
  process.exitCode = 1;
}
