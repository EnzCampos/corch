import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../.agents/skills/corch-development-workflow/scripts/lib/workflow-config.mjs";

export const scripts = fileURLToPath(new URL("../.agents/skills/corch-development-workflow/scripts/", import.meta.url));
export function write(target, value) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value));
}
export function command(cwd, executable, args, options = {}) {
  return spawnSync(executable, args, { cwd, encoding: "utf8", windowsHide: true, timeout: 20_000, ...options });
}
export function git(cwd, ...args) {
  const result = command(cwd, "git", args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
export function workItem(overrides = {}) {
  return { summary: "Fixture change", outcome: "Observable fixture behavior",
    acceptance: [{ id: "AC-1", text: "The changed behavior is verified" }],
    userDecisions: [], constraints: [], sourceRef: null, dependencies: [], ...overrides };
}
export function delivery(issue = "TASK-42", overrides = {}) {
  return { repository: CONFIG.repository, remoteUrl: `https://github.com/${CONFIG.repository}.git`,
    baseBranch: CONFIG.baseBranch, headBranch: `corch/${issue.toLowerCase()}-fixture`,
    pullRequest: null, evidenceDestination: null, allowedOperations: [], ...overrides };
}
export async function fixture(action, config = CONFIG) {
  const root = mkdtempSync(path.join(os.tmpdir(), "corch fixture-"));
  try {
    git(root, "init", "--quiet", "-b", config.baseBranch);
    git(root, "config", "user.name", "Fixture");
    git(root, "config", "user.email", "fixture@example.test");
    git(root, "remote", "add", "origin", `https://github.com/${config.repository}.git`);
    write(path.join(root, ".gitignore"), ".agents/task-state/\n.agents/evidence/\n.agents/task-context/\nnode_modules/\n");
    const configPath = path.join(root, ".agents/workflow.json");
    write(configPath, config);
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "fixture");
    const invoke = (args, { cwd = root, input, env = {} } = {}) => command(cwd, process.execPath,
      [path.join(scripts, "task-state.mjs"), ...args], {
        input: input === undefined ? undefined : JSON.stringify(input),
        env: { ...process.env, CORCH_CONFIG: configPath, ...env },
      });
    const state = (commandName, args = [], options = {}) => {
      const result = invoke([commandName, "--issue", "TASK-42", ...args], options);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    await action({ root, configPath, invoke, state });
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
