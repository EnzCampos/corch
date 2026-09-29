import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import {
  CONFIG,
  validateConfig,
} from "../.agents/skills/corch-development-workflow/scripts/lib/workflow-config.mjs";

test("configuration rejects ambiguous destinations and escaping setup paths", () => {
  for (const change of [
    { repository: "owner/repo/extra" },
    { issuePrefix: "task/../" },
    { baseBranch: "main..other" },
    { baseBranch: "-main" },
    { localCiCommand: "npm test\nother" },
  ])
    assert.throws(
      () => validateConfig({ ...CONFIG, ...change }),
      /Invalid Corch configuration/,
    );
  for (const entry of [
    "../outside",
    "/tmp/outside",
    "C:/outside",
    "node_modules/../../outside",
  ]) {
    assert.throws(
      () =>
        validateConfig({
          ...CONFIG,
          setup: {
            steps: [
              {
                name: "install",
                command: "npm",
                args: ["ci"],
                inputs: [entry],
                outputs: [],
              },
            ],
          },
        }),
      /repository-relative/,
    );
  }
});

test("a different repository, base branch, project prefix and source reference work together", () => {
  const root = mkdtempSync(path.join(tmpdir(), "corch-config-"));
  try {
    const configPath = path.join(root, "workflow.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        ...CONFIG,
        repository: "sample-org/toolkit",
        issuePrefix: "OPS2",
        baseBranch: "develop",
        localCiCommand: "make check",
      }),
    );
    const runtimeDirectory = new URL(
      "../.agents/skills/corch-development-workflow/scripts/",
      import.meta.url,
    );
    const moduleUrl = (name) => new URL(name, runtimeDirectory).href;
    const script = `
      import assert from "node:assert/strict";
      import { createExecutionRoute, validateWorkerBootstrap, buildDeliveryTaskDispatch } from ${JSON.stringify(moduleUrl("./lib/bootstrap.mjs"))};
      import { redactText } from ${JSON.stringify(moduleUrl("./lib/validation.mjs"))};
      import { plannerLaunchFromPrompt } from ${JSON.stringify(moduleUrl("./prepare-worker-worktree.mjs"))};
      import { ISSUE_PATTERN, BRANCH_PATTERN, LOCAL_CI_COMMAND, CI_RUN_PATTERN } from ${JSON.stringify(moduleUrl("./lib/workflow-config.mjs"))};
      const issueKey = "OPS2-7";
      const branch = "codex/ops2-7-example";
      const sourceRef = "https://issues.example.test/browse/OPS2-7";
      const input = {
        schemaVersion: "worker-bootstrap/v2",
        issue: { key: issueKey, summary: "Example change", sourceRef },
        reservedBranch: branch, taskContextPath: ".agents/task-context/OPS2-7.md",
        executionRoute: createExecutionRoute({ issueKey, classification: "bounded", riskSignals: [], rationale: "A small local change." }),
        deliveryTarget: { repository: "sample-org/toolkit", remoteUrl: "https://github.com/sample-org/toolkit.git",
          baseBranch: "develop", headBranch: branch, push: true, draftPullRequest: true,
          readyForHumanReview: true, sourceRef: sourceRef },
      };
      validateWorkerBootstrap(input);
      const dispatch = buildDeliveryTaskDispatch(input, { coordinator: "fixture" });
      assert.deepEqual(plannerLaunchFromPrompt(dispatch.prompt), { issueKey, branch });
      assert.equal(LOCAL_CI_COMMAND, "make check");
      assert.equal(ISSUE_PATTERN.test("TASK-7"), false);
      assert.equal(BRANCH_PATTERN.test("codex/task-7-example"), false);
      assert.throws(() => validateWorkerBootstrap({ ...input, deliveryTarget: { ...input.deliveryTarget, baseBranch: "main" } }));
      const runUrl = "https://github.com/sample-org/toolkit/actions/runs/12345678901";
      assert.equal(CI_RUN_PATTERN.test(runUrl), true);
      assert.equal(CI_RUN_PATTERN.test(runUrl.replace("toolkit/", "other/")), false);
      assert.equal(redactText(runUrl), runUrl);
    `;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        encoding: "utf8",
        env: { ...process.env, CORCH_CONFIG: configPath },
        windowsHide: true,
        timeout: 20_000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("copied script trees discover adjacent configuration independently of cwd and honor CORCH_CONFIG", () => {
  const root = mkdtempSync(path.join(tmpdir(), "corch-installed-config-"));
  try {
    const scripts = path.join(root, "installed", ".agents", "skills", "corch-development-workflow", "scripts");
    cpSync(fileURLToPath(new URL("../.agents/skills/corch-development-workflow/scripts", import.meta.url)), scripts, { recursive: true });
    const localConfig = { ...CONFIG, repository: "installed/toolkit", issuePrefix: "INST", baseBranch: "develop" };
    writeFileSync(path.join(root, "installed", ".agents", "workflow.json"), JSON.stringify(localConfig));
    const override = path.join(root, "override.json");
    writeFileSync(override, JSON.stringify({ ...localConfig, repository: "overridden/toolkit" }));
    const cwd = path.join(root, "unrelated");
    mkdirSync(cwd);
    writeFileSync(path.join(cwd, "workflow.json"), "malformed config in cwd must not be loaded");
    for (const configured of [false, true]) {
      const env = { ...process.env };
      delete env.CORCH_CONFIG;
      if (configured) env.CORCH_CONFIG = override;
      const code = `import { CONFIG } from ${JSON.stringify(pathToFileURL(path.join(scripts, "lib", "workflow-config.mjs")).href)}; process.stdout.write(JSON.stringify(CONFIG));`;
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd, env, encoding: "utf8", windowsHide: true, timeout: 10_000 });
      assert.equal(result.status, 0, result.stderr);
      const config = JSON.parse(result.stdout);
      assert.equal(config.repository, configured ? "overridden/toolkit" : "installed/toolkit");
      assert.equal(config.issuePrefix, "INST");
      const help = spawnSync(process.execPath, [path.join(scripts, "gate.mjs"), "--help"], { cwd, env, encoding: "utf8", windowsHide: true, timeout: 10_000 });
      assert.equal(help.status, 0, help.stderr);
      assert.match(help.stdout, /selection\|assess\|compose\|dispatch/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
