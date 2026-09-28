import assert from "node:assert/strict";
import test from "node:test";
import { isHttpsUrl, isSourceRef } from "../.agents/skills/corch-development-workflow/scripts/task-source.mjs";
import { REPOSITORY, REMOTE_URL, BASE_BRANCH, ISSUE_PREFIX } from "../.agents/skills/corch-development-workflow/scripts/workflow-config.mjs";
import {
  normalizeTaskContextSnapshot, buildTaskContextMarkdown, validateWorkerBootstrap,
  createExecutionRoute, buildDeliveryTaskDispatch, validateRefinementResult,
} from "../.agents/skills/corch-development-workflow/scripts/workflow-lib.mjs";
import { plannerLaunchFromPrompt } from "../.agents/skills/corch-development-workflow/scripts/prepare-worker-worktree.mjs";

const issueKey = `${ISSUE_PREFIX}-42`;
const branch = `codex/${ISSUE_PREFIX.toLowerCase()}-42-example`;
const sources = [
  null,
  "https://github.com/example/project/issues/123",
  "https://linear.app/example/issue/ENG-9/example-change",
  "https://example.atlassian.net/browse/ENG-3",
  "https://docs.example.test/proposals/feature",
  "docs/proposal.md#acceptance",
  "README.md",
  "codex://threads/example-thread",
];

function context(sourceRef) {
  return {
    schemaVersion: "task-context/v3", provisionalEvidenceProfile: "general",
    retrievedAt: "2026-09-28T12:00:00Z",
    issue: { key: issueKey, sourceRef, summary: "A local request", outcome: "Implement the selected change.",
      acceptanceCriteria: ["The selected behavior works."], directUserDecisions: [],
      deliveryDependencies: [], relevantConstraints: [], relevantLinks: [] },
  };
}

function bootstrap(sourceRef) {
  return {
    schemaVersion: "worker-bootstrap/v2",
    issue: { key: issueKey, summary: "A local request", sourceRef },
    reservedBranch: branch, taskContextPath: `.agents/task-context/${issueKey}.md`,
    executionRoute: createExecutionRoute({ issueKey, classification: "bounded", riskSignals: [], rationale: "A small local change." }),
    deliveryTarget: { repository: REPOSITORY, remoteUrl: REMOTE_URL, baseBranch: BASE_BRANCH,
      headBranch: branch, push: true, draftPullRequest: true, readyForHumanReview: true, sourceRef },
  };
}

test("different input providers and local requests preserve their provenance through planning", () => {
  for (const sourceRef of sources) {
    const normalized = normalizeTaskContextSnapshot(context(sourceRef));
    assert.equal(normalized.issue.sourceRef, sourceRef);
    assert.equal(normalized.issue.id, issueKey);
    assert.equal(normalized.issue.status, "untracked");
    assert.equal(normalized.issue.type, "request");
    assert.equal(normalized.issue.updated, normalized.retrievedAt);
    const markdown = buildTaskContextMarkdown(normalized);
    assert.ok(markdown.includes(sourceRef ?? "current conversation"));
    assert.doesNotMatch(markdown, /undefined/);
    const input = validateWorkerBootstrap(bootstrap(sourceRef));
    const dispatch = buildDeliveryTaskDispatch(input, { coordinator: "fixture" });
    assert.deepEqual(plannerLaunchFromPrompt(dispatch.prompt), { issueKey, branch });
    assert.ok(dispatch.prompt.includes(sourceRef ?? "current conversation"));
    assert.doesNotMatch(dispatch.prompt, /Jira|Atlassian/);
    validateRefinementResult({ schemaVersion: "refinement-result/v1", eventKey: "fixture", revision: 1,
      issueKey, sourceRef, mutationSummary: "Normalized the selected request locally.",
      readiness: "ready", blockers: [], dependencyLinks: [] });
  }
});

test("a conversation can omit source metadata, but cannot silently change provenance", () => {
  const input = context(undefined);
  delete input.issue.sourceRef;
  assert.equal(normalizeTaskContextSnapshot(input).issue.sourceRef, null);
  const packet = bootstrap(null);
  packet.deliveryTarget.sourceRef = "docs/another-request.md";
  assert.throws(() => validateWorkerBootstrap(packet), /selected work-item source/);
});

test("source and publication references reject credentials, unsafe schemes and path traversal", () => {
  for (const sourceRef of ["https://user:secret@example.test/item", "http://example.test/item",
    "https:example.test/item", "javascript:alert(1)", "file:///etc/passwd", "../private.md", "docs/../../private.md",
    "C:/private.md", "/private.md", "https://example.test/item\nnext", "codex://other/id"]) {
    assert.equal(isSourceRef(sourceRef), false, sourceRef);
    assert.throws(() => normalizeTaskContextSnapshot(context(sourceRef)), /sourceRef/);
  }
  assert.equal(isHttpsUrl("https://github.com/example/project/issues/123#issuecomment-1"), true);
  assert.equal(isHttpsUrl("https://linear.app/example/issue/ENG-9"), true);
  assert.equal(isHttpsUrl("docs/local-report.md"), false);
});
