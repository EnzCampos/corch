#!/usr/bin/env node

import {
  WorkflowValidationError,
  assessDeliveryPreflight,
  parseJsonDocument,
  redactText,
} from "./workflow-lib.mjs";

function usage() {
  return `Assess normalized work-item delivery dependencies before creating Workers.

Usage:
  node assess-delivery-preflight.mjs [--help]

Read one delivery-preflight/v1 JSON document from standard input. Include every
selected issue and every issue it references as a delivery dependency. The
result lists runnable issues, blocked issues, already-complete issues, and the
pairs that may run concurrently.`;
}

async function readStandardInput() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (args.length > 0) {
    throw new WorkflowValidationError([`unknown argument: ${args[0]}`]);
  }
  const result = assessDeliveryPreflight(
    parseJsonDocument(await readStandardInput()),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  const messages =
    error instanceof WorkflowValidationError ? error.errors : [error.message];
  process.stderr.write(`${redactText(messages.join("\n"))}\n`);
  process.exitCode = 1;
});
