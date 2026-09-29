import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { run, runCommand as runSetupCommand } from "../.agents/skills/corch-development-workflow/scripts/lib/command-execution.mjs";
import { fixture, write, command } from "./helpers.mjs";

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

test("bounded logs preserve UTF-8 characters split across stdout and stderr chunks", () => fixture(({ root }) => {
  const script = path.join(root, "utf8.cjs");
  write(script, "const stream=process[process.argv[2]]; const output=Buffer.from('ação café\\n'); stream.write(output.subarray(0,2)); setTimeout(()=>stream.end(output.subarray(2)),80);");
  for (const stream of ["stdout", "stderr"]) {
    const result = command(root, process.execPath, [boundedScript, "--issue", "TASK-42", "--name", `utf8-${stream}`, "--", process.execPath, script, stream]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, "PASS");
    assert.equal(readFileSync(path.join(root, summary.logPath), "utf8"), "ação café\n");
  }
}));

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

test("bounded timeout and interruption clean up their command tree and preserve unrelated processes", () => fixture(async ({ root }) => {
  const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", windowsHide: true });
  const closed = new Promise((resolve) => unrelated.once("close", resolve));
  const treeFile = path.join(root, "tree.cjs");
  write(treeFile, "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); require('node:fs').writeFileSync(process.argv[2],JSON.stringify([process.pid,child.pid])); setInterval(()=>{},1000);");
  const launcher = path.join(root, "interrupt.mjs");
  write(launcher, "import {existsSync} from 'node:fs'; import {pathToFileURL} from 'node:url'; const ready=process.argv[2]; process.argv=[process.execPath,...process.argv.slice(3)]; const timer=setInterval(()=>{if(existsSync(ready)){clearInterval(timer);process.emit('SIGTERM');}},20); try {await import(pathToFileURL(process.argv[1]));} finally {clearInterval(timer);}");
  try {
    for (const mode of ["timeout", "interrupt"]) {
      const pidsFile = path.join(root, `${mode}.json`);
      const args = [boundedScript, "--issue", "TASK-42", "--name", mode, "--timeout-ms", mode === "timeout" ? "1200" : "8000", "--", process.execPath, treeFile, pidsFile];
      const result = command(root, process.execPath, mode === "timeout" ? args : [launcher, pidsFile, ...args]);
      assert.notEqual(result.status, 0, result.stdout);
      const summary = JSON.parse(result.stdout);
      assert.equal(summary.status, "FAIL");
      assert.match(summary.failureTail, mode === "timeout" ? /timed out/ : /interrupted/);
      for (const pid of JSON.parse(readFileSync(pidsFile))) assert.throws(() => process.kill(pid, 0), /ESRCH/);
      assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    }
  } finally {
    unrelated.kill();
    await closed;
  }
}));
