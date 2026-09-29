#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { readDeliveryState, buildWorkerContinuation, verifyWorkerCheckout } from "./lib/delivery-state.mjs";

import { WorkflowValidationError, parseJsonDocument, redactText } from "./lib/validation.mjs";
import { buildDeliveryTaskDispatch, validateExecutionRoute, validateWorkerBootstrap } from "./lib/bootstrap.mjs";

function usage() {
  return `Validate worker-bootstrap/v2 and emit Planner-first delivery prompts and runtime.

Usage:
  node prepare-worker-bootstrap.mjs --role planner --coordinator <task-id> < bootstrap.json
  node prepare-worker-bootstrap.mjs --role worker --plan-revision N --worktree <absolute-checkout> < bootstrap.json

Planner is the default. Record the route with task-state.mjs record-route first.
Both roles read the saved route in --worktree (default current directory).
Input may omit executionRoute; an embedded snapshot never overrides saved state.
Output includes the complete normalized bootstrap to stage before Planner launch,
plus title, prompt and explicit model/thinking. This helper writes no files.
Worker dispatch requires an approved saved plan, verified by the Coordinator.
Respect its returned eventKey/delivered marker before sending.`;
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
        "--worktree": "worktree",
      }[args[index]];
      if (!key || !args[index + 1] || args[index + 1].startsWith("--")) {
        throw new WorkflowValidationError([
          `unknown or incomplete argument: ${args[index]}`,
        ]);
      }
      options[key] =
        key === "planRevision" ? Number(args[index + 1]) : args[index + 1];
    }
    const raw = parseJsonDocument(readFileSync(0, "utf8"));
    if (Object.hasOwn(raw, "executionRoute")) {
      validateExecutionRoute(raw.executionRoute, { issueKey: raw.issue?.key });
    }
    const worktree = path.resolve(options.worktree ?? process.cwd());
    const state = readDeliveryState(worktree, raw.issue?.key);
    const value = validateWorkerBootstrap({ ...raw, executionRoute: state.executionRoute });
    let dispatch;
    if (options.role === "worker") {
      verifyWorkerCheckout(state, worktree);
      dispatch = buildWorkerContinuation(value, state, options.planRevision);
    } else dispatch = buildDeliveryTaskDispatch(value, options);
    process.stdout.write(
      `${JSON.stringify(
        {
          schemaVersion: value.schemaVersion,
          issueKey: value.issue.key,
          bootstrap: value,
          ...dispatch,
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
