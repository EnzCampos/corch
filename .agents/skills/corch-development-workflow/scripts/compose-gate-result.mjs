#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  WorkflowValidationError,
  composeGateResult,
  parseJsonDocument,
  redactText,
} from "./workflow-lib.mjs";

function usage() {
  return `Compose a compact correction amendment into a complete v2 gate result.

Usage:
  node compose-gate-result.mjs --role reviewer|tester --base <result.json> --amendment <amendment.json> [--output <result.json>]

The base must be a valid review-result/v2 or test-result/v2. The amendment must
explicitly update or carry forward every prior acceptance criterion. Without
--output the complete result is written to standard output. With --output it is
created directly at .agents/evidence/<issue>/<sha>/<role>-result.json; the target
must not already exist.`;
}

function parseArguments(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--help" || current === "-h") args.help = true;
    else if (current === "--role") args.role = argv[++index];
    else if (current === "--base") args.basePath = argv[++index];
    else if (current === "--amendment") args.amendmentPath = argv[++index];
    else if (current === "--output") args.outputPath = argv[++index];
    else throw new WorkflowValidationError([`unknown argument: ${current}`]);
  }
  if (
    !args.help &&
    (!new Set(["reviewer", "tester"]).has(args.role) ||
      !args.basePath ||
      !args.amendmentPath)
  ) {
    throw new WorkflowValidationError([
      "--role, --base, and --amendment are required",
    ]);
  }
  return args;
}

function expectedOutputPath(result, role) {
  const filename =
    role === "reviewer" ? "review-result.json" : "test-result.json";
  return path.resolve(
    `.agents/evidence/${result.issueKey}/${result.observedSha}/${filename}`,
  );
}

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
  } else {
    const base = parseJsonDocument(readFileSync(args.basePath, "utf8"));
    const amendment = parseJsonDocument(
      readFileSync(args.amendmentPath, "utf8"),
    );
    const result = composeGateResult(args.role, base, amendment);
    const document = `${JSON.stringify(result, null, 2)}\n`;
    if (args.outputPath) {
      const outputPath = path.resolve(args.outputPath);
      if (outputPath !== expectedOutputPath(result, args.role)) {
        throw new WorkflowValidationError([
          `--output must be .agents/evidence/${result.issueKey}/${result.observedSha}/${args.role === "reviewer" ? "review" : "test"}-result.json`,
        ]);
      }
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, document, { encoding: "utf8", flag: "wx" });
      process.stdout.write(
        `${JSON.stringify({ status: "written", path: path.relative(process.cwd(), outputPath).replaceAll("\\", "/") })}\n`,
      );
    } else {
      process.stdout.write(document);
    }
  }
} catch (error) {
  const messages =
    error instanceof WorkflowValidationError ? error.errors : [error.message];
  process.stderr.write(`${redactText(messages.join("\n"))}\n`);
  process.exitCode = 1;
}
