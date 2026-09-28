#!/usr/bin/env node


import {
  EXECUTION_ROUTE_RISK_SIGNALS,
  WorkflowValidationError,
  createExecutionRoute,
  redactText,
  workerThreadRuntimeArguments,
} from "./workflow-lib.mjs";

function usage() {
  return `Select the Worker runtime after design planning and emit execution-route/v2.

Usage:
  node select-execution-route.mjs --issue TASK-N \\
    --classification bounded|routine|standard|complex|high-risk|exceptional \\
    --rationale <text> [--signal <name>]... [--create-thread-args]

Supported signals:
  ${[...EXECUTION_ROUTE_RISK_SIGNALS].join("\n  ")}

The route is deterministic: bounded/routine use Luna xhigh, standard uses Luna
max, decision-complete complex uses Luna max, high-risk uses Sol high, and exceptional uses Sol
xhigh. Terra and every low-effort route are unsupported. --create-thread-args
emits the exact model/thinking object that must be passed to create_thread.`;
}

function parseArguments(argv) {
  if (argv[0] === "--help" || argv[0] === "-h") {
    return { help: true };
  }
  const args = { riskSignals: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--help" || current === "-h") {
      args.help = true;
    } else if (current === "--issue") {
      args.issueKey = argv[++index];
    } else if (current === "--classification") {
      args.classification = argv[++index];
    } else if (current === "--rationale") {
      args.rationale = argv[++index];
    } else if (current === "--signal") {
      args.riskSignals.push(argv[++index]);
    } else if (current === "--create-thread-args") {
      args.createThreadArguments = true;
    } else {
      throw new WorkflowValidationError([`unknown argument: ${current}`]);
    }
  }
  return args;
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const route = createExecutionRoute(args);
  const output = args.createThreadArguments
    ? workerThreadRuntimeArguments(route)
    : route;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  const messages = error instanceof WorkflowValidationError ? error.errors : [error.message];
  process.stderr.write(`${redactText(messages.join("\n"))}\n`);
  process.exitCode = 1;
}
