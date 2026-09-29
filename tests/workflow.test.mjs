import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { run as runWorktreeSetupCommand } from "../.agents/skills/corch-development-workflow/scripts/prepare-worker-worktree.mjs";

import { GATE_RISK_FIELDS, composeGateResult, validateGateResult, validateGateSelection, validateReadyHandoff } from "../.agents/skills/corch-development-workflow/scripts/lib/gate-contracts.mjs";
import { WorkflowValidationError, detectUnsafeText, redactText } from "../.agents/skills/corch-development-workflow/scripts/lib/validation.mjs";
import { assessDeliveryPreflight, buildTaskContextMarkdown, normalizeTaskContextSnapshot, validateRefinementResult } from "../.agents/skills/corch-development-workflow/scripts/lib/task-context.mjs";
import { artifactMetadata, buildEvidenceComment, buildGateSelectionMarker, buildPullRequestCommentMarker, resolveEvidenceFiles, validateEvidenceProfile, validateHandoffEvidence } from "../.agents/skills/corch-development-workflow/scripts/lib/report.mjs";
import { buildDeliveryTaskDispatch, createExecutionRoute, reviewerThreadRuntimeArguments, testerThreadRuntimeArguments, validateExecutionRoute, validateWorkerBootstrap, workerThreadRuntimeArguments } from "../.agents/skills/corch-development-workflow/scripts/lib/bootstrap.mjs";

const SCRIPT_DIRECTORY = fileURLToPath(
  new URL(
    "../.agents/skills/corch-development-workflow/scripts/",
    import.meta.url,
  ),
);
const SKILLS_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, "..", "..");

function readRoleSkill(name) {
  return readFileSync(path.join(SKILLS_DIRECTORY, name, "SKILL.md"), "utf8");
}
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function fixtureCrc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, content) {
  const typeBytes = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + content.length);
  output.writeUInt32BE(content.length, 0);
  typeBytes.copy(output, 4);
  content.copy(output, 8);
  output.writeUInt32BE(
    fixtureCrc32(Buffer.concat([typeBytes, content])),
    8 + content.length,
  );
  return output;
}

function screenshotFixture(width = 320, height = 200) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rowBytes = width * 4 + 1;
  const pixels = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * rowBytes;
    pixels[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = row + 1 + x * 4;
      pixels[pixel] = Math.floor((x / width) * 255);
      pixels[pixel + 1] = Math.floor((y / height) * 255);
      pixels[pixel + 2] = 180;
      pixels[pixel + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function command(cwd, executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    ...options,
  });
}

function git(cwd, args) {
  const result = command(cwd, "git", args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function withTempDirectory(callback) {
  const root = mkdtempSync(path.join(os.tmpdir(), "corch-workflow-v2-"));
  try {
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function createGitRepository(root) {
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "workflow@example.invalid"]);
  git(root, ["config", "user.name", "Workflow Fixture"]);
  mkdirSync(path.join(root, ".agents"));
  writeFileSync(
    path.join(root, ".gitignore"),
    ".agents/task-context/\n.agents/task-state/\n.agents/evidence/\n",
    "utf8",
  );
  writeFileSync(path.join(root, "README.md"), "fixture\n", "utf8");
  git(root, ["add", ".gitignore", "README.md"]);
  git(root, ["commit", "-m", "fixture"]);
}

function taskContext(overrides = {}) {
  return {
    schemaVersion: "task-context/v3",
    provisionalEvidenceProfile: "backend",
    retrievedAt: "2026-08-22T12:00:00.000Z",
    issue: {
      id: "10042",
      key: "TASK-42",
      sourceRef: "https://github.com/example/project/issues/42",
      updated: "2026-08-22T11:55:00.000Z",
      status: "To Do",
      summary: "Recover delivery workflow",
      type: "Task",
      outcome: "Keep one compact local planning context for the Worker.",
      acceptanceCriteria: ["The Worker reads one local context."],
      directUserDecisions: [
        "Do not reread the source during ordinary implementation.",
      ],
      deliveryDependencies: [],
      relevantConstraints: ["Never publish customer data."],
      relevantLinks: [
        {
          label: "Source",
          url: "https://github.com/example/project/issues/42",
        },
      ],
      ...(overrides.issue ?? {}),
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== "issue"),
    ),
  };
}

function deliveryTarget() {
  return {
    repository: "example/project",
    remoteUrl: "https://github.com/example/project.git",
    baseBranch: "main",
    headBranch: "codex/task-42-recovery",
    push: true,
    draftPullRequest: true,
    readyForHumanReview: true,
    sourceRef: "https://github.com/example/project/issues/42",
  };
}

function reviewResult(overrides = {}) {
  return {
    schemaVersion: "review-result/v2",
    issueKey: "TASK-42",
    repository: "example/project",
    pullRequest: {
      number: 9,
      url: "https://github.com/example/project/pull/9",
    },
    baseBranch: "main",
    headBranch: "codex/task-42-recovery",
    observedSha: SHA_A,
    comparedFromSha: null,
    verdict: "APPROVED",
    summary: "The reviewed change satisfies the bounded acceptance criteria.",
    acceptance: [
      {
        criterion: "One local context",
        status: "PASS",
        evidence: "Focused review",
      },
    ],
    findings: [],
    artifacts: [],
    ...overrides,
  };
}

function testResult(overrides = {}) {
  return {
    schemaVersion: "test-result/v2",
    issueKey: "TASK-42",
    repository: "example/project",
    pullRequest: {
      number: 9,
      url: "https://github.com/example/project/pull/9",
    },
    baseBranch: "main",
    headBranch: "codex/task-42-recovery",
    observedSha: SHA_A,
    comparedFromSha: null,
    verdict: "PASS",
    summary: "The targeted runtime validation passed.",
    acceptance: [
      {
        criterion: "One local context",
        status: "PASS",
        evidence: "Focused runtime check",
      },
    ],
    commands: [
      {
        command: "npm run test:codex-workflow",
        status: "PASS",
        exitCode: 0,
        durationMs: 100,
        summary: "Workflow fixtures passed.",
        artifacts: [],
      },
    ],
    failures: [],
    artifacts: [],
    ...overrides,
  };
}

function selection(overrides = {}) {
  return {
    schemaVersion: "gate-selection/v2",
    issueKey: "TASK-42",
    repository: "example/project",
    pullRequest: {
      number: 9,
      url: "https://github.com/example/project/pull/9",
    },
    baseBranch: "main",
    headBranch: "codex/task-42-recovery",
    observedSha: SHA_A,
    evidenceProfile: "general",
    classification: "trivial",
    planned: {
      review: {
        decision: "skipped",
        rationale: "No meaningful independent review confidence.",
      },
      test: {
        decision: "skipped",
        rationale: "No meaningful independent runtime confidence.",
      },
    },
    actual: {
      review: {
        decision: "skipped",
        rationale: "The final diff is isolated and declarative.",
      },
      test: {
        decision: "skipped",
        rationale: "Focused Worker validation fully observes the behavior.",
      },
    },
    risk: Object.fromEntries(GATE_RISK_FIELDS.map((field) => [field, false])),
    summary:
      "Both gates are proportionally skipped for this localized low-risk diff.",
    acceptance: [
      {
        criterion: "Localized change",
        status: "PASS",
        evidence: "Focused Worker check",
      },
    ],
    commands: [],
    artifacts: [],
    ...overrides,
  };
}

function waivedSelection() {
  const skipped = {
    status: "SKIPPED",
    observedSha: null,
    summary: "Explicitly waived before execution.",
    evidenceUrl: null,
  };
  return selection({
    classification: "standard",
    risk: { ...selection().risk, behaviorOrLogic: true },
    evidenceProfile: "mixed",
    summary: "The user requested handoff with explicit check waivers.",
    acceptance: [
      {
        criterion: "Localized change",
        status: "NOT_VERIFIED",
        evidence: "Runtime coverage explicitly waived.",
      },
    ],
    commands: [
      {
        command: "npm run verify:ci",
        status: "SKIPPED",
        exitCode: null,
        durationMs: 0,
        summary: "Local CI explicitly waived before execution.",
        artifacts: [],
      },
    ],
    outcomes: {
      review: { ...skipped },
      test: { ...skipped },
      ci: {
        status: "SKIPPED",
        observedSha: SHA_A,
        runUrl: null,
        summary: "Remote CI explicitly waived before execution.",
      },
      warnings: [],
    },
    waivers: ["review", "test", "local-ci", "remote-ci"].map((target) => ({
      target,
      userDecision:
        "Skip this check for this delivery and disclose the missing coverage",
      reason: "User explicitly accepted the confidence gap",
      acceptanceCriteria: target === "test" ? ["Localized change"] : [],
    })),
  });
}

test("explicit check waivers permit honest nontrivial handoff while preserving required checks", () => {
  const waived = waivedSelection();
  assert.equal(validateReadyHandoff(waived), waived);
  assert.equal(waived.outcomes.test.status, "SKIPPED");
  assert.equal(waived.acceptance[0].status, "NOT_VERIFIED");
  assert.doesNotThrow(() => validateHandoffEvidence(waived, []));
  for (const target of ["review", "test", "local-ci", "remote-ci"]) {
    const missing = structuredClone(waived);
    missing.waivers = missing.waivers.filter((item) => item.target !== target);
    assert.throws(
      () => validateReadyHandoff(missing),
      WorkflowValidationError,
      target,
    );
  }
  assert.equal(validateGateSelection(selection()).waivers, undefined);
  assert.throws(
    () => validateHandoffEvidence(selection({ evidenceProfile: "mixed" }), []),
    /requires a screenshot/,
  );
  assert.throws(
    () =>
      validateGateSelection(
        selection({
          classification: "standard",
          risk: { ...selection().risk, behaviorOrLogic: true },
        }),
      ),
    /both gates may be skipped only/,
  );
  assert.throws(
    () =>
      validateGateResult(
        "tester",
        testResult({
          acceptance: waived.acceptance,
        }),
      ),
    /status must be PASS or FAIL/,
  );
});

test("a partial command waiver removes aggregate artifact minima while retaining verified acceptance", () =>
  withTempDirectory((root) => {
    createGitRepository(root);
    const value = waivedSelection();
    const check = "node browser-check.mjs";
    value.waivers = [
      {
        target: "command",
        command: check,
        userDecision: "Skip the responsive browser check",
        reason: "User accepted missing responsive coverage",
        acceptanceCriteria: ["Localized change"],
      },
    ];
    value.actual = {
      review: { decision: "required", rationale: "Review adds confidence" },
      test: {
        decision: "required",
        rationale: "Verify the remaining behavior",
      },
    };
    value.acceptance.push({
      criterion: "Content rendering",
      status: "PASS",
      evidence: "Focused render assertion passed",
    });
    value.commands[0] = {
      ...value.commands[0],
      status: "PASS",
      exitCode: 0,
      durationMs: 12,
      summary: "Local CI passed",
    };
    value.commands.push({
      command: check,
      status: "SKIPPED",
      exitCode: null,
      durationMs: 0,
      summary: "User waived browser check",
      artifacts: [],
    });
    value.outcomes.review = {
      ...value.outcomes.review,
      status: "APPROVED",
      observedSha: SHA_A,
      summary: "Review completed",
    };
    value.outcomes.test = {
      ...value.outcomes.test,
      status: "PASS",
      observedSha: SHA_A,
      summary: "Remaining acceptance passed",
    };
    value.outcomes.ci = {
      ...value.outcomes.ci,
      status: "PASS",
      runUrl: "https://github.com/example/project/actions/runs/123",
      summary: "CI passed",
    };
    assert.doesNotThrow(() => validateReadyHandoff(value));
    assert.doesNotThrow(() => validateHandoffEvidence(value, []));
    assert.equal(value.acceptance[1].status, "PASS");
    const filename = path.join(root, "partial-handoff.json");
    writeFileSync(filename, JSON.stringify(value));
    const result = command(root, process.execPath, [
      path.join(SCRIPT_DIRECTORY, "prepare-report.mjs"),
      "--issue",
      "TASK-42",
      "--pr",
      "9",
      "--head-branch",
      "codex/task-42-recovery",
      "--gate",
      "handoff",
      "--profile",
      "mixed",
      "--result",
      filename,
      "--dry-run",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).files, []);
    value.acceptance[0] = {
      ...value.acceptance[0],
      status: "PASS",
      evidence: "Additional check covered responsive behavior",
    };
    assert.throws(
      () => validateHandoffEvidence(value, []),
      /requires a screenshot/,
    );
  }));

test("waivers require a specific user decision and associate only known acceptance gaps", () => {
  for (const field of [
    "target",
    "userDecision",
    "reason",
    "acceptanceCriteria",
  ]) {
    const value = waivedSelection();
    delete value.waivers[0][field];
    assert.throws(
      () => validateGateSelection(value),
      WorkflowValidationError,
      field,
    );
  }
  for (const modify of [
    (value) => {
      value.waivers[0].target = "merge";
    },
    (value) => {
      value.waivers[0].command = "unrelated";
    },
    (value) => {
      value.waivers.push({ ...value.waivers[0] });
    },
    (value) => {
      value.waivers[1].acceptanceCriteria = ["Unknown criterion"];
    },
    (value) => {
      value.waivers[1].acceptanceCriteria = [
        "Localized change",
        "Localized change",
      ];
    },
    (value) => {
      value.waivers[1].acceptanceCriteria = [];
    },
    (value) => {
      value.waivers = null;
    },
  ]) {
    const value = waivedSelection();
    modify(value);
    assert.throws(() => validateGateSelection(value), WorkflowValidationError);
  }
  const failedAcceptance = waivedSelection();
  failedAcceptance.acceptance[0].status = "FAIL";
  assert.throws(
    () => validateReadyHandoff(failedAcceptance),
    /every acceptance item to pass/,
  );
});

test("waivers preserve failed and blocked outcomes and do not cover unrelated commands", () => {
  const value = waivedSelection();
  value.outcomes.review = {
    ...value.outcomes.review,
    status: "CHANGES_REQUESTED",
    observedSha: SHA_A,
  };
  value.outcomes.test = {
    ...value.outcomes.test,
    status: "FAIL",
    observedSha: SHA_A,
  };
  value.outcomes.ci = {
    ...value.outcomes.ci,
    status: "BLOCKED",
    observedSha: SHA_B,
  };
  value.commands[0] = {
    ...value.commands[0],
    status: "FAIL",
    exitCode: 1,
    durationMs: 12,
  };
  const before = structuredClone(value);
  assert.deepEqual(validateReadyHandoff(value), before);
  const extra = {
    command: "node acceptance-check.mjs",
    status: "FAIL",
    exitCode: 2,
    durationMs: 5,
    summary: "Observed failure",
    artifacts: [],
  };
  value.commands.push(extra);
  assert.throws(
    () => validateReadyHandoff(value),
    /every recorded command to pass/,
  );
  value.waivers.push({
    target: "command",
    command: extra.command,
    userDecision: "Accept this check failure for handoff",
    reason: "Explicit user decision",
    acceptanceCriteria: [],
  });
  assert.equal(validateReadyHandoff(value).commands[1].exitCode, 2);
  value.waivers.at(-1).command = "node different-check.mjs";
  assert.throws(
    () => validateReadyHandoff(value),
    /must have a recorded outcome/,
  );
});

test("skipped execution has no invented exit result, duration, or CI run", () => {
  for (const modify of [
    (value) => {
      value.commands[0].exitCode = 0;
    },
    (value) => {
      value.commands[0].durationMs = 10;
    },
    (value) => {
      value.outcomes.ci.runUrl =
        "https://github.com/example/project/actions/runs/123";
    },
  ]) {
    const value = waivedSelection();
    modify(value);
    assert.throws(() => validateReadyHandoff(value), /SKIPPED requires/);
  }
  const missingLocal = waivedSelection();
  missingLocal.commands = [];
  assert.throws(() => validateReadyHandoff(missingLocal), /verify:ci result/);
  const exactSuite = waivedSelection();
  exactSuite.waivers[2] = {
    ...exactSuite.waivers[2],
    target: "command",
    command: "npm run verify:ci",
  };
  assert.doesNotThrow(() => validateReadyHandoff(exactSuite));
});

test("handoff publication identity changes with waiver decisions and is order independent", () => {
  const value = waivedSelection();
  const identity = {
    issueKey: value.issueKey,
    pullRequestNumber: 9,
    observedSha: SHA_A,
    review: "skipped",
    test: "skipped",
    gate: "handoff",
  };
  for (const build of [
    buildGateSelectionMarker,
    buildPullRequestCommentMarker,
  ]) {
    const original = build(identity);
    assert.equal(build({ ...identity, waivers: [] }), original);
    const marked = build({ ...identity, waivers: value.waivers });
    assert.notEqual(marked, original);
    assert.equal(
      build({ ...identity, waivers: [...value.waivers].reverse() }),
      marked,
    );
    const revised = structuredClone(value.waivers);
    revised[0].reason = "A revised user decision";
    assert.notEqual(build({ ...identity, waivers: revised }), marked);
  }
});

test("waived handoffs validate and publish without fabricated runtime artifacts or CI links", () =>
  withTempDirectory((root) => {
    createGitRepository(root);
    const value = waivedSelection();
    const directory = path.join(root, ".agents", "task-state");
    mkdirSync(directory, { recursive: true });
    const filename = path.join(directory, "handoff.json");
    writeFileSync(filename, JSON.stringify(value));
    const identity = [
      "--issue",
      "TASK-42",
      "--pr",
      "9",
      "--head-branch",
      "codex/task-42-recovery",
    ];
    const selectionResult = command(root, process.execPath, [
      path.join(SCRIPT_DIRECTORY, "gate.mjs"), "selection",
      ...identity,
      "--selection",
      filename,
    ]);
    assert.equal(selectionResult.status, 0, selectionResult.stderr);
    const publish = () =>
      command(root, process.execPath, [
        path.join(SCRIPT_DIRECTORY, "prepare-report.mjs"),
        ...identity,
        "--gate",
        "handoff",
        "--result",
        filename,
        "--dry-run",
        "--evidence-url",
        "https://example.atlassian.net/browse/TASK-42?focusedCommentId=123",
      ]);
    const published = publish();
    assert.equal(published.status, 0, published.stderr);
    assert.deepEqual(JSON.parse(published.stdout).files, []);
    assert.equal(
      JSON.parse(published.stdout).marker,
      JSON.parse(selectionResult.stdout).marker,
    );
    const report = JSON.parse(published.stdout);
    const body = report.prComment.body;
    for (const text of [body, report.commentBody]) {
      assert.match(text, /[Ee]xplicit check waivers/);
      assert.match(text, /User decision/);
      assert.match(text, /NOT_VERIFIED/);
      assert.match(text, /SKIPPED/);
      assert.doesNotMatch(
        text,
        /GitHub Actions run|\(null\)|\|null\]|\bPASS\b/,
      );
    }
    const artifactPath = `.agents/evidence/TASK-42/${SHA_A}/missing.log`;
    value.artifacts = [
      {
        path: artifactPath,
        caption: "Runtime evidence",
        acceptanceCriteria: ["Localized change"],
      },
    ];
    writeFileSync(filename, JSON.stringify(value));
    assert.notEqual(
      publish().status,
      0,
      "Waivers must not bypass supplied artifact validation",
    );
    value.artifacts = [];
    value.waivers[1].reason = "password=" + "z".repeat(30);
    writeFileSync(filename, JSON.stringify(value));
    const unsafe = publish();
    assert.equal(unsafe.status, 1);
    assert.match(unsafe.stderr, /unsafe data/);
    assert.doesNotMatch(unsafe.stderr, /z{30}/);
    assert.equal(git(root, ["status", "--short"]), "");
  }));

test("task-context/v3 renders compact planning data and rejects retired formats", () => {
  const normalized = normalizeTaskContextSnapshot(taskContext());
  const markdown = buildTaskContextMarkdown(normalized);
  assert.match(markdown, /corch-task-context:v3/);
  assert.match(markdown, /Direct user decisions/);
  assert.doesNotMatch(markdown, /Description|Test expectations/);
  assert.doesNotMatch(markdown, /digest|Canonical snapshot|base SHA/i);
  assert.throws(
    () =>
      normalizeTaskContextSnapshot(
        taskContext({ issue: { outcome: `token=${"z".repeat(24)}` } }),
      ),
    WorkflowValidationError,
  );
  assert.throws(
    () =>
      normalizeTaskContextSnapshot(
        taskContext({ issue: { outcome: "x".repeat(25 * 1024) } }),
      ),
    /exceeds 24 KiB/,
  );
  assert.throws(
    () =>
      normalizeTaskContextSnapshot(
        taskContext({ schemaVersion: "task-context/v2" }),
      ),
    /schemaVersion must/,
  );
});

test("execution-route/v2 selects defaults and preserves historical runtime snapshots", () => {
  const cases = [
    ["bounded", "gpt-6-luna", "xhigh"],
    ["routine", "gpt-6-luna", "xhigh"],
    ["standard", "gpt-6-luna", "max"],
    ["complex", "gpt-6-luna", "max"],
    ["high-risk", "gpt-5.6-sol", "high"],
    ["exceptional", "gpt-5.6-sol", "xhigh"],
  ];
  for (const [classification, model, reasoningEffort] of cases) {
    const route = createExecutionRoute({
      issueKey: "TASK-42",
      classification,
      riskSignals: [],
      rationale: `The ${classification} implementation route matches the inspected work.`,
    });
    assert.equal(route.model, model);
    assert.equal(route.reasoningEffort, reasoningEffort);
    assert.deepEqual(workerThreadRuntimeArguments(route), {
      model,
      thinking: reasoningEffort,
    });
    assert.deepEqual(reviewerThreadRuntimeArguments(route), {
      model,
      thinking: reasoningEffort,
    });
    if (model === "gpt-6-luna") {
      const persisted = { ...route, model: "gpt-5.6-luna" };
      assert.equal(workerThreadRuntimeArguments(persisted).model, "gpt-5.6-luna");
      for (const effort of ["low", "medium"]) {
        assert.equal(validateExecutionRoute({ ...persisted, reasoningEffort: effort }).reasoningEffort, effort);
      }
    }
  }
  assert.deepEqual(testerThreadRuntimeArguments(), {
    model: "gpt-6-luna",
    thinking: "xhigh",
  });
  const retired = {
    ...createExecutionRoute({
      issueKey: "TASK-42",
      classification: "complex",
      rationale: "Scoped implementation.",
    }),
    schemaVersion: "execution-route/v1",
  };
  assert.throws(() => validateExecutionRoute(retired), /schemaVersion must/);
});

test("worker-bootstrap/v2 carries explicit runtime and destination authorization", () => {
  const route = createExecutionRoute({
    issueKey: "TASK-42",
    classification: "bounded",
    riskSignals: [],
    rationale: "The implementation is bounded and decision complete.",
  });
  const bootstrap = {
    schemaVersion: "worker-bootstrap/v2",
    issue: {
      key: "TASK-42",
      summary: "Recover delivery workflow",
      sourceRef: "https://github.com/example/project/issues/42",
    },
    reservedBranch: "codex/task-42-recovery",
    deliveryTarget: deliveryTarget(),
    executionRoute: route,
    taskContextPath: ".agents/task-context/TASK-42.md",
  };
  const plannerDispatch = buildDeliveryTaskDispatch(bootstrap, {
    coordinator: "coordinator-1",
  });
  assert.equal(plannerDispatch.title, "[TASK-42] Planner");
  assert.deepEqual(plannerDispatch.runtime, {
    model: "gpt-6-astra",
    thinking: "xhigh",
  });
  assert.match(plannerDispatch.prompt, /No Worker exists yet/);
  assert.match(plannerDispatch.prompt, /stop and wait for answers/);
  assert.match(
    plannerDispatch.prompt,
    /if clear, draft the concrete plan directly/,
  );
  assert.match(plannerDispatch.prompt, /TASK-42-plan\.md/);
  assert.match(plannerDispatch.prompt, /code-first handoff format/);
  assert.match(
    plannerDispatch.prompt,
    /ordered file\/symbol edits, required behavior and concrete tests/,
  );
  assert.match(plannerDispatch.prompt, /decisions and tradeoffs in chat/);
  assert.match(plannerDispatch.prompt, /One approval covers that revision/);
  assert.match(plannerDispatch.prompt, /Resolve design, not coding mechanics/);
  assert.match(plannerDispatch.prompt, /classes\/functions\/interfaces/);
  assert.match(plannerDispatch.prompt, /edge cases with expected outcomes/);
  assert.match(
    plannerDispatch.prompt,
    /exact replacement text is not required/,
  );
  assert.doesNotMatch(plannerDispatch.prompt, /spawn_agent|\/plan\b/);
  const workerDispatch = buildDeliveryTaskDispatch(bootstrap, {
    role: "worker",
    planRevision: 2,
  });
  assert.deepEqual(workerDispatch.runtime, workerThreadRuntimeArguments(route));
  assert.equal(workerDispatch.title, "[TASK-42] Recover delivery workflow");
  assert.match(workerDispatch.prompt, /revision 2/);
  assert.match(workerDispatch.prompt, /Read the entire file before editing/);
  assert.match(
    workerDispatch.prompt,
    /same worktree, branch, context and dependencies/,
  );
  assert.doesNotMatch(workerDispatch.prompt, /spawn_agent|\$corch-planner/);
  assert.throws(
    () => buildDeliveryTaskDispatch(bootstrap),
    /Coordinator task ID/,
  );
  assert.throws(
    () => buildDeliveryTaskDispatch(bootstrap, { role: "worker" }),
    /positive revision/,
  );
  assert.throws(
    () =>
      buildDeliveryTaskDispatch(bootstrap, { role: "worker", planRevision: 0 }),
    /positive revision/,
  );
  assert.throws(
    () => buildDeliveryTaskDispatch(bootstrap, { role: "unknown" }),
    /role must/,
  );
  assert.throws(
    () => buildDeliveryTaskDispatch(bootstrap, { role: "legacy-worker" }),
    /role must/,
  );
  const bootstrapScript = path.join(
    SCRIPT_DIRECTORY,
    "prepare-worker-bootstrap.mjs",
  );
  withTempDirectory((root) => {
    createGitRepository(root);
    const recorded = command(root, process.execPath, [
      path.join(SCRIPT_DIRECTORY, "task-state.mjs"), "record-route",
      "--issue", route.issueKey, "--classification", route.classification,
      "--rationale", route.rationale,
    ]);
    assert.equal(recorded.status, 0, recorded.stderr);
    const invokeBootstrap = (args) =>
      command(root, process.execPath, [bootstrapScript, ...args], {
        input: JSON.stringify(bootstrap),
      });
    const dispatched = invokeBootstrap(["--coordinator", "coordinator-1"]);
    assert.equal(dispatched.status, 0, dispatched.stderr);
    assert.equal(JSON.parse(dispatched.stdout).title, plannerDispatch.title);
    assert.deepEqual(JSON.parse(dispatched.stdout).runtime, plannerDispatch.runtime);
    assert.deepEqual(JSON.parse(dispatched.stdout).bootstrap, bootstrap);
    // Worker continuation also requires a registered checkout and current plan.
    assert.equal(invokeBootstrap(["--role", "worker", "--plan-revision", "2"]).status, 1);
    assert.equal(invokeBootstrap(["--role", "worker"]).status, 1);
    assert.equal(invokeBootstrap(["--coordinator"]).status, 1);
    assert.equal(invokeBootstrap(["--unknown", "value"]).status, 1);
  });
  assert.throws(
    () => validateWorkerBootstrap({ ...bootstrap, planner: {} }),
    /planner is not supported/,
  );
  assert.throws(
    () =>
      validateWorkerBootstrap({
        ...bootstrap,
        deliveryTarget: {
          ...bootstrap.deliveryTarget,
          remoteUrl: "https://github.com/example/other.git",
        },
      }),
    /remoteUrl/,
  );
  assert.throws(
    () =>
      validateWorkerBootstrap({
        ...bootstrap,
        deliveryTarget: {
          ...bootstrap.deliveryTarget,
          headBranch: "codex/task-43-other",
        },
      }),
    /headBranch/,
  );
  assert.match(
    workerDispatch.prompt,
    /https:\/\/github\.com\/example\/project\.git/,
  );
  assert.match(workerDispatch.prompt, /commit, push/);
  assert.match(plannerDispatch.prompt, /One approval covers that revision/);
});

test("execution-route/v2 rejects malformed or omitted runtime and unsupported signals", () => {
  const route = createExecutionRoute({
    issueKey: "TASK-42",
    classification: "bounded",
    riskSignals: ["securityPrivacyBilling", "infrastructureOrDeployment"],
    rationale:
      "The Lambda receiver remains a bounded implementation despite operational criteria.",
  });
  assert.equal(route.model, "gpt-6-luna");
  assert.equal(route.reasoningEffort, "xhigh");
  assert.throws(
    () => validateExecutionRoute({ ...route, model: "bad model\n" }),
    /complete model\/reasoningEffort pair/,
  );
  assert.throws(
    () => validateExecutionRoute({ ...route, reasoningEffort: "unknown" }),
    /complete model\/reasoningEffort pair/,
  );
  const { model: omittedModel, ...withoutModel } = route;
  assert.equal(omittedModel, "gpt-6-luna");
  assert.throws(
    () => workerThreadRuntimeArguments(withoutModel),
    /complete model\/reasoningEffort pair/,
  );
  assert.throws(
    () =>
      createExecutionRoute({
        issueKey: "TASK-42",
        classification: "bounded",
        riskSignals: ["ticketIsLong"],
        rationale: "Ticket length is not a supported promotion signal.",
      }),
    /unsupported value/,
  );
});

test("task state records the initial configured runtime without a separate selector", () =>
  withTempDirectory((root) => {
    createGitRepository(root);
    const script = path.join(SCRIPT_DIRECTORY, "task-state.mjs");
    const recorded = command(root, process.execPath, [
      script, "record-route", "--issue", "TASK-58", "--classification", "bounded",
      "--signal", "infrastructureOrDeployment",
      "--rationale", "The local webhook receiver is bounded and decision-complete.",
    ]);
    assert.equal(recorded.status, 0, recorded.stderr);
    const shown = command(root, process.execPath, [script, "show", "--issue", "TASK-58"]);
    assert.equal(shown.status, 0, shown.stderr);
    const route = JSON.parse(shown.stdout).executionRoute;
    assert.equal(route.schemaVersion, "execution-route/v2");
    assert.deepEqual(workerThreadRuntimeArguments(route), {
      model: "gpt-6-luna", thinking: "xhigh",
    });
  }));

test("task context records structured hard and coordination dependencies", () => {
  const normalized = normalizeTaskContextSnapshot(
    taskContext({
      issue: {
        deliveryDependencies: [
          {
            issueKey: "TASK-41",
            kind: "hard",
            requiredMilestone: "merged",
            dependencyVerified: true,
            concurrencyBoundary: null,
            rationale: "The issue consumes the predecessor API contract.",
          },
          {
            issueKey: "TASK-43",
            kind: "coordination",
            requiredMilestone: null,
            dependencyVerified: false,
            concurrencyBoundary:
              "TASK-42 owns API code; TASK-43 owns web copy.",
            rationale:
              "The scopes share a release but no unfinished deliverable.",
          },
        ],
      },
    }),
  );
  const markdown = buildTaskContextMarkdown(normalized);
  assert.match(
    markdown,
    /TASK-41: hard; required=merged; dependency verified=true/,
  );
  assert.match(markdown, /TASK-43: coordination; required=concurrent/);
  assert.throws(
    () =>
      normalizeTaskContextSnapshot(
        taskContext({
          issue: {
            deliveryDependencies: [
              {
                issueKey: "TASK-42",
                kind: "hard",
                requiredMilestone: "merged",
                dependencyVerified: true,
                concurrencyBoundary: null,
                rationale: "Self dependency is invalid.",
              },
            ],
          },
        }),
      ),
    /must not reference the issue itself/,
  );
});

test("delivery preflight blocks hard prerequisites and exposes safe concurrency", () => {
  const dependency = {
    issueKey: "TASK-42",
    kind: "hard",
    requiredMilestone: "merged",
    dependencyVerified: true,
    concurrencyBoundary: null,
    rationale: "TASK-44 consumes the fiscal transport established by TASK-42.",
  };
  const snapshot = {
    schemaVersion: "delivery-preflight/v1",
    issues: [
      {
        key: "TASK-42",
        selected: true,
        observedMilestone: "in-progress",
        deliveryDependencies: [],
      },
      {
        key: "TASK-44",
        selected: true,
        observedMilestone: "not-started",
        deliveryDependencies: [dependency],
      },
      {
        key: "TASK-51",
        selected: true,
        observedMilestone: "not-started",
        deliveryDependencies: [],
      },
    ],
  };
  const blocked = assessDeliveryPreflight(snapshot);
  assert.deepEqual(blocked.runnable, ["TASK-42", "TASK-51"]);
  assert.deepEqual(blocked.blocked, [
    {
      issueKey: "TASK-44",
      prerequisiteKey: "TASK-42",
      reason: "requires merged; observed in-progress",
    },
  ]);
  assert.deepEqual(
    blocked.concurrency.map((pair) => pair.issues),
    [["TASK-42", "TASK-51"]],
  );

  const afterMerge = assessDeliveryPreflight({
    ...snapshot,
    issues: snapshot.issues.map((issue) =>
      issue.key === "TASK-42"
        ? { ...issue, selected: false, observedMilestone: "merged" }
        : issue,
    ),
  });
  assert.deepEqual(afterMerge.runnable, ["TASK-44", "TASK-51"]);
  assert.deepEqual(afterMerge.blocked, []);
  assert.deepEqual(
    afterMerge.concurrency.map((pair) => pair.issues),
    [["TASK-44", "TASK-51"]],
  );
});

test("delivery preflight blocks a missing directed dependency and permits bounded coordination", () => {
  const baseIssue = {
    key: "TASK-42",
    selected: true,
    observedMilestone: "not-started",
    deliveryDependencies: [],
  };
  const missingLink = assessDeliveryPreflight({
    schemaVersion: "delivery-preflight/v1",
    issues: [
      baseIssue,
      {
        key: "TASK-44",
        selected: true,
        observedMilestone: "not-started",
        deliveryDependencies: [
          {
            issueKey: "TASK-42",
            kind: "hard",
            requiredMilestone: "merged",
            dependencyVerified: false,
            concurrencyBoundary: null,
            rationale: "The downstream issue consumes predecessor code.",
          },
        ],
      },
    ],
  });
  assert.deepEqual(missingLink.runnable, ["TASK-42"]);
  assert.match(
    missingLink.blocked[0].reason,
    /missing verified directed dependency/,
  );

  const coordinated = assessDeliveryPreflight({
    schemaVersion: "delivery-preflight/v1",
    issues: [
      baseIssue,
      {
        key: "TASK-51",
        selected: true,
        observedMilestone: "not-started",
        deliveryDependencies: [
          {
            issueKey: "TASK-42",
            kind: "coordination",
            requiredMilestone: null,
            dependencyVerified: false,
            concurrencyBoundary:
              "TASK-42 owns fiscal code; TASK-51 owns Docker assertions.",
            rationale: "The changes share CI but consume no unfinished output.",
          },
        ],
      },
    ],
  });
  assert.deepEqual(coordinated.runnable, ["TASK-42", "TASK-51"]);
  assert.deepEqual(coordinated.concurrency[0].boundaries, [
    "TASK-42 owns fiscal code; TASK-51 owns Docker assertions.",
  ]);
  assert.throws(
    () =>
      assessDeliveryPreflight({
        schemaVersion: "delivery-preflight/v1",
        issues: [
          baseIssue,
          {
            key: "TASK-51",
            selected: true,
            observedMilestone: "not-started",
            deliveryDependencies: [
              {
                issueKey: "TASK-42",
                kind: "coordination",
                requiredMilestone: null,
                dependencyVerified: false,
                concurrencyBoundary: "",
                rationale: "Missing ownership detail.",
              },
            ],
          },
        ],
      }),
    /concurrencyBoundary must be a non-empty string/,
  );
});

test("delivery preflight CLI returns the same runnable graph", () =>
  withTempDirectory((root) => {
    const script = path.join(SCRIPT_DIRECTORY, "assess-delivery-preflight.mjs");
    const input = {
      schemaVersion: "delivery-preflight/v1",
      issues: [
        {
          key: "TASK-42",
          selected: true,
          observedMilestone: "not-started",
          deliveryDependencies: [],
        },
      ],
    };
    const result = command(root, process.execPath, [script], {
      input: JSON.stringify(input),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).runnable, ["TASK-42"]);
    const help = command(root, process.execPath, [script, "--help"]);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /delivery-preflight\/v1/);
  }));

test("customer-data detection does not mistake SHA digits for a phone number", () => {
  const shaWithDigits = `${"a".repeat(16)}12345678${"b".repeat(16)}`;
  assert.deepEqual(detectUnsafeText(shaWithDigits), []);
  assert.deepEqual(detectUnsafeText("Contato: +55 (11) 99999-1234"), [
    "Brazilian phone number",
  ]);
});

test("customer-data handling preserves validated GitHub Actions run identifiers", () => {
  const runUrl = "https://github.com/example/project/actions/runs/32588660542";
  assert.deepEqual(detectUnsafeText(runUrl), []);
  assert.equal(redactText(runUrl), runUrl);
  assert.deepEqual(detectUnsafeText("Customer phone 11999991234"), [
    "Brazilian phone number",
  ]);
  assert.match(redactText("Customer phone 11999991234"), /\[REDACTED\]/);
});

test("materialization ignores status-only refreshes and rewrites material changes", () =>
  withTempDirectory((root) => {
    createGitRepository(root);
    const script = path.join(SCRIPT_DIRECTORY, "materialize-task-context.mjs");
    const invoke = (value) =>
      command(root, process.execPath, [script, "stage", "--issue", "TASK-42"], {
        input: JSON.stringify(value),
      });
    const first = invoke(taskContext());
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).status, "materialized");
    const contextPath = path.join(
      root,
      ".agents",
      "task-context",
      "TASK-42.md",
    );
    const original = readFileSync(contextPath, "utf8");
    const statusOnly = invoke(
      taskContext({
        retrievedAt: "2026-08-22T13:00:00.000Z",
        issue: { status: "In Progress", updated: "2026-08-22T12:59:00.000Z" },
      }),
    );
    assert.equal(statusOnly.status, 0, statusOnly.stderr);
    assert.equal(
      JSON.parse(statusOnly.stdout).status,
      "unchanged-material-context",
    );
    assert.equal(readFileSync(contextPath, "utf8"), original);
    const changed = invoke(
      taskContext({
        issue: { acceptanceCriteria: ["The refreshed scope is material."] },
      }),
    );
    assert.equal(changed.status, 0, changed.stderr);
    assert.equal(JSON.parse(changed.stdout).status, "materialized");
    assert.match(
      readFileSync(contextPath, "utf8"),
      /refreshed scope is material/,
    );
    const dependencyChanged = invoke(
      taskContext({
        issue: {
          acceptanceCriteria: ["The refreshed scope is material."],
          deliveryDependencies: [
            {
              issueKey: "TASK-41",
              kind: "hard",
              requiredMilestone: "merged",
              dependencyVerified: true,
              concurrencyBoundary: null,
              rationale: "The current task consumes the predecessor contract.",
            },
          ],
        },
      }),
    );
    assert.equal(dependencyChanged.status, 0, dependencyChanged.stderr);
    assert.equal(JSON.parse(dependencyChanged.stdout).status, "materialized");
    assert.match(readFileSync(contextPath, "utf8"), /TASK-41: hard/);
    const staged = command(
      root,
      process.execPath,
      [script, "stage", "--issue", "TASK-42"],
      {
        input: JSON.stringify(
          taskContext({ issue: { outcome: "Staged before Worker creation." } }),
        ),
      },
    );
    assert.equal(staged.status, 0, staged.stderr);
    const worker = `${root}-worker-context`;
    git(root, ["worktree", "add", "-b", "codex/task-42-context", worker]);
    const hydrated = command(worker, process.execPath, [
      script,
      "hydrate",
      "--issue",
      "TASK-42",
      "--worktree",
      worker,
    ]);
    assert.equal(hydrated.status, 0, hydrated.stderr);
    assert.match(
      readFileSync(
        path.join(worker, ".agents", "task-context", "TASK-42.md"),
        "utf8",
      ),
      /Staged before Worker creation/,
    );
    git(root, ["worktree", "remove", worker]);
    assert.equal(git(root, ["status", "--short"]), "");
  }));

test("v2 result validation uses observed SHA as audit identity, not an implicit remote lock", () => {
  assert.equal(
    validateGateResult("reviewer", reviewResult()).observedSha,
    SHA_A,
  );
  assert.throws(
    () =>
      validateGateResult("reviewer", reviewResult(), { observedSha: SHA_B }),
    /observedSha does not match/,
  );
  assert.throws(
    () =>
      validateGateResult(
        "reviewer",
        reviewResult({
          artifacts: [`.agents/evidence/TASK-42/${SHA_A}/loose.log`],
        }),
      ),
    /captioned artifact object/,
  );
  assert.throws(
    () =>
      validateGateResult(
        "reviewer",
        reviewResult({
          verdict: "CHANGES_REQUESTED",
          findings: [{ id: "REV-1", severity: "high" }],
        }),
      ),
    /findings\[0\]\.title/,
  );
});

test("gate results reject retired schemas and string-only artifacts", () => {
  for (const [role, make] of [
    ["reviewer", reviewResult],
    ["tester", testResult],
  ]) {
    assert.throws(
      () =>
        validateGateResult(
          role,
          make({
            schemaVersion:
              role === "reviewer" ? "review-result/v1" : "test-result/v1",
          }),
        ),
      /schemaVersion must/,
    );
    assert.throws(
      () => validateGateResult(role, make({ artifacts: ["proof.log"] })),
      /artifact/,
    );
  }
});

test("gate amendments compose targeted corrections into complete v2 results", () => {
  const base = reviewResult();
  const amendment = {
    schemaVersion: "review-amendment/v1",
    baseResultPath: `.agents/evidence/TASK-42/${SHA_A}/reviewer-result.json`,
    issueKey: "TASK-42",
    observedSha: SHA_B,
    comparedFromSha: SHA_A,
    verdict: "APPROVED",
    summary: "The targeted correction resolves the prior finding.",
    acceptanceUpdates: [],
    carryForward: [
      {
        criterion: "One local context",
        rationale: "The delta cannot affect context loading.",
      },
    ],
    findings: [],
    resolvedFindings: [],
    artifacts: [],
  };
  const composed = composeGateResult("reviewer", base, amendment);
  assert.equal(composed.observedSha, SHA_B);
  assert.equal(composed.acceptance.length, 1);
  assert.equal(composed.verdict, "APPROVED");
  assert.throws(() => composeGateResult("reviewer", base, { ...amendment, issueKey: "TASK-43" }), /issueKey must match/);
  assert.throws(() => composeGateResult("reviewer", base, { ...amendment, comparedFromSha: SHA_B }), /comparedFromSha must equal/);
  assert.throws(
    () =>
      composeGateResult("reviewer", base, { ...amendment, carryForward: [] }),
    /requires an update or carry-forward rationale/,
  );
  const priorFinding = {
    id: "REV-1",
    severity: "high",
    title: "Context can be lost",
    evidence: "The prior implementation missed hydration.",
    requiredOutcome: "Hydrate before planning.",
  };
  const failingBase = reviewResult({
    verdict: "CHANGES_REQUESTED",
    findings: [priorFinding],
  });
  assert.throws(
    () => composeGateResult("reviewer", failingBase, amendment),
    /requires a current or resolved disposition: REV-1/,
  );
  const resolved = composeGateResult("reviewer", failingBase, {
    ...amendment,
    resolvedFindings: [
      {
        id: "REV-1",
        rationale: "The reserved branch now enables hydration before planning.",
      },
    ],
  });
  assert.equal(resolved.verdict, "APPROVED");
  assert.deepEqual(resolved.findings, []);

  const failingTestBase = testResult({
    verdict: "FAIL",
    failures: [
      {
        id: "TEST-1",
        title: "Hydration failed",
        evidence: "The first runtime attempt could not find context.",
        nextAction: "Retry after fixing bootstrap identity.",
      },
    ],
    commands: [
      {
        command: "npm run test:codex-workflow",
        status: "FAIL",
        exitCode: 1,
        durationMs: 80,
        summary: "The first attempt failed.",
        artifacts: [],
      },
    ],
  });
  const testAmendment = {
    schemaVersion: "test-amendment/v1",
    baseResultPath: `.agents/evidence/TASK-42/${SHA_A}/tester-result.json`,
    issueKey: "TASK-42",
    observedSha: SHA_B,
    comparedFromSha: SHA_A,
    verdict: "PASS",
    summary: "The targeted retry passes after the bootstrap correction.",
    acceptanceUpdates: [],
    carryForward: [
      {
        criterion: "One local context",
        rationale: "The targeted retry directly confirms it.",
      },
    ],
    commands: testResult().commands,
    failures: [],
    resolvedFailures: [
      { id: "TEST-1", rationale: "The current targeted command passes." },
    ],
    artifacts: [],
  };
  assert.throws(
    () =>
      composeGateResult("tester", failingTestBase, {
        ...testAmendment,
        resolvedFailures: [],
      }),
    /requires a current or resolved disposition: TEST-1/,
  );
  const retested = composeGateResult("tester", failingTestBase, testAmendment);
  assert.equal(retested.verdict, "PASS");
  assert.equal(retested.commands.length, 1);
});

test("gate amendment helper writes a new validated result without shell redirection", () =>
  withTempDirectory((root) => {
    createGitRepository(root);
    const base = reviewResult();
    const amendment = {
      schemaVersion: "review-amendment/v1",
      baseResultPath: `.agents/evidence/TASK-42/${SHA_A}/review-result.json`,
      issueKey: "TASK-42",
      observedSha: SHA_B,
      comparedFromSha: SHA_A,
      verdict: "APPROVED",
      summary: "The targeted correction resolves the prior finding.",
      acceptanceUpdates: [],
      carryForward: [
        {
          criterion: "One local context",
          rationale: "The delta cannot affect context loading.",
        },
      ],
      findings: [],
      resolvedFindings: [],
      artifacts: [],
    };
    writeFileSync(path.join(root, "base.json"), JSON.stringify(base), "utf8");
    writeFileSync(
      path.join(root, "amendment.json"),
      JSON.stringify(amendment),
      "utf8",
    );
    const relativeOutput = `.agents/evidence/TASK-42/${SHA_B}/review-result.json`;
    const script = path.join(SCRIPT_DIRECTORY, "gate.mjs");
    const args = [
      script,
      "compose",
      "--gate",
      "review",
      "--base",
      "base.json",
      "--amendment",
      "amendment.json",
      "--output",
      relativeOutput,
    ];
    const preview = command(root, process.execPath, args.slice(0, -2));
    assert.equal(preview.status, 0, preview.stderr);
    assert.deepEqual(JSON.parse(preview.stdout), composeGateResult("reviewer", base, amendment));
    assert.equal(existsSync(path.join(root, relativeOutput)), false);
    const first = command(root, process.execPath, args);
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(JSON.parse(first.stdout), {
      status: "written",
      path: relativeOutput,
    });
    assert.equal(
      JSON.parse(readFileSync(path.join(root, relativeOutput), "utf8"))
        .observedSha,
      SHA_B,
    );
    const duplicate = command(root, process.execPath, args);
    assert.equal(duplicate.status, 1);
    assert.match(duplicate.stderr, /EEXIST/);
    const unsafe = command(root, process.execPath, [
      ...args.slice(0, -1),
      "review-result.json",
    ]);
    assert.equal(unsafe.status, 1);
    assert.match(unsafe.stderr, /--output must be/);
  }));

test("refinement-result/v1 is compact, identified, and deduplicable", () => {
  const result = validateRefinementResult(
    {
      schemaVersion: "refinement-result/v1",
      eventKey: "task-42:refinement:dependency:1",
      revision: 1,
      issueKey: "TASK-42",
      sourceRef: "https://github.com/example/project/issues/42",
      mutationSummary: "Added the verified prerequisite link.",
      readiness: "blocked",
      blockers: ["TASK-41 must merge"],
      dependencyLinks: [{ id: "10081", direction: "TASK-41 blocks TASK-42" }],
    },
    { eventKey: "task-42:refinement:dependency:1" },
  );
  assert.equal(result.issueKey, "TASK-42");
  assert.ok(JSON.stringify(result).length < 1_000);
  assert.equal(
    validateRefinementResult({
      ...result,
      eventKey: "task-42:refinement:ready:2",
      revision: 2,
      readiness: "ready",
      blockers: [],
      dependencyLinks: [],
    }).readiness,
    "ready",
  );
});

test("gate-selection/v2 permits proportionate dual skip only for localized no-risk work", () => {
  assert.equal(
    validateGateSelection(selection()).actual.test.decision,
    "skipped",
  );
  assert.throws(
    () =>
      validateGateSelection(
        selection({
          classification: "standard",
          risk: { ...selection().risk, behaviorOrLogic: true },
        }),
      ),
    /both gates may be skipped only/,
  );
  assert.throws(
    () =>
      validateGateSelection(
        selection({ summary: "Contact +55 (11) 99999-1234 before handoff." }),
      ),
    /selection contains unsafe data/,
  );
});

test("ready handoff records actual gate outcomes and preserves publication warnings", () => {
  const ready = selection({
    commands: [
      {
        command: "npm run verify:ci",
        status: "PASS",
        exitCode: 0,
        durationMs: 100,
        summary: "The complete local CI-equivalent suite passed.",
        artifacts: [],
      },
    ],
    outcomes: {
      review: {
        status: "SKIPPED",
        observedSha: null,
        summary:
          "Independent review was not useful for the isolated final diff.",
        evidenceUrl: null,
      },
      test: {
        status: "SKIPPED",
        observedSha: null,
        summary:
          "Focused Worker validation fully covered the acceptance behavior.",
        evidenceUrl: null,
      },
      ci: {
        status: "PASS",
        observedSha: SHA_A,
        runUrl: "https://github.com/example/project/actions/runs/123",
        summary: "The PR-triggered CI workflow completed successfully.",
      },
      warnings: ["The optional GitHub summary comment could not be created."],
    },
  });
  assert.equal(
    validateReadyHandoff(validateGateSelection(ready)).outcomes.test.status,
    "SKIPPED",
  );
  assert.throws(
    () =>
      validateReadyHandoff(
        validateGateSelection({
          ...ready,
          actual: {
            ...ready.actual,
            review: {
              decision: "required",
              rationale: "Logic review adds confidence.",
            },
          },
        }),
      ),
    /review outcome APPROVED/,
  );
  assert.throws(
    () =>
      validateReadyHandoff(
        validateGateSelection({
          ...ready,
          commands: [
            {
              command: "npm run test:codex-workflow",
              status: "FAIL",
              exitCode: 1,
              durationMs: 10,
              summary: "The focused workflow suite failed.",
              artifacts: [],
            },
          ],
        }),
      ),
    /every recorded command to pass/,
  );
  assert.throws(
    () =>
      validateReadyHandoff(
        validateGateSelection({
          ...ready,
          acceptance: [
            {
              criterion: "Localized change",
              status: "FAIL",
              evidence: "Regression found",
            },
          ],
        }),
      ),
    /every acceptance item to pass/,
  );
  assert.throws(
    () =>
      validateReadyHandoff(
        validateGateSelection({
          ...ready,
          outcomes: {
            ...ready.outcomes,
            ci: { ...ready.outcomes.ci, status: "FAIL" },
          },
        }),
      ),
    /CI outcome PASS/,
  );
  assert.throws(
    () =>
      validateReadyHandoff(
        validateGateSelection({
          ...ready,
          outcomes: {
            ...ready.outcomes,
            ci: { ...ready.outcomes.ci, observedSha: SHA_B },
          },
        }),
      ),
    /CI observedSha to match/,
  );
  assert.throws(
    () =>
      validateGateSelection({
        ...ready,
        outcomes: {
          ...ready.outcomes,
          ci: {
            ...ready.outcomes.ci,
            runUrl: "https://example.com/actions/runs/123",
          },
        },
      }),
    /GitHub Actions run URL/,
  );
  const outcomesWithoutCi = { ...ready.outcomes };
  delete outcomesWithoutCi.ci;
  assert.throws(
    () => validateGateSelection({ ...ready, outcomes: outcomesWithoutCi }),
    /outcomes\.ci/,
  );
  const comment = buildEvidenceComment({
    marker: "[handoff]",
    result: ready,
    profile: "general",
    attachments: [],
    gate: "handoff",
  });
  assert.match(comment, /Reviewer: SKIPPED/);
  assert.match(comment, /CI: PASS/);
  assert.match(comment, /GitHub Actions run/);
  assert.match(comment, /Non-blocking publication warnings/);
});

test("evidence requires safe captioned profile proof and embeds published screenshots", () =>
  withTempDirectory((root) => {
    const directory = path.join(root, ".agents", "evidence", "TASK-42", SHA_A);
    mkdirSync(directory, { recursive: true });
    const screenshot = path.join(directory, "final.png");
    const log = path.join(directory, "checks.log");
    writeFileSync(screenshot, screenshotFixture());
    writeFileSync(log, "npm test: PASS\n", "utf8");
    const relativeScreenshot = `.agents/evidence/TASK-42/${SHA_A}/final.png`;
    const relativeLog = `.agents/evidence/TASK-42/${SHA_A}/checks.log`;
    const files = resolveEvidenceFiles({
      repositoryRoot: root,
      issueKey: "TASK-42",
      observedSha: SHA_A,
      files: [relativeScreenshot, relativeLog],
      metadata: [
        {
          path: relativeScreenshot,
          caption: "Final dashboard state",
          acceptanceCriteria: ["Visible state"],
        },
        {
          path: relativeLog,
          caption: "Focused command output",
          acceptanceCriteria: ["Regression check"],
        },
      ],
    });
    assert.deepEqual(
      artifactMetadata({
        artifacts: [],
        commands: [
          {
            artifacts: [
              {
                path: relativeLog,
                caption: "Command-scoped focused output",
                acceptanceCriteria: ["Regression check"],
              },
            ],
          },
        ],
      }),
      [
        {
          path: relativeLog,
          caption: "Command-scoped focused output",
          acceptanceCriteria: ["Regression check"],
        },
      ],
    );
    validateEvidenceProfile("mixed", files, { gate: "test", verdict: "PASS" });
    assert.throws(
      () =>
        validateEvidenceProfile("frontend", [files[1]], {
          gate: "test",
          verdict: "PASS",
        }),
      /requires a screenshot/,
    );
    const comment = buildEvidenceComment({
      marker: "[marker]",
      result: reviewResult(),
      profile: "mixed",
      gate: "test",
      attachments: files.map((file, index) => ({
        ...file,
        id: String(index + 1),
        filename: path.basename(file.suppliedPath),
        url: `https://example.atlassian.net/secure/attachment/${index + 1}/${path.basename(file.suppliedPath)}`,
      })),
    });
    assert.match(
      comment,
      /!\[Final dashboard state\]\(https:\/\/example\.atlassian\.net\/secure\/attachment\/1\/final\.png\)/,
    );
    assert.match(comment, /Final dashboard state/);
    assert.match(
      comment,
      /\[#9\]\(https:\/\/github\.com\/example\/project\/pull\/9\)/,
    );
    writeFileSync(path.join(directory, "tiny.png"), screenshotFixture(1, 1));
    assert.throws(
      () =>
        resolveEvidenceFiles({
          repositoryRoot: root,
          issueKey: "TASK-42",
          observedSha: SHA_A,
          files: [`.agents/evidence/TASK-42/${SHA_A}/tiny.png`],
        }),
      /at least 64x64/,
    );

    writeFileSync(path.join(directory, "corrupt.png"), "not an image", "utf8");
    assert.throws(
      () =>
        resolveEvidenceFiles({
          repositoryRoot: root,
          issueKey: "TASK-42",
          observedSha: SHA_A,
          files: [`.agents/evidence/TASK-42/${SHA_A}/corrupt.png`],
        }),
      /structurally valid image/,
    );

    writeFileSync(
      path.join(directory, "unsafe.log"),
      `Bearer ${"q".repeat(30)}`,
      "utf8",
    );
    assert.throws(
      () =>
        resolveEvidenceFiles({
          repositoryRoot: root,
          issueKey: "TASK-42",
          observedSha: SHA_A,
          files: [`.agents/evidence/TASK-42/${SHA_A}/unsafe.log`],
        }),
      /unsafe data/,
    );
    writeFileSync(path.join(directory, "unsupported.exe"), "fixture", "utf8");
    assert.throws(
      () =>
        resolveEvidenceFiles({
          repositoryRoot: root,
          issueKey: "TASK-42",
          observedSha: SHA_A,
          files: [`.agents/evidence/TASK-42/${SHA_A}/unsupported.exe`],
        }),
      /unsupported extension/,
    );
    writeFileSync(
      path.join(directory, "oversized.log"),
      "x".repeat(512 * 1024 + 1),
      "utf8",
    );
    assert.throws(
      () =>
        resolveEvidenceFiles({
          repositoryRoot: root,
          issueKey: "TASK-42",
          observedSha: SHA_A,
          files: [`.agents/evidence/TASK-42/${SHA_A}/oversized.log`],
        }),
      /512 KiB/,
    );
  }));

test("symlink evidence is rejected when the platform permits creating the fixture", (context) =>
  withTempDirectory((root) => {
    const directory = path.join(root, ".agents", "evidence", "TASK-42", SHA_A);
    mkdirSync(directory, { recursive: true });
    const outside = path.join(root, "outside.log");
    const link = path.join(directory, "linked.log");
    writeFileSync(outside, "safe\n", "utf8");
    try {
      symlinkSync(outside, link, "file");
    } catch {
      context.skip("symlink creation is unavailable on this Windows host");
      return;
    }
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.throws(
      () =>
        resolveEvidenceFiles({
          repositoryRoot: root,
          issueKey: "TASK-42",
          observedSha: SHA_A,
          files: [`.agents/evidence/TASK-42/${SHA_A}/linked.log`],
        }),
      /symlink/,
    );
  }));

test("Markdown plans register only a reference and preserve the full implementation handoff", () =>
  withTempDirectory((root) => {
    createGitRepository(root);
    const script = path.join(SCRIPT_DIRECTORY, "task-state.mjs");
    const planPath = ".agents/task-state/TASK-42-plan.md";
    const absolutePath = path.join(root, planPath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    const plan =
      "# TASK-42 Implementation plan\n\n## Design\nPreserve existing queue IDs on retry.\n\n" +
      "## Implementation\nEdit the existing producer, reuse createQueueJobId; do not add a second retry loop.\n\n" +
      "## Validation\nA failed publish leaves the source message undeleted; a successful publish deletes it once.\n";
    writeFileSync(absolutePath, plan);
    const invoke = (revision, requestedPath = planPath) =>
      command(root, process.execPath, [
        script,
        "record-plan",
        "--issue",
        "TASK-42",
        "--revision",
        String(revision),
        "--path",
        requestedPath,
      ]);
    const missingRevision = invoke(0);
    assert.equal(missingRevision.status, 1);
    assert.match(missingRevision.stderr, /positive revision/);
    const first = invoke(1);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(invoke(1).stdout).status, "already-recorded");
    assert.equal(readFileSync(absolutePath, "utf8"), plan);
    const state = JSON.parse(
      readFileSync(path.join(root, ".agents/task-state/TASK-42.json"), "utf8"),
    );
    assert.deepEqual(state.implementationPlan, {
      schemaVersion: "implementation-plan/v4",
      path: planPath,
      revision: 1,
    });
    assert.equal(state.simplicityWarnings, undefined);
    const revised = `${plan}\n## Amendment\nHandle partial publish results per message.\n`;
    writeFileSync(absolutePath, revised);
    const amended = invoke(2);
    assert.equal(amended.status, 0, amended.stderr);
    assert.equal(invoke(1).status, 1);
    assert.equal(readFileSync(absolutePath, "utf8"), revised);
    assert.equal(invoke(3, ".agents/task-state/TASK-43-plan.md").status, 1);
    assert.equal(invoke(3, ".agents/task-state/TASK-42-plan.json").status, 1);
    writeFileSync(
      absolutePath,
      "# TASK-43 Implementation plan\n\nOther issue.\n",
    );
    assert.equal(invoke(3).status, 1);
    writeFileSync(
      absolutePath,
      "# TASK-420 Implementation plan\n\nOther issue with the same prefix.\n",
    );
    assert.equal(invoke(3).status, 1);
    writeFileSync(absolutePath, "# TASK-42 Implementation plan\n\n");
    assert.equal(invoke(3).status, 1);
    assert.equal(git(root, ["status", "--short"]), "");
  }));

test("code-first handoffs accept short cleanup and detailed async instructions without extra document sections", () =>
  withTempDirectory((root) => {
    createGitRepository(root);
    const examples = [
      [
        "TASK-201",
        [
          "1. Add /outputs/generated/ to .gitignore; keep outputs/build.mjs tracked and unchanged.",
          "2. Delete outputs/generated/report.xlsx from the index; do not change product code.",
          "3. Verify git diff --cached --name-status shows only .gitignore and the deletion.",
          "4. Run git check-ignore --no-index outputs/generated/report.xlsx; expect the new rule.",
        ],
      ],
      [
        "TASK-202",
        [
          "1. In src/consumer.ts:startLease replace setInterval with one awaited renewal loop; retain the existing abortable wait helper.",
          "2. Return stop(): Promise<boolean>. Start owned; ReceiptHandleIsInvalid sets lost and exits. Wait timeoutMs / 2 before each renewal; never overlap calls.",
          "3. stop aborts and awaits the loop, returning false if lost; completion cancellation is not a renewal failure.",
          "4. In handleMessage invoke the processor once; on success await stop and delete only if true. On processor failure await stop, report once, and never delete.",
          "5. In src/consumer.test.ts use fake time and deferred renewal: completion aborts/settles renewal before one delete; loss before completion yields zero deletes; max active renewals stays one.",
          "6. Run node --test src/consumer.test.ts; assert one processor call and no pending timers in both races.",
        ],
      ],
    ];
    for (const [issue, steps] of examples) {
      const relative = `.agents/task-state/${issue}-plan.md`;
      const absolute = path.join(root, relative);
      mkdirSync(path.dirname(absolute), { recursive: true });
      const markdown = `# ${issue} Implementation plan\n\n${steps.join("\n")}\n`;
      writeFileSync(absolute, markdown);
      const result = command(root, process.execPath, [
        path.join(SCRIPT_DIRECTORY, "task-state.mjs"),
        "record-plan",
        "--issue",
        issue,
        "--revision",
        "1",
        "--path",
        relative,
      ]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(absolute, "utf8"), markdown);
      const state = JSON.parse(
        readFileSync(
          path.join(root, `.agents/task-state/${issue}.json`),
          "utf8",
        ),
      );
      assert.deepEqual(state.implementationPlan, {
        schemaVersion: "implementation-plan/v4",
        path: relative,
        revision: 1,
      });
    }
  }));

test("Planner and Worker share the saved plan and checkout with explicit task identities", () =>
  withTempDirectory((root) => {
    createGitRepository(root);
    const script = path.join(SCRIPT_DIRECTORY, "task-state.mjs");
    const invoke = (args) => command(root, process.execPath, [script, ...args]);
    const register = [
      "register-task",
      "--issue",
      "TASK-42",
      "--role",
      "planner",
      "--thread",
      "planner-task-1",
      "--kind",
      "task",
      "--worktree",
      root,
      "--branch",
      "codex/task-42-recovery",
    ];
    assert.equal(invoke(register).status, 0);
    assert.equal(
      JSON.parse(invoke(register).stdout).status,
      "already-recorded",
    );
    const show = () =>
      JSON.parse(invoke(["show", "--issue", "TASK-42"]).stdout);
    assert.equal(show().tasks.worker, undefined);
    assert.equal(show().tasks.planner.kind, "task");
    const planPath = ".agents/task-state/TASK-42-plan.md";
    const plan =
      "# TASK-42 Implementation plan\n\n## Design\nReuse the existing owner.\n";
    writeFileSync(path.join(root, planPath), plan);
    assert.equal(
      invoke([
        "record-plan",
        "--issue",
        "TASK-42",
        "--revision",
        "1",
        "--path",
        planPath,
      ]).status,
      0,
    );
    const worker = [
      "register-task",
      "--issue",
      "TASK-42",
      "--role",
      "worker",
      "--thread",
      "worker-task-1",
      "--branch",
      "codex/task-42-recovery",
    ];
    assert.equal(
      invoke([...worker, "--worktree", path.join(root, "another")]).status,
      1,
    );
    assert.equal(invoke([...worker, "--worktree", root]).status, 0);
    assert.equal(show().tasks.worker.worktree, show().tasks.planner.worktree);
    assert.equal(
      readFileSync(
        path.join(show().tasks.worker.worktree, show().implementationPlan.path),
        "utf8",
      ),
      plan,
    );
    assert.equal(
      invoke([...register, "--thread", "duplicate-planner"]).status,
      1,
    );
    assert.equal(invoke([...register, "--kind", "subagent"]).status, 1);
    const event = [
      "record-event",
      "--issue",
      "TASK-42",
      "--event",
      "task-42:planner:approved:1",
      "--target",
      "coordinator-1",
    ];
    assert.equal(JSON.parse(invoke(event).stdout).status, "recorded");
    assert.equal(JSON.parse(invoke(event).stdout).status, "already-recorded");
    const missingKind = [
      "register-task",
      "--issue",
      "TASK-43",
      "--role",
      "planner",
      "--thread",
      "planner-43",
    ];
    assert.equal(invoke(missingKind).status, 1);
    assert.equal(invoke([...missingKind, "--kind", "invalid"]).status, 1);
    assert.equal(invoke([...missingKind, "--kind", "task"]).status, 0);
  }));

test("task state suppresses duplicate tasks and messages while rejecting conflicts", () =>
  withTempDirectory((root) => {
    createGitRepository(root);
    const script = path.join(SCRIPT_DIRECTORY, "task-state.mjs");
    const invoke = (args, options = {}) =>
      command(root, process.execPath, [script, ...args], options);
    const help = invoke(["--help"]);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Maintain ignored task-family identity/);
    const register = [
      "register-task",
      "--issue",
      "TASK-42",
      "--role",
      "worker",
      "--thread",
      "worker-1",
      "--worktree",
      root,
    ];
    assert.equal(JSON.parse(invoke(register).stdout).status, "recorded");
    assert.equal(
      JSON.parse(invoke(register).stdout).status,
      "already-recorded",
    );
    const planner = [
      "register-task",
      "--issue",
      "TASK-42",
      "--role",
      "planner",
      "--thread",
      "planner-task-1",
      "--kind",
      "task",
      "--worktree",
      root,
      "--branch",
      "codex/task-42-recovery",
    ];
    assert.equal(JSON.parse(invoke(planner).stdout).status, "recorded");
    assert.equal(JSON.parse(invoke(planner).stdout).status, "already-recorded");
    const duplicatePlanner = invoke([
      "register-task",
      "--issue",
      "TASK-42",
      "--role",
      "planner",
      "--thread",
      "duplicate-task-2",
      "--kind",
      "task",
    ]);
    assert.equal(duplicatePlanner.status, 1);
    assert.match(duplicatePlanner.stderr, /planner is already registered/);
    assert.equal(
      JSON.parse(invoke(["show", "--issue", "TASK-42"]).stdout).tasks.planner
        .threadId,
      "planner-task-1",
    );
    const route = [
      "record-route",
      "--issue",
      "TASK-42",
      "--classification",
      "bounded",
      "--signal",
      "infrastructureOrDeployment",
      "--rationale",
      "The implementation is bounded despite its operational acceptance criteria.",
    ];
    assert.equal(JSON.parse(invoke(route).stdout).status, "recorded");
    assert.equal(JSON.parse(invoke(route).stdout).status, "already-recorded");
    const stateAfterRoute = JSON.parse(
      invoke(["show", "--issue", "TASK-42"]).stdout,
    );
    assert.equal(stateAfterRoute.schemaVersion, "task-state/v2");
    assert.equal(stateAfterRoute.workflowProtocol, "delivery-v3");
    assert.equal(stateAfterRoute.executionRoute.model, "gpt-6-luna");
    assert.equal(stateAfterRoute.executionRoute.reasoningEffort, "xhigh");
    const routeConflict = invoke([
      "record-route",
      "--issue",
      "TASK-42",
      "--classification",
      "standard",
      "--rationale",
      "A conflicting retry must not replace the recorded runtime.",
    ]);
    assert.equal(routeConflict.status, 1);
    assert.match(
      routeConflict.stderr,
      /already recorded with a different identity/,
    );
    assert.equal(stateAfterRoute.tasks.worker.threadId, "worker-1");
    assert.equal(
      path.resolve(stateAfterRoute.tasks.worker.worktree),
      path.resolve(root),
    );
    const context = [
      "record-context",
      "--issue",
      "TASK-42",
      "--revision",
      "1",
      "--path",
      ".agents/task-context/TASK-42.md",
    ];
    assert.equal(JSON.parse(invoke(context).stdout).status, "recorded");
    assert.equal(JSON.parse(invoke(context).stdout).status, "already-recorded");
    assert.equal(
      JSON.parse(invoke(["show", "--issue", "TASK-42"]).stdout).context
        .materialRevision,
      1,
    );
    writeFileSync(
      path.join(root, ".agents", "task-state", "TASK-42-plan.md"),
      "# TASK-42 Implementation plan\n\nReuse the workflow owner and run focused checks.\n",
      "utf8",
    );
    const recordPlan = () =>
      invoke([
        "record-plan",
        "--issue",
        "TASK-42",
        "--revision",
        "1",
        "--path",
        ".agents/task-state/TASK-42-plan.md",
      ]);
    assert.equal(JSON.parse(recordPlan().stdout).status, "recorded");
    assert.equal(JSON.parse(recordPlan().stdout).status, "already-recorded");
    const stateAfterPlan = JSON.parse(
      invoke(["show", "--issue", "TASK-42"]).stdout,
    );
    assert.equal(
      stateAfterPlan.implementationPlan.schemaVersion,
      "implementation-plan/v4",
    );
    const conflict = invoke([
      "register-task",
      "--issue",
      "TASK-42",
      "--role",
      "worker",
      "--thread",
      "worker-2",
      "--worktree",
      root,
      "--branch",
      "codex/task-42-recovery",
    ]);
    assert.equal(conflict.status, 1);
    assert.match(conflict.stderr, /another active task/);
    const event = [
      "record-event",
      "--issue",
      "TASK-42",
      "--event",
      "task-42:worker:start:1",
      "--target",
      "worker-1",
    ];
    assert.equal(JSON.parse(invoke(event).stdout).status, "recorded");
    assert.equal(JSON.parse(invoke(event).stdout).status, "already-recorded");
    const reviewer = [
      "register-task",
      "--issue",
      "TASK-42",
      "--role",
      "reviewer",
      "--thread",
      "reviewer-1",
      "--worktree",
      root,
    ];
    assert.equal(JSON.parse(invoke(reviewer).stdout).status, "recorded");
    const begin = [
      "begin-gate",
      "--issue",
      "TASK-42",
      "--gate",
      "review",
      "--thread",
      "reviewer-1",
      "--worktree",
      root,
      "--sha",
      SHA_A,
    ];
    assert.equal(JSON.parse(invoke(begin).stdout).status, "recorded");
    assert.equal(JSON.parse(invoke(begin).stdout).status, "already-recorded");
    const conflictingGate = invoke([
      "begin-gate",
      "--issue",
      "TASK-42",
      "--gate",
      "test",
      "--thread",
      "tester-1",
      "--worktree",
      root,
      "--sha",
      SHA_A,
    ]);
    assert.equal(conflictingGate.status, 1);
    assert.match(
      conflictingGate.stderr,
      /tester task identity|another checkout gate/,
    );
    const wrongRelease = invoke([
      "end-gate",
      "--issue",
      "TASK-42",
      "--gate",
      "review",
      "--thread",
      "reviewer-2",
    ]);
    assert.equal(wrongRelease.status, 1);
    assert.match(wrongRelease.stderr, /release identity/);
    const end = [
      "end-gate",
      "--issue",
      "TASK-42",
      "--gate",
      "review",
      "--thread",
      "reviewer-1",
    ];
    assert.equal(JSON.parse(invoke(end).stdout).status, "recorded");
    assert.equal(JSON.parse(invoke(end).stdout).status, "already-recorded");
    writeFileSync(
      path.join(root, ".agents", "task-state", "TASK-43.json"),
      JSON.stringify({
        schemaVersion: "task-state/v1",
        issueKey: "TASK-43",
        tasks: {},
        gates: {},
        deliveredEvents: {},
      }),
      "utf8",
    );
    const rejected = invoke(["show", "--issue", "TASK-43"]);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /task-state schema/);
    assert.equal(git(root, ["status", "--short"]), "");
  }));

test("linked worktrees copy shared task state locally before mutation", () =>
  withTempDirectory((root) => {
    createGitRepository(root);
    const script = path.join(SCRIPT_DIRECTORY, "task-state.mjs");
    const invoke = (cwd, args) =>
      command(cwd, process.execPath, [script, ...args]);
    const register = [
      "register-task",
      "--issue",
      "TASK-42",
      "--role",
      "worker",
      "--thread",
      "worker-1",
      "--worktree",
      path.join(root, "worker"),
    ];
    assert.equal(invoke(root, register).status, 0);
    const worktree = path.join(root, "worker");
    git(root, ["worktree", "add", "-b", "codex/task-42-local-state", worktree]);
    const localEvent = [
      "record-event",
      "--issue",
      "TASK-42",
      "--event",
      "task-42:worker:local:1",
      "--target",
      "worker-1",
    ];
    const recorded = invoke(worktree, localEvent);
    assert.equal(recorded.status, 0, recorded.stderr);
    const localPath = path.join(
      worktree,
      ".agents",
      "task-state",
      "TASK-42.json",
    );
    const sharedPath = path.join(root, ".agents", "task-state", "TASK-42.json");
    assert.equal(existsSync(localPath), true);
    assert.equal(
      JSON.parse(readFileSync(localPath, "utf8")).deliveredEvents[
        "task-42:worker:local:1"
      ],
      "worker-1",
    );
    assert.equal(
      JSON.parse(readFileSync(sharedPath, "utf8")).deliveredEvents[
        "task-42:worker:local:1"
      ],
      undefined,
    );
    assert.equal(
      JSON.parse(invoke(worktree, ["show", "--issue", "TASK-42"]).stdout).tasks
        .worker.threadId,
      "worker-1",
    );
  }));

test("delta assessment distinguishes carry-forward, targeted delta, and rewritten history", () =>
  withTempDirectory((root) => {
    createGitRepository(root);
    const first = git(root, ["rev-parse", "HEAD"]);
    writeFileSync(
      path.join(root, "feature.js"),
      "export const value = 1;\n",
      "utf8",
    );
    git(root, ["add", "feature.js"]);
    git(root, ["commit", "-m", "feature"]);
    const second = git(root, ["rev-parse", "HEAD"]);
    const script = path.join(SCRIPT_DIRECTORY, "gate.mjs");
    const invoke = (from, to, impact) =>
      command(root, process.execPath, [
        script,
        "assess",
        "--gate",
        "review",
        "--from",
        from,
        "--to",
        to,
        "--impact",
        impact,
        "--rationale",
        "This describes the observed gate impact.",
      ]);
    const carryForward = JSON.parse(invoke(first, second, "irrelevant").stdout);
    assert.equal(carryForward.schemaVersion, "gate-delta-assessment/v1");
    assert.equal(carryForward.action, "carry-forward");
    assert.equal(
      JSON.parse(invoke(first, second, "affected").stdout).action,
      "targeted-delta",
    );
    git(root, ["switch", "-c", "rewrite", first]);
    writeFileSync(
      path.join(root, "alternate.js"),
      "export const alternate = true;\n",
      "utf8",
    );
    git(root, ["add", "alternate.js"]);
    git(root, ["commit", "-m", "alternate"]);
    const rewritten = git(root, ["rev-parse", "HEAD"]);
    const assessment = JSON.parse(
      invoke(second, rewritten, "irrelevant").stdout,
    );
    assert.equal(assessment.rewrittenHistory, true);
    assert.equal(assessment.action, "coherent-recheck");
  }));

test("Unified report PR summary is text-only, optionally links published evidence, and never requests browser publication", () =>
  withTempDirectory((root) => {
    createGitRepository(root);
    const resultPath = path.join(root, "review.json");
    writeFileSync(resultPath, JSON.stringify(reviewResult()), "utf8");
    const script = path.join(SCRIPT_DIRECTORY, "prepare-report.mjs");
    const prepared = command(root, process.execPath, [
      script,
      "--issue",
      "TASK-42",
      "--pr",
      "9",
      "--gate",
      "review",
      "--profile",
      "general",
      "--head-branch",
      "codex/task-42-recovery",
      "--result",
      "review.json",
      "--evidence-url",
      "https://example.atlassian.net/browse/TASK-42?focusedCommentId=123",
    ]);
    assert.equal(prepared.status, 0, prepared.stderr);
    const output = JSON.parse(prepared.stdout).prComment;
    assert.deepEqual(output.nativeUploads, []);
    assert.equal(output.browserRequired, false);
    assert.match(output.body, /Delivery evidence/);
    assert.doesNotMatch(output.body, /upload|sign in/i);
    writeFileSync(
      path.join(root, "incomplete-handoff.json"),
      JSON.stringify(selection()),
      "utf8",
    );
    const falseReady = command(root, process.execPath, [
      script,
      "--issue",
      "TASK-42",
      "--pr",
      "9",
      "--gate",
      "handoff",
      "--head-branch",
      "codex/task-42-recovery",
      "--result",
      "incomplete-handoff.json",
      "--evidence-url",
      "https://example.atlassian.net/browse/TASK-42?focusedCommentId=123",
    ]);
    assert.equal(falseReady.status, 1);
    assert.match(falseReady.stderr, /requires gate outcomes/);
  }));

test("delivery evidence preparation is local-only and connector-ready", () =>
  withTempDirectory((root) => {
    createGitRepository(root);
    const evidenceDirectory = path.join(
      root,
      ".agents",
      "evidence",
      "TASK-42",
      SHA_A,
    );
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(
      path.join(evidenceDirectory, "review.log"),
      "review checks: PASS\n",
      "utf8",
    );
    const artifactPath = `.agents/evidence/TASK-42/${SHA_A}/review.log`;
    writeFileSync(
      path.join(root, "review.json"),
      JSON.stringify(
        reviewResult({
          artifacts: [
            {
              path: artifactPath,
              caption: "Review checks",
              acceptanceCriteria: ["One local context"],
            },
          ],
        }),
      ),
      "utf8",
    );
    const statusBeforePreparation = git(root, ["status", "--short"]);
    const script = path.join(SCRIPT_DIRECTORY, "prepare-report.mjs");
    const published = command(root, process.execPath, [
      script,
      "--issue",
      "TASK-42",
      "--pr",
      "9",
      "--gate",
      "review",
      "--head-branch",
      "codex/task-42-recovery",
      "--profile",
      "backend",
      "--result",
      "review.json",
      "--dry-run",
    ]);
    assert.equal(published.status, 0, published.stderr);
    const output = JSON.parse(published.stdout);
    assert.equal(output.status, "dry-run");
    assert.equal("github" in output, false);
    assert.equal("uploads" in output, false);
    assert.deepEqual(output.publication, {
      performed: false,
      destination: null,
    });
    assert.match(output.commentBody, /^\[corch-validation:v2/m);
    assert.match(output.commentBody, /Validated evidence metadata/);
    assert.match(output.commentBody, /artifacts are retained locally/);

    const prepared = command(root, process.execPath, [
      script,
      "--issue",
      "TASK-42",
      "--pr",
      "9",
      "--gate",
      "review",
      "--head-branch",
      "codex/task-42-recovery",
      "--profile",
      "backend",
      "--result",
      "review.json",
    ]);
    assert.equal(prepared.status, 0, prepared.stderr);
    const preparedOutput = JSON.parse(prepared.stdout);
    assert.equal(preparedOutput.status, "prepared");
    assert.deepEqual(preparedOutput.publication, {
      performed: false,
      destination: null,
    });
    assert.equal(git(root, ["status", "--short"]), statusBeforePreparation);
  }));

test("one report invocation renders consistent review, test and ready handoff views without writes", () =>
  withTempDirectory((root) => {
    createGitRepository(root);
    const artifactPath = `.agents/evidence/TASK-42/${SHA_A}/checks.log`;
    const log = "Focused checks: PASS\n";
    mkdirSync(path.dirname(path.join(root, artifactPath)), { recursive: true });
    writeFileSync(path.join(root, artifactPath), log);
    const artifact = { path: artifactPath, caption: "Focused checks", acceptanceCriteria: ["One local context"] };
    const skipped = { status: "SKIPPED", observedSha: null, summary: "Proportionate skip.", evidenceUrl: null };
    const handoff = selection({
      evidenceProfile: "backend",
      acceptance: reviewResult().acceptance,
      commands: [{ ...testResult().commands[0], command: "npm run verify:ci", artifacts: [artifact] }],
      outcomes: {
        review: skipped, test: skipped,
        ci: { status: "PASS", observedSha: SHA_A, runUrl: "https://github.com/example/project/actions/runs/123", summary: "Current-head CI passed." },
        warnings: ["Attachment support unavailable; evidence retained locally."],
      },
    });
    for (const [gate, model] of [
      ["review", reviewResult({ artifacts: [artifact] })],
      ["test", testResult({ artifacts: [artifact] })],
      ["handoff", handoff],
    ]) {
      const resultPath = path.join(root, "result.json");
      const source = JSON.stringify(model);
      writeFileSync(resultPath, source);
      const status = git(root, ["status", "--short", "--untracked-files=all"]);
      const args = [path.join(SCRIPT_DIRECTORY, "prepare-report.mjs"),
        "--issue", "TASK-42", "--pr", "9", "--gate", gate,
        "--head-branch", "codex/task-42-recovery", "--result", resultPath,
        ...(gate === "handoff" ? [] : ["--profile", "backend"])];
      const invoke = (extra = []) => command(root, process.execPath, [...args, ...extra]);
      const prepared = invoke();
      assert.equal(prepared.status, 0, prepared.stderr);
      const report = JSON.parse(prepared.stdout);
      assert.equal(report.observedSha, SHA_A);
      assert.equal(report.result, model.schemaVersion);
      assert.equal(report.prComment.marker, buildPullRequestCommentMarker({
        issueKey: model.issueKey, pullRequestNumber: 9, observedSha: SHA_A, gate,
      }));
      assert.equal(report.marker, gate === "handoff"
        ? buildGateSelectionMarker({ issueKey: model.issueKey, pullRequestNumber: 9,
            observedSha: SHA_A, review: "skipped", test: "skipped" })
        : `[corch-validation:v2 schema=${model.schemaVersion} issue=TASK-42 observed=${SHA_A} gate=${gate}]`);
      for (const body of [report.commentBody, report.prComment.body]) {
        assert.ok(body.includes(SHA_A));
        assert.ok(body.includes(model.summary));
        assert.ok(body.includes("One local context"));
        if (gate === "handoff") {
          assert.match(body, /Reviewer: SKIPPED|Reviewer: \*\*SKIPPED/);
          assert.match(body, /CI: PASS|CI: \*\*PASS/);
        } else assert.ok(body.includes(model.verdict));
      }
      if (gate === "handoff") assert.ok(report.commentBody.includes(handoff.outcomes.warnings[0]));
      assert.deepEqual(report.publication, { performed: false, destination: null });
      assert.equal(report.prComment.evidenceUrl, null);
      assert.equal(report.files.length, 1);
      const digest = createHash("sha256").update(log).digest("hex");
      assert.deepEqual(report.files[0], {
        filename: `TASK-42_${SHA_A.slice(0, 12)}_${gate}_1_${digest.slice(0, 12)}_checks.log`,
        caption: artifact.caption, acceptanceCriteria: artifact.acceptanceCriteria,
        extension: ".log", sha256: digest, size: Buffer.byteLength(log),
      });
      const repeated = invoke();
      assert.equal(repeated.status, 0, repeated.stderr);
      assert.deepEqual(JSON.parse(repeated.stdout), report);
      const dryRun = invoke(["--dry-run"]);
      assert.equal(dryRun.status, 0, dryRun.stderr);
      assert.deepEqual(JSON.parse(dryRun.stdout), { ...report, status: "dry-run" });
      if (gate === "handoff") {
        const mismatch = invoke(["--profile", "frontend"]);
        assert.equal(mismatch.status, 1);
        assert.equal(mismatch.stdout, "");
        assert.match(mismatch.stderr, /profile must match/);
      }
      assert.equal(readFileSync(resultPath, "utf8"), source);
      assert.equal(readFileSync(path.join(root, artifactPath), "utf8"), log);
      assert.equal(git(root, ["status", "--short", "--untracked-files=all"]), status);
    }
  }));

test("report failures emit neither view and retain evidence and identity safeguards", () =>
  withTempDirectory((root) => {
    createGitRepository(root);
    const directory = `.agents/evidence/TASK-42/${SHA_A}`;
    mkdirSync(path.join(root, directory, "nested"), { recursive: true });
    writeFileSync(path.join(root, directory, "safe.log"), "Checks passed.\n");
    writeFileSync(path.join(root, directory, "nested/safe.log"), "Checks passed.\n");
    writeFileSync(path.join(root, directory, "unsafe.log"), "token=" + "z".repeat(30));
    writeFileSync(path.join(root, directory, "invalid.png"), "not a screenshot");
    const artifact = (filename, overrides = {}) => ({
      path: `${directory}/${filename}`, caption: "Focused evidence",
      acceptanceCriteria: ["One local context"], ...overrides,
    });
    const invoke = (model, gate = "review", profile = "general", extra = []) => {
      writeFileSync(path.join(root, "result.json"), JSON.stringify(model));
      return command(root, process.execPath, [path.join(SCRIPT_DIRECTORY, "prepare-report.mjs"),
        "--issue", "TASK-42", "--pr", "9", "--gate", gate,
        "--head-branch", "codex/task-42-recovery", "--result", "result.json",
        ...(profile ? ["--profile", profile] : []), ...extra]);
    };
    const cases = [
      [reviewResult({ artifacts: [artifact("missing.log")] }), "review", "general", /ENOENT/],
      [reviewResult({ artifacts: [artifact("unsafe.log")] }), "review", "general", /unsafe data/],
      [reviewResult({ artifacts: [artifact("invalid.png")] }), "review", "general", /structurally valid image/],
      [reviewResult({ artifacts: [artifact("safe.log"), artifact("nested/safe.log")] }), "review", "general", /duplicate evidence filename/],
      [reviewResult({ artifacts: [artifact("safe.log", { path: "README.md" })] }), "review", "general", /must stay under/],
      [reviewResult({ artifacts: [artifact("safe.log", { caption: "" })] }), "review", "general", /caption/],
      [reviewResult({ artifacts: [artifact("safe.log", { acceptanceCriteria: [] })] }), "review", "general", /acceptance/],
      [testResult(), "test", "backend", /requires a bounded log/],
      [testResult({ artifacts: [artifact("safe.log")] }), "test", "frontend", /requires a screenshot/],
      [reviewResult(), "review", null, /missing arguments: profile/],
      [testResult(), "test", null, /missing arguments: profile/],
      [waivedSelection(), "handoff", "frontend", /profile must match/],
      [selection(), "handoff", null, /requires gate outcomes/],
      [waivedSelection(), "handoff", null, /expected identity/, ["--pr", "10"]],
    ];
    for (const [model, gate, profile, error, extra] of cases) {
      const rejected = invoke(model, gate, profile, extra);
      assert.equal(rejected.status, 1);
      assert.equal(rejected.stdout, "", rejected.stderr);
      assert.match(rejected.stderr, error);
      assert.doesNotMatch(rejected.stderr, /z{30}/);
    }
    const missingValue = invoke(reviewResult(), "review", "general", ["--evidence-url"]);
    assert.equal(missingValue.status, 1);
    assert.match(missingValue.stderr, /requires a value/);
  }));

test("bounded checks retain sanitized logs and expose only compact summaries", () =>
  withTempDirectory((root) => {
    createGitRepository(root);
    const script = path.join(SCRIPT_DIRECTORY, "run-bounded-check.mjs");
    const success = command(root, process.execPath, [
      script,
      "--issue",
      "TASK-42",
      "--name",
      "focused-test",
      "--",
      process.execPath,
      "-e",
      "console.log('focused pass')",
      "--",
      `--api-key=${"s".repeat(30)}`,
    ]);
    assert.equal(success.status, 0, success.stderr);
    const successResult = JSON.parse(success.stdout);
    assert.equal(successResult.status, "PASS");
    assert.equal("failureTail" in successResult, false);
    assert.ok(success.stdout.length < 1_000);
    assert.match(
      readFileSync(path.join(root, successResult.logPath), "utf8"),
      /focused pass/,
    );
    assert.equal(successResult.command, path.basename(process.execPath));
    assert.doesNotMatch(success.stdout, /focused pass/);
    assert.doesNotMatch(success.stdout, /api-key|s{20}/);

    const failure = command(root, process.execPath, [
      script,
      "--issue",
      "TASK-42",
      "--name",
      "failing-test",
      "--",
      process.execPath,
      "-e",
      "console.error('token=' + 'z'.repeat(30)); console.error('x'.repeat(7000)); process.exit(3)",
    ]);
    assert.equal(failure.status, 3);
    const failureResult = JSON.parse(failure.stdout);
    assert.equal(failureResult.status, "FAIL");
    assert.ok(failureResult.failureTail.length <= 4_000);
    assert.doesNotMatch(
      readFileSync(path.join(root, failureResult.logPath), "utf8"),
      /token=z/,
    );
    assert.equal(git(root, ["status", "--short"]), "");

    const worktree = path.join(root, "worker");
    git(root, ["worktree", "add", "-b", "codex/task-42-bounded-log", worktree]);
    const linked = command(worktree, process.execPath, [
      script,
      "--issue",
      "TASK-42",
      "--name",
      "linked-check",
      "--",
      process.execPath,
      "-e",
      "console.log('linked pass')",
    ]);
    assert.equal(linked.status, 0, linked.stderr);
    const linkedResult = JSON.parse(linked.stdout);
    assert.equal(existsSync(path.join(worktree, linkedResult.logPath)), true);
    assert.equal(existsSync(path.join(root, linkedResult.logPath)), false);
  }));

test("session hooks provide direct and current task context without obsolete dispatch", () =>
  withTempDirectory((root) => {
    createGitRepository(root);
    const script = path.join(SCRIPT_DIRECTORY, "workflow-hook.mjs");
    const invoke = (cwd, action, event = {}) =>
      command(cwd, process.execPath, [script, action], {
        input: JSON.stringify({ cwd, ...event }),
      });
    const direct = invoke(root, "session-start");
    assert.equal(direct.status, 0, direct.stderr);
    const directContext = JSON.parse(direct.stdout).hookSpecificOutput
      .additionalContext;
    assert.match(
      directContext,
      /eligible bounded delivery stays in this task and checkout/,
    );
    assert.match(
      directContext,
      /Direct implementers and assigned Workers may edit/,
    );
    const hooks = JSON.parse(
      readFileSync(
        path.resolve(SCRIPT_DIRECTORY, "../../../../.codex/hooks.json"),
        "utf8",
      ),
    );
    assert.deepEqual(Object.keys(hooks.hooks).sort(), [
      "SessionStart",
      "UserPromptSubmit",
    ]);
    const stopped = invoke(root, "worker-stop");
    assert.equal(stopped.status, 1);
    assert.match(stopped.stderr, /Unknown workflow hook command/);

    const worktree = path.join(root, "worker");
    git(root, ["worktree", "add", "-b", "codex/task-77-hook", worktree]);
    mkdirSync(path.join(root, ".agents", "task-state"), { recursive: true });
    writeFileSync(
      path.join(root, ".agents", "task-state", "TASK-77.json"),
      JSON.stringify({
        schemaVersion: "task-state/v2",
        workflowProtocol: "delivery-v3",
        issueKey: "TASK-77",
        tasks: {},
        gates: {},
        deliveredEvents: {},
      }),
      "utf8",
    );
    const session = invoke(worktree, "session-start");
    assert.equal(session.status, 0, session.stderr);
    const context = JSON.parse(session.stdout).hookSpecificOutput
      .additionalContext;
    assert.match(context, /TASK-77/);
    assert.match(context, /protocol delivery-v3/);
    assert.match(context, /exact role skill/);
  }));

test("local handoff works without tracker credentials or an external evidence URL", () =>
  withTempDirectory((root) => {
    createGitRepository(root);
    writeFileSync(
      path.join(root, "handoff.json"),
      JSON.stringify(waivedSelection()),
      "utf8",
    );
    const script = path.join(SCRIPT_DIRECTORY, "prepare-report.mjs");
    const args = [
      script,
      "--issue",
      "TASK-42",
      "--pr",
      "9",
      "--gate",
      "handoff",
      "--head-branch",
      "codex/task-42-recovery",
      "--result",
      "handoff.json",
    ];
    const prepared = command(root, process.execPath, args);
    assert.equal(prepared.status, 0, prepared.stderr);
    const output = JSON.parse(prepared.stdout).prComment;
    assert.equal(output.evidenceUrl, null);
    assert.match(
      output.body,
      /READY FOR HUMAN REVIEW WITH EXPLICIT CHECK WAIVERS/,
    );
    assert.match(output.body, /Evidence is retained in local task artifacts/);
    assert.doesNotMatch(output.body, /Jira|Atlassian|undefined/);
    for (const reference of [
      "https://user:password@example.test/report",
      "javascript:alert(1)",
      "docs/private.md",
    ]) {
      const rejected = command(root, process.execPath, [
        ...args,
        "--evidence-url",
        reference,
      ]);
      assert.equal(rejected.status, 1);
      assert.match(rejected.stderr, /credential-free HTTPS/);
    }
    const linked = command(root, process.execPath, [
      ...args,
      "--evidence-url",
      "https://linear.app/example/issue/ENG-9",
    ]);
    assert.equal(linked.status, 0, linked.stderr);
    assert.equal(
      JSON.parse(linked.stdout).prComment.evidenceUrl,
      "https://linear.app/example/issue/ENG-9",
    );
  }));

test("role-specific skills are self-contained while sharing one workflow core", () => {
  const workflowRoot = path.join(SCRIPT_DIRECTORY, "..");
  const skillsRoot = path.join(workflowRoot, "..");
  const router = readFileSync(path.join(workflowRoot, "SKILL.md"), "utf8");
  const repositoryRoot = path.resolve(workflowRoot, "..", "..", "..");
  const agents = readFileSync(path.join(repositoryRoot, "AGENTS.md"), "utf8");
  const hook = readFileSync(
    path.join(SCRIPT_DIRECTORY, "workflow-hook.mjs"),
    "utf8",
  );
  const roles = new Map([
    ["corch-delivery-coordinator", [/delivery-preflight\/v1/, 7_500]],
    ["corch-refinement", [/refinement-result\/v1/, 4_500]],
    ["corch-planner", [/implementation-plan\/v4/, 4_500]],
    ["corch-worker", [/gate-selection\/v2/, 10_000]],
    ["corch-reviewer", [/review-result\/v2/, 4_500]],
    ["corch-tester", [/test-result\/v2/, 4_500]],
  ]);

  for (const [skillName, [roleMarker, ceiling]] of roles) {
    const skillPath = path.join(skillsRoot, skillName, "SKILL.md");
    assert.equal(existsSync(skillPath), true, `${skillName} is missing`);
    const content = readFileSync(skillPath, "utf8");
    const normalizedLength = content.replaceAll("\r\n", "\n").length;
    assert.match(content, new RegExp(`name: ${skillName}`));
    assert.match(content, /description: .+/);
    assert.match(content, roleMarker);
    assert.match(router, new RegExp(`\\$${skillName}`));
    assert.match(agents, new RegExp(`\\$${skillName}`));
    assert.doesNotMatch(content, /\[TODO:/);
    assert.ok(
      normalizedLength < ceiling,
      `${skillName} grew to ${normalizedLength} characters`,
    );
    assert.equal(
      existsSync(path.join(skillsRoot, skillName, "scripts")),
      false,
    );
  }

  for (const obsolete of [
    "direct-small-task.md",
    "coordinator-v2.md",
    "refinement.md",
    "planner-v3.md",
    "worker-v2.md",
    "reviewer-task-v2.md",
    "tester-task-v2.md",
  ]) {
    assert.equal(
      existsSync(path.join(workflowRoot, "references", obsolete)),
      false,
    );
  }
  assert.doesNotMatch(router, /references\/direct-small-task\.md/);
  assert.doesNotMatch(hook, /\$corch-development-workflow role contract/);
});

test("direct user revisions override project guidance without a refusal loop", () => {
  const worker = readRoleSkill("corch-worker");
  const planner = readRoleSkill("corch-planner");
  const coordinator = readRoleSkill("corch-delivery-coordinator");
  const refinement = readRoleSkill("corch-refinement");
  const reviewer = readRoleSkill("corch-reviewer");
  const tester = readRoleSkill("corch-tester");

  assert.match(worker, /follow clear user decisions over project guidance/);
  assert.match(worker, /instruction approves its own revision/);
  assert.match(worker, /Honor Reviewer, Tester, or check waivers/);
  assert.match(planner, /Never reject\s+or reinterpret/);
  assert.match(planner, /direct user decision[\s\S]*not another approval gate/);
  assert.match(coordinator, /Do not block, reverse, or reroute/);
  assert.match(refinement, /never dilute scope/);
  assert.match(reviewer, /latest user-authorized target/);
  assert.match(tester, /latest user-authorized target/);
});

test("Workers execute an authorized push instead of requesting prose approval", () => {
  const worker = readRoleSkill("corch-worker");
  assert.match(worker, /git push origin <reserved-branch>/);
  assert.match(worker, /native tool escalation/);
  assert.match(worker, /Coordinator/);
  assert.match(worker, /(?:Never stop|Never stop to ask)[\s\S]*confirmation/);
});

test("KISS and meaningful reuse govern intake, planning, implementation, and gates", () => {
  const refinement = readRoleSkill("corch-refinement");
  const planner = readRoleSkill("corch-planner");
  const worker = readRoleSkill("corch-worker");
  const reviewer = readRoleSkill("corch-reviewer");
  const tester = readRoleSkill("corch-tester");
  const coordinator = readRoleSkill("corch-delivery-coordinator");

  assert.match(refinement, /minimum\s+complete work item/);
  assert.match(
    refinement,
    /Do not turn intake into an implementation blueprint/,
  );
  assert.match(refinement, /no speculative\s+infrastructure/);
  assert.match(planner, /smallest implementation/);
  assert.match(planner, /leave short\s+coincidental repetition alone/);
  assert.match(worker, /fewest coherent\s+edits/);
  assert.match(worker, /Delete superseded code/);
  assert.match(reviewer, /unnecessary layers/);
  assert.match(reviewer, /Do not request hypothetical\s+abstractions/);
  assert.match(tester, /smallest independent check set/);
  assert.match(tester, /Do not repeat the Worker's full suite/);
  assert.match(
    coordinator,
    /minimal required\s+implementation and real blast radius/,
  );
  assert.match(coordinator, /Do not create a Worker to reserve capacity/);
  assert.match(
    coordinator,
    /create `\[TASK-N\] Planner` as a managed worktree\s+from that existing branch/,
  );
  assert.match(worker, /never wait for capacity or handoff/);
});

test(
  "Windows bootstrap resolves npm without quoted-command failure",
  {
    skip: process.platform !== "win32",
  },
  () => {
    const result = runWorktreeSetupCommand("npm", ["--version"]);
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/u);
    assert.throws(
      () => runWorktreeSetupCommand("npm", ["--version & echo unsafe"]),
      /Unsupported/,
    );
  },
);

test("Coordinator-owned worktree bootstrap prepares dependencies before Worker work", () =>
  withTempDirectory((root) => {
    const workflowRoot = path.join(SCRIPT_DIRECTORY, "..");
    const repositoryRoot = path.resolve(workflowRoot, "..", "..", "..");
    const coordinator = readRoleSkill("corch-delivery-coordinator");
    const worker = readRoleSkill("corch-worker");
    const hook = readFileSync(
      path.join(SCRIPT_DIRECTORY, "workflow-hook.mjs"),
      "utf8",
    );
    const hooks = JSON.parse(
      readFileSync(path.join(repositoryRoot, ".codex", "hooks.json"), "utf8"),
    );
    const environment = readFileSync(
      path.join(repositoryRoot, ".codex", "environments", "environment.toml"),
      "utf8",
    );
    const setupScript = path.join(
      SCRIPT_DIRECTORY,
      "prepare-worker-worktree.mjs",
    );

    assert.match(environment, /prepare-worker-worktree\.mjs/);
    assert.match(coordinator, /Coordinator owns\s+both paths/);
    assert.match(coordinator, /Never delegate configured setup steps/);
    assert.match(worker, /Never run the initial configured setup steps/);
    assert.match(hook, /prepare-worker-worktree\.mjs/);
    assert.ok(hooks.hooks.UserPromptSubmit[0].hooks[0].timeout >= 600);

    createGitRepository(root);
    const primary = command(root, process.execPath, [setupScript]);
    assert.equal(primary.status, 0, primary.stderr);
    assert.equal(JSON.parse(primary.stdout).status, "skipped-primary-checkout");
  }));

test("authoritative v3 runtime policy has compact role-specific ownership", () => {
  const coordinator = readRoleSkill("corch-delivery-coordinator");
  const worker = readRoleSkill("corch-worker");
  const tester = readRoleSkill("corch-tester");
  assert.match(coordinator, /explicit model\/thinking arguments/);
  assert.match(worker, /gate\.mjs dispatch/);
  assert.match(tester, /configured Tester runtime/);
});

test("authoritative v3 gate tasks share one serialized Worker checkout without orchestration", () => {
  const worker = readRoleSkill("corch-worker");
  const reviewer = readRoleSkill("corch-reviewer");
  const tester = readRoleSkill("corch-tester");
  assert.match(worker, /use `create_thread`/);
  assert.match(worker, /first action is `claim-gate`/);
  assert.match(reviewer, /shared checkout/);
  assert.match(tester, /shared\s+checkout/);
  assert.match(reviewer, /Never .*orchestrate/is);
  assert.match(tester, /Never .*orchestrate/is);
});

test("gate task prompts and explicit titles start with the internal task key", () => {
  const worker = readRoleSkill("corch-worker");
  const reviewer = readRoleSkill("corch-reviewer");
  const tester = readRoleSkill("corch-tester");
  assert.match(
    worker,
    /helper's exact title/,
  );
  assert.match(worker, /\$corch-reviewer/);
  assert.match(worker, /\$corch-tester/);
  assert.match(reviewer, /starts `\[TASK-N\] Reviewer`/);
  assert.match(tester, /starts `\[TASK-N\] Tester`/);
});

test("gate tasks cannot recursively fork or start in parallel", () => {
  const worker = readRoleSkill("corch-worker");
  const reviewer = readRoleSkill("corch-reviewer");
  const tester = readRoleSkill("corch-tester");

  assert.match(worker, /finish Reviewer\s+before creating Tester/);
  assert.match(worker, /before creating Tester; never in parallel/);
  assert.match(
    worker,
    /Record the returned chat ID[\s\S]*event key/,
  );
  assert.match(worker, /After\s+ambiguous creation[\s\S]*never\s+create a duplicate/);
  assert.match(worker, /Use \$corch-reviewer for this gate/);
  assert.match(worker, /Use \$corch-tester for this gate/);
  for (const gate of [reviewer, tester]) {
    assert.match(
      gate,
      /Never call `create_thread`, `fork_thread`, `handoff_thread`/,
    );
    assert.match(gate, /already the complete (?:Reviewer|Tester) task/);
  }
});

test("authoritative v3 handoff keeps Worker-owned current-head CI", () => {
  const workflowRoot = path.join(SCRIPT_DIRECTORY, "..");
  const worker = readRoleSkill("corch-worker");
  const contracts = readFileSync(
    path.join(workflowRoot, "references", "contracts.md"),
    "utf8",
  );
  assert.match(worker, /complete\s+`npm run verify:ci`/);
  assert.match(worker, /current-head\s+GitHub CI/);
  assert.match(worker, /Unwaived local and remote CI must pass for readiness/);
  assert.match(
    contracts,
    /Unwaived\s+checks retain their existing passing handoff requirements/,
  );
});

test("authoritative workflow blocks hard dependencies before Worker creation", () => {
  const workflowRoot = path.join(SCRIPT_DIRECTORY, "..");
  const coordinator = readRoleSkill("corch-delivery-coordinator");
  const refinement = readRoleSkill("corch-refinement");
  const contracts = readFileSync(
    path.join(workflowRoot, "references", "contracts.md"),
    "utf8",
  );
  assert.match(coordinator, /Start only a user-selected work item/);
  assert.match(
    coordinator,
    /Hard prerequisites require a verified directed dependency/,
  );
  assert.match(coordinator, /Only when selected work or that neighborhood contains hard or\s+coordination relationships, run `assess-delivery-preflight\.mjs`/);
  assert.match(coordinator, /Dependency-free work skips both helper and packet, including unrelated Coordinator\s+items/);
  assert.match(coordinator, /Check readiness, completion,\s+blockers, active families, ownership/);
  assert.match(contracts, /block unmet merge\/Done milestones and enforce\s+declared concurrency boundaries/);
  assert.match(contracts, /Direct delivery needs no task packets/);
  assert.match(readRoleSkill("corch-worker"), /Final handoff requires `prepare-report\.mjs`; `gate\.mjs selection`\s+is optional early feedback/);
  assert.match(coordinator, /reserved `codex\/task-n-<slug>` branch/);
  assert.match(refinement, /directed dependency/);
  assert.match(refinement, /Coordination-only/);
  assert.match(contracts, /task-context\/v3/);
});

test("static delivery-v3 boilerplate stays below token-regression ceilings", () => {
  const workflowRoot = path.join(SCRIPT_DIRECTORY, "..");
  const promptLength = (text) => text.replaceAll("\r\n", "\n").length;
  const skill = readFileSync(path.join(workflowRoot, "SKILL.md"), "utf8");
  const hook = readFileSync(
    path.join(SCRIPT_DIRECTORY, "workflow-hook.mjs"),
    "utf8",
  );
  const roleCeilings = new Map([
    ["corch-refinement", 4_500],
    ["corch-planner", 4_500],
    // Includes runtime escalation and fresh-chat dispatch/claim procedures.
    ["corch-worker", 10_000],
    ["corch-reviewer", 4_500],
    ["corch-tester", 4_500],
  ]);
  assert.ok(
    promptLength(skill) < 3_000,
    `skill router grew to ${promptLength(skill)} characters`,
  );
  assert.ok(
    promptLength(hook) < 10_000,
    `workflow hook grew to ${promptLength(hook)} characters`,
  );
  for (const [skillName, ceiling] of roleCeilings) {
    const role = readRoleSkill(skillName);
    assert.ok(
      promptLength(role) < ceiling,
      `${skillName} grew to ${promptLength(role)} characters`,
    );
  }
});

test("gate CLI help, argument rejection, sanitized errors and imports share one surface", () => {
  const script = path.join(SCRIPT_DIRECTORY, "gate.mjs");
  const invoke = (args, input) => command(SCRIPT_DIRECTORY, process.execPath, [script, ...args], input);
  assert.equal(invoke(["--help"]).status, 0);
  for (const operation of ["selection", "assess", "compose", "dispatch"]) {
    const help = invoke([operation, "--help"]);
    assert.equal(help.status, 0, help.stderr);
    assert.ok(help.stdout.includes(`gate.mjs ${operation}`));
    const secret = "sk-" + "x".repeat(28);
    const bad = invoke([operation, `--${secret}`]);
    assert.equal(bad.status, 1);
    assert.equal(bad.stdout, "");
    assert.ok(!bad.stderr.includes(secret));
  }
  for (const args of [[], ["unknown"], ["constructor", "--help"], ["__proto__", "--help"], ["dispatch", "constructor", "value"],
    ["--help", "extra"], ["assess", "--role", "review"],
    ["compose", "--role", "reviewer"], ["assess", "--gate"], ["compose", "--base", "--amendment"],
    ["selection", "--pr", "9", "--pr", "10"], ["dispatch", "--output", "unexpected.json"]]) {
    const result = invoke(args);
    assert.equal(result.status, 1, args.join(" "));
    assert.equal(result.stdout, "");
  }
  for (const json of ["{", "[]", "null"]) {
    const result = invoke(["dispatch"], { input: json });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
  }
  const imported = command(SCRIPT_DIRECTORY, process.execPath, ["--input-type=module", "-e",
    'import { assessGateDelta, buildGateDispatch } from "./gate.mjs"; if (typeof assessGateDelta !== "function" || typeof buildGateDispatch !== "function") process.exit(1);']);
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, "");
  assert.equal(imported.stderr, "");
});

test("workflow inventory is nine executables and nine acyclic internal owners", () => {
  const executables = ["workflow-hook", "prepare-worker-worktree", "materialize-task-context", "task-state",
    "run-bounded-check", "prepare-worker-bootstrap", "prepare-report", "gate", "assess-delivery-preflight"].map((name) => `${name}.mjs`).sort();
  const modules = ["workflow-config", "runtime-policy", "task-source", "validation", "bootstrap", "delivery-state",
    "task-context", "gate-contracts", "report"].map((name) => `${name}.mjs`).sort();
  const lib = path.join(SCRIPT_DIRECTORY, "lib");
  assert.deepEqual(readdirSync(SCRIPT_DIRECTORY).filter((name) => name.endsWith(".mjs")).sort(), executables);
  assert.deepEqual(readdirSync(lib).sort(), modules);
  assert.deepEqual(readdirSync(SCRIPT_DIRECTORY, { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => item.name), ["lib"]);
  const edges = new Map();
  for (const filename of [...executables, ...modules.map((name) => `lib/${name}`)]) {
    const absolute = path.join(SCRIPT_DIRECTORY, filename);
    const source = readFileSync(absolute, "utf8");
    assert.equal(source.startsWith("#!/usr/bin/env node"), !filename.startsWith("lib/"), filename);
    const imports = [...source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s*)["'](\.[^"']+\.mjs)["']/g)]
      .map(([, reference]) => path.resolve(path.dirname(absolute), reference));
    for (const dependency of imports) {
      assert.ok(existsSync(dependency), `${filename}: ${dependency}`);
      if (filename.startsWith("lib/")) assert.equal(path.dirname(dependency), lib, `${filename} imports an executable`);
    }
    if (filename.startsWith("lib/")) edges.set(absolute, imports);
    assert.doesNotMatch(source, /workflow-lib\.mjs/);
  }
  const visited = new Set();
  function visit(module, ancestors = new Set()) {
    assert.ok(!ancestors.has(module), `cyclic dependency at ${module}`);
    if (visited.has(module)) return;
    for (const dependency of edges.get(module)) visit(dependency, new Set([...ancestors, module]));
    visited.add(module);
  }
  for (const module of edges.keys()) visit(module);
  assert.ok(!edges.get(path.join(lib, "gate-contracts.mjs")).includes(path.join(lib, "report.mjs")));
});

test("distributed role references and hook commands resolve inside this toolkit", () => {
  const repositoryRoot = path.resolve(SCRIPT_DIRECTORY, "..", "..", "..", "..");
  const retiredHelpers = ["prepare-evidence.mjs", "prepare-pr-comment.mjs", "select-execution-route.mjs",
    "validate-gate-selection.mjs", "assess-gate-delta.mjs", "compose-gate-result.mjs", "prepare-gate-dispatch.mjs", "workflow-lib.mjs"];
  for (const filename of retiredHelpers) assert.equal(existsSync(path.join(SCRIPT_DIRECTORY, filename)), false);
  const checkHelpers = (contents) => {
    for (const filename of retiredHelpers) assert.equal(contents.includes(filename), false, filename);
    for (const [filename] of contents.matchAll(/\b(?:lib\/)?[a-z][a-z-]+\.mjs\b/g)) {
      assert.ok(existsSync(path.join(SCRIPT_DIRECTORY, filename)), filename);
    }
  };
  checkHelpers(readFileSync(path.join(repositoryRoot, "README.md"), "utf8"));
  checkHelpers(readFileSync(path.join(SCRIPT_DIRECTORY, "../references/contracts.md"), "utf8"));
  const skills = readdirSync(SKILLS_DIRECTORY, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  );
  for (const skill of skills) {
    const contents = readRoleSkill(skill.name);
    checkHelpers(contents);
    const frontmatter = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1];
    assert.equal(parseYaml(frontmatter).name, skill.name);
    for (const [reference] of contents.matchAll(/\$corch-[a-z-]+/g)) {
      assert.ok(
        existsSync(path.join(SKILLS_DIRECTORY, reference.slice(1), "SKILL.md")),
        reference,
      );
    }
  }
  const hooks = JSON.parse(
    readFileSync(path.join(repositoryRoot, ".codex", "hooks.json"), "utf8"),
  );
  for (const groups of Object.values(hooks.hooks)) {
    for (const group of groups)
      for (const hook of group.hooks) {
        const [, script] = hook.command.split(" ");
        assert.ok(existsSync(path.join(repositoryRoot, script)), script);
      }
  }
  const environment = readFileSync(
    path.join(repositoryRoot, ".codex", "environments", "environment.toml"),
    "utf8",
  );
  const setup = environment.match(/^script = "([^"]+)"$/m)?.[1];
  assert.ok(setup, "environment setup command is missing");
  const [executable, script] = setup.split(" ");
  assert.equal(executable, "node");
  withTempDirectory((root) => {
    createGitRepository(root);
    const prepared = command(root, process.execPath, [
      path.join(repositoryRoot, script),
    ]);
    assert.equal(prepared.status, 0, prepared.stderr);
    assert.equal(
      JSON.parse(prepared.stdout).status,
      "skipped-primary-checkout",
    );
  });
});
