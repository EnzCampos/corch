#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
  WorkflowValidationError,
  buildDeliveryTaskDispatch,
  parseJsonDocument,
  redactText,
  validateWorkerBootstrap,
} from "./workflow-lib.mjs";

function usage() {
  return `Validate worker-bootstrap/v2 and emit Planner-first delivery prompts and runtime.

Usage:
  node prepare-worker-bootstrap.mjs --role planner --coordinator <task-id> < bootstrap.json
  node prepare-worker-bootstrap.mjs --role worker --plan-revision N < bootstrap.json

Planner is the default. Worker dispatch is only for an already approved saved plan;
the Coordinator verifies that approval before dispatch.
Output contains title, prompt and explicit model/thinking for task creation or continuation.`;
}

try {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
  } else {
    const args = process.argv.slice(2);
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      const key = {
        "--role": "role",
        "--coordinator": "coordinator",
        "--plan-revision": "planRevision",
      }[args[index]];
      if (!key || !args[index + 1] || args[index + 1].startsWith("--")) {
        throw new WorkflowValidationError([
          `unknown or incomplete argument: ${args[index]}`,
        ]);
      }
      options[key] =
        key === "planRevision" ? Number(args[index + 1]) : args[index + 1];
    }
    const value = validateWorkerBootstrap(
      parseJsonDocument(readFileSync(0, "utf8")),
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          schemaVersion: value.schemaVersion,
          issueKey: value.issue.key,
          ...buildDeliveryTaskDispatch(value, options),
        },
        null,
        2,
      )}\n`,
    );
  }
} catch (error) {
  const messages =
    error instanceof WorkflowValidationError ? error.errors : [error.message];
  process.stderr.write(`${redactText(messages.join("\n"))}\n`);
  process.exitCode = 1;
}
