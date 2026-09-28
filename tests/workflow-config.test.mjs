import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { CONFIG, validateConfig } from "../.agents/skills/corch-development-workflow/scripts/workflow-config.mjs";

test("configuration rejects ambiguous destinations and escaping setup paths", () => {
  for (const change of [
    { repository: "owner/repo/extra" }, { issuePrefix: "task/../" },
    { baseBranch: "main..other" }, { baseBranch: "-main" },
    { localCiCommand: "npm test\nother" },
  ]) assert.throws(() => validateConfig({ ...CONFIG, ...change }), /Invalid Corch configuration/);
  for (const entry of ["../outside", "/tmp/outside", "C:/outside", "node_modules/../../outside"]) {
    assert.throws(() => validateConfig({ ...CONFIG, setup: { steps: [
      { name: "install", command: "npm", args: ["ci"], inputs: [entry], outputs: [] },
    ] } }), /repository-relative/);
  }
});

test("a different repository, base branch, project prefix and source reference work together", () => {
  const root = mkdtempSync(path.join(tmpdir(), "corch-config-"));
  try {
    const configPath = path.join(root, "workflow.json");
    writeFileSync(configPath, JSON.stringify({ ...CONFIG, repository: "sample-org/toolkit",
      issuePrefix: "OPS2", baseBranch: "develop",
      localCiCommand: "make check" }));
    const runtimeDirectory = new URL("../.agents/skills/corch-development-workflow/scripts/", import.meta.url);
    const moduleUrl = (name) => new URL(name, runtimeDirectory).href;
    const script = `
      import assert from "node:assert/strict";
      import { createExecutionRoute, validateWorkerBootstrap, buildDeliveryTaskDispatch, redactText } from ${JSON.stringify(moduleUrl("./workflow-lib.mjs"))};
      import { plannerLaunchFromPrompt } from ${JSON.stringify(moduleUrl("./prepare-worker-worktree.mjs"))};
      import { ISSUE_PATTERN, BRANCH_PATTERN, LOCAL_CI_COMMAND, CI_RUN_PATTERN } from ${JSON.stringify(moduleUrl("./workflow-config.mjs"))};
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
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8", env: { ...process.env, CORCH_CONFIG: configPath }, windowsHide: true, timeout: 20_000,
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
