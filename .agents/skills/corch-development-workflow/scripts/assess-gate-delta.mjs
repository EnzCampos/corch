#!/usr/bin/env node

import { spawnSync } from "node:child_process";

import { WorkflowValidationError, redactText } from "./workflow-lib.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/;

function usage() {
  return `Assess topology and record a proportional follow-up for an existing gate.

Usage:
  node assess-gate-delta.mjs --role review|test --from <40-hex> --to <40-hex> \\
    --impact irrelevant|affected|material --rationale <text>

The helper verifies local commit topology and lists the changed paths. Impact
is a documented Worker/role judgment: irrelevant carries the verdict forward,
affected requests a targeted delta, and material requests a coherent recheck.
Non-descendant history always requires a coherent recheck.`;
}

function parseArguments(argv) {
  const args = { acceptanceFocus: [], priorFindingIds: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--help" || current === "-h") {
      args.help = true;
    } else if (current === "--role") {
      args.role = argv[++index];
    } else if (current === "--from") {
      args.fromSha = argv[++index];
    } else if (current === "--to") {
      args.toSha = argv[++index];
    } else if (current === "--impact") {
      args.impact = argv[++index];
    } else if (current === "--rationale") {
      args.rationale = argv[++index];
    } else if (current === "--acceptance") {
      args.acceptanceFocus.push(argv[++index]);
    } else if (current === "--finding") {
      args.priorFindingIds.push(argv[++index]);
    } else {
      throw new WorkflowValidationError([`unknown argument: ${current}`]);
    }
  }
  if (args.help) {
    return args;
  }
  const errors = [];
  if (!new Set(["review", "test"]).has(args.role)) {
    errors.push("--role must be review or test");
  }
  if (
    !SHA_PATTERN.test(args.fromSha ?? "") ||
    !SHA_PATTERN.test(args.toSha ?? "")
  ) {
    errors.push("--from and --to must be lowercase full SHAs");
  }
  if (!new Set(["irrelevant", "affected", "material"]).has(args.impact)) {
    errors.push("--impact must be irrelevant, affected, or material");
  }
  if (typeof args.rationale !== "string" || args.rationale.trim().length < 12) {
    errors.push("--rationale must explain the impact judgment");
  }
  if (errors.length > 0) {
    throw new WorkflowValidationError(errors);
  }
  return args;
}

function git(args, { allowStatus } = {}) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (allowStatus) {
    return result;
  }
  if (result.status !== 0) {
    throw new WorkflowValidationError([
      redactText(result.stderr.trim() || `git ${args[0]} failed`),
    ]);
  }
  return result.stdout.trim();
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  git(["rev-parse", "--show-toplevel"]);
  git(["cat-file", "-e", `${args.fromSha}^{commit}`]);
  git(["cat-file", "-e", `${args.toSha}^{commit}`]);
  const sameCommit = args.fromSha === args.toSha;
  const ancestry = sameCommit
    ? { status: 0 }
    : git(["merge-base", "--is-ancestor", args.fromSha, args.toSha], {
        allowStatus: true,
      });
  const descendant = ancestry.status === 0;
  const rewrittenHistory = !descendant;
  const changedFiles = sameCommit
    ? []
    : git([
        "diff",
        "--name-only",
        "--diff-filter=ACMRD",
        args.fromSha,
        args.toSha,
        "--",
      ])
        .split(/\r?\n/)
        .filter(Boolean);
  const statistics = sameCommit
    ? []
    : git(["diff", "--numstat", args.fromSha, args.toSha, "--"])
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const [additions, deletions, ...fileParts] = line.split("\t");
          return {
            path: fileParts.join("\t"),
            additions: additions === "-" ? null : Number(additions),
            deletions: deletions === "-" ? null : Number(deletions),
          };
        });
  let action;
  if (sameCommit || (descendant && args.impact === "irrelevant")) {
    action = "carry-forward";
  } else if (rewrittenHistory || args.impact === "material") {
    action = "coherent-recheck";
  } else {
    action = "targeted-delta";
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "gate-delta-assessment/v1",
        status: "assessed",
        role: args.role,
        fromSha: args.fromSha,
        toSha: args.toSha,
        comparisonRange: `${args.fromSha}..${args.toSha}`,
        descendant,
        rewrittenHistory,
        impact: args.impact,
        rationale: args.rationale.trim(),
        action,
        changedFiles,
        statistics,
        acceptanceFocus: args.acceptanceFocus.filter(Boolean),
        priorFindingIds: [...new Set(args.priorFindingIds.filter(Boolean))],
        requestedResult:
          action === "targeted-delta"
            ? `${args.role}-amendment/v1`
            : `${args.role}-result/v2`,
      },
      null,
      2,
    )}\n`,
  );
}

try {
  main();
} catch (error) {
  const messages =
    error instanceof WorkflowValidationError ? error.errors : [error.message];
  process.stderr.write(`${redactText(messages.join("\n"))}\n`);
  process.exitCode = 1;
}
