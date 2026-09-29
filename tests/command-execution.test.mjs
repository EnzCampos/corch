import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { run, runSetupCommand } from "../.agents/skills/corch-development-workflow/scripts/prepare-worker-worktree.mjs";

const boundedScript = fileURLToPath(new URL(
  "../.agents/skills/corch-development-workflow/scripts/run-bounded-check.mjs",
  import.meta.url,
));

test("bounded npm checks support script names and checkout paths containing spaces", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "corch commands with spaces-"));
  try {
    const git = spawnSync("git", ["init", "--quiet"], {
      cwd: root, encoding: "utf8", windowsHide: true, timeout: 10_000,
    });
    assert.equal(git.status, 0, git.stderr);
    writeFileSync(path.join(root, "package.json"), JSON.stringify({
      private: true,
      scripts: { "verify:ci": "node check.cjs", "test:failure": "node failure.cjs" },
    }));
    writeFileSync(path.join(root, "check.cjs"), "console.log('fixture passed');");
    writeFileSync(path.join(root, "failure.cjs"),
      "console.error('token=' + 'x'.repeat(30)); process.exit(7);");
    const invoke = (args) => spawnSync(process.execPath, [
      boundedScript, "--issue", "TASK-42", "--name", "npm-check", "--", "npm", ...args,
    ], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 15_000 });
    for (const args of [["--version"], ["run", "verify:ci"]]) {
      const result = invoke(args);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const summary = JSON.parse(result.stdout);
      assert.equal(summary.status, "PASS");
      assert.equal(summary.exitCode, 0);
      assert.match(readFileSync(path.join(root, summary.logPath), "utf8"),
        args[0] === "run" ? /fixture passed/ : /\d+\.\d+\.\d+/);
    }
    // The asynchronous bootstrap uses the same allowed script-name characters.
    const setup = await runSetupCommand("npm", ["run", "verify:ci"], {
      cwd: root, timeoutMs: 15_000,
    });
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    assert.match(setup.stdout, /fixture passed/);
    const failure = invoke(["run", "test:failure"]);
    assert.equal(failure.status, 7, failure.stderr || failure.stdout);
    const summary = JSON.parse(failure.stdout);
    assert.equal(summary.status, "FAIL");
    assert.equal(summary.exitCode, 7);
    assert.doesNotMatch(failure.stdout, /x{30}/);
    assert.doesNotMatch(readFileSync(path.join(root, summary.logPath), "utf8"), /x{30}/);
    if (process.platform === "win32") {
      const logBefore = readFileSync(path.join(root, summary.logPath), "utf8");
      const rejected = invoke(["run", "verify:ci", "&"]);
      assert.equal(rejected.status, 1);
      assert.match(rejected.stderr, /Unsupported Corepack argument/);
      assert.equal(rejected.stdout, "");
      assert.equal(readFileSync(path.join(root, summary.logPath), "utf8"), logBefore);
    }
    assert.equal(existsSync(path.join(root, ".agents/task-state/worktree-bootstrap.json")), false);
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("Windows package-manager arguments reject shell syntax before execution", {
  skip: process.platform !== "win32",
}, () => {
  const unsafe = ["two words", '"quoted"', "a&b", "a|b", "a>b", "a<b",
    "a^b", "%PATH%", "!PATH!", "a\nb", "a\rb", "a\tb"];
  for (const command of ["npm", "pnpm", "corepack"]) {
    for (const arg of unsafe) {
      assert.throws(() => run(command, [arg]), /Unsupported Corepack argument/);
      assert.throws(() => runSetupCommand(command, [arg]), /Unsupported Corepack argument/);
    }
  }
});
