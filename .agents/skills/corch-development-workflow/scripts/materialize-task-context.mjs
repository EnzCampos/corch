#!/usr/bin/env node
import { ISSUE_PATTERN } from "./lib/workflow-config.mjs";

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { WorkflowValidationError, parseJsonDocument, redactText } from "./lib/validation.mjs";
import { buildTaskContextMarkdown, normalizeTaskContextSnapshot } from "./lib/task-context.mjs";

function usage() {
  return `Materialize the coordinator-owned ignored task-context Markdown cache.

Usage:
  node materialize-task-context.mjs stage --issue TASK-N
  node materialize-task-context.mjs hydrate --issue TASK-N --worktree <absolute-path>

stage reads task-context/v3 JSON from standard input and writes the ignored
shared primary-checkout cache before Worker creation. hydrate copies that
verified shared cache into the Planner/Worker linked worktree without stdin.`;
}

function contextMarker(markdown, issueKey) {
  const marker = `<!-- corch-task-context:v3 issue=${issueKey} -->`;
  return markdown.startsWith(marker) ? marker : undefined;
}

function parseArguments(argv) {
  if (argv[0] === "--help" || argv[0] === "-h") return { help: true };
  const args = { command: argv[0] };
  if (!["stage", "hydrate"].includes(args.command)) {
    throw new WorkflowValidationError(["select stage or hydrate"]);
  }
  for (let index = 1; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--help" || current === "-h") {
      args.help = true;
    } else if (current === "--issue") {
      args.issueKey = argv[++index];
    } else if (current === "--worktree") {
      args.worktree = argv[++index];
    } else {
      throw new WorkflowValidationError([`unknown argument: ${current}`]);
    }
  }
  if (!args.help && !ISSUE_PATTERN.test(args.issueKey ?? "")) {
    throw new WorkflowValidationError([
      "--issue must match the configured issue prefix and a positive number",
    ]);
  }
  if (args.worktree !== undefined && !path.isAbsolute(args.worktree)) {
    throw new WorkflowValidationError(["--worktree must be an absolute path"]);
  }
  if (args.command === "hydrate" && !args.worktree) {
    throw new WorkflowValidationError(["hydrate requires --worktree"]);
  }
  if (args.command === "stage" && args.worktree) {
    throw new WorkflowValidationError(["stage does not accept --worktree"]);
  }
  return args;
}

function git(cwd, args, { optional = false } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) {
    if (optional) {
      return undefined;
    }
    throw new WorkflowValidationError([
      redactText(result.stderr || `git ${args[0]} failed`).trim(),
    ]);
  }
  return result.stdout.trim();
}

async function readStandardInput() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function assertRepositoryIdentity(currentRoot, targetRoot) {
  const currentCommon = realpathSync(
    path.resolve(
      currentRoot,
      git(currentRoot, ["rev-parse", "--git-common-dir"]),
    ),
  );
  const targetCommon = realpathSync(
    path.resolve(
      targetRoot,
      git(targetRoot, ["rev-parse", "--git-common-dir"]),
    ),
  );
  if (currentCommon !== targetCommon) {
    throw new WorkflowValidationError([
      "--worktree must belong to the current repository",
    ]);
  }
}

function assertIgnoredAndUntracked(root, relativePath) {
  if (
    git(root, ["check-ignore", "-q", "--", relativePath], {
      optional: true,
    }) === undefined
  ) {
    const check = spawnSync("git", ["check-ignore", "-q", "--", relativePath], {
      cwd: root,
      shell: false,
      windowsHide: true,
    });
    if (check.status !== 0) {
      throw new WorkflowValidationError([`${relativePath} must be ignored`]);
    }
  }
  const tracked = spawnSync(
    "git",
    ["ls-files", "--error-unmatch", "--", relativePath],
    {
      cwd: root,
      shell: false,
      windowsHide: true,
    },
  );
  if (tracked.status === 0) {
    throw new WorkflowValidationError([
      `${relativePath} must never be tracked`,
    ]);
  }
}

function materialBytes(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("- Status at retrieval: "))
    .filter((line) => !line.startsWith("- Source updated: "))
    .filter((line) => !line.startsWith("- Retrieved: "))
    .join("\n");
}

function writeAtomically(targetPath, content) {
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    writeFileSync(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    renameSync(temporaryPath, targetPath);
  } finally {
    if (existsSync(temporaryPath)) {
      rmSync(temporaryPath);
    }
  }
}

function sharedRepositoryRoot(checkoutRoot) {
  const commonDirectory = path.resolve(
    checkoutRoot,
    git(checkoutRoot, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]),
  );
  return path.dirname(commonDirectory);
}

function writeMarkdownCache(targetRoot, issueKey, markdown) {
  const relativePath = `.agents/task-context/${issueKey}.md`;
  assertIgnoredAndUntracked(targetRoot, relativePath);
  const agentsDirectory = path.join(targetRoot, ".agents");
  if (!existsSync(agentsDirectory)) {
    mkdirSync(agentsDirectory);
  }
  if (lstatSync(agentsDirectory).isSymbolicLink()) {
    throw new WorkflowValidationError([".agents must not be a symlink"]);
  }
  const contextDirectory = path.join(agentsDirectory, "task-context");
  if (!existsSync(contextDirectory)) {
    mkdirSync(contextDirectory);
  }
  const contextStat = lstatSync(contextDirectory);
  if (!contextStat.isDirectory() || contextStat.isSymbolicLink()) {
    throw new WorkflowValidationError([
      ".agents/task-context must be a real directory",
    ]);
  }
  const targetPath = path.join(contextDirectory, `${issueKey}.md`);
  if (existsSync(targetPath)) {
    const targetStat = lstatSync(targetPath);
    if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
      throw new WorkflowValidationError([
        "task-context target must be a regular file",
      ]);
    }
    const existing = readFileSync(targetPath, "utf8");
    if (!contextMarker(existing, issueKey)) {
      throw new WorkflowValidationError([
        "existing task-context has an incompatible schema or issue",
      ]);
    }
    if (materialBytes(existing) === materialBytes(markdown)) {
      return {
        status: "unchanged-material-context",
        issueKey,
        targetPath: relativePath,
      };
    }
  }
  writeAtomically(targetPath, markdown);
  return { status: "materialized", issueKey, targetPath: relativePath };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const currentRoot = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  if (args.command === "hydrate") {
    const targetRoot = git(path.resolve(args.worktree), [
      "rev-parse",
      "--show-toplevel",
    ]);
    assertRepositoryIdentity(currentRoot, targetRoot);
    const sharedPath = path.join(
      sharedRepositoryRoot(currentRoot),
      ".agents",
      "task-context",
      `${args.issueKey}.md`,
    );
    if (!existsSync(sharedPath)) {
      throw new WorkflowValidationError(["shared task-context is not staged"]);
    }
    const stat = lstatSync(sharedPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new WorkflowValidationError([
        "shared task-context must be a regular file",
      ]);
    }
    const markdown = readFileSync(sharedPath, "utf8");
    if (!contextMarker(markdown, args.issueKey)) {
      throw new WorkflowValidationError([
        "shared task-context identity is invalid",
      ]);
    }
    process.stdout.write(
      `${JSON.stringify(writeMarkdownCache(targetRoot, args.issueKey, markdown), null, 2)}\n`,
    );
    return;
  }
  const snapshot = normalizeTaskContextSnapshot(
    parseJsonDocument(await readStandardInput()),
  );
  if (snapshot.issue.key !== args.issueKey) {
    throw new WorkflowValidationError([
      "task-context issue does not match --issue",
    ]);
  }
  const targetRoot = sharedRepositoryRoot(currentRoot);
  assertRepositoryIdentity(currentRoot, targetRoot);
  const result = writeMarkdownCache(
    targetRoot,
    args.issueKey,
    buildTaskContextMarkdown(snapshot),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  const messages =
    error instanceof WorkflowValidationError ? error.errors : [error.message];
  process.stderr.write(`${redactText(messages.join("\n"))}\n`);
  process.exitCode = 1;
});
