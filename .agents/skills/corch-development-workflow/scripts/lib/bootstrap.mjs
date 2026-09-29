import {
  WorkflowValidationError,
  nonEmptyString,
  assertExactKeys,
  requireString,
  detectUnsafeText,
} from "./validation.mjs";
import {
  CONFIG,
  REPOSITORY,
  REMOTE_URL,
  BASE_BRANCH,
  ISSUE_PREFIX,
  ISSUE_PATTERN,
  BRANCH_PATTERN,
} from "./workflow-config.mjs";
import { DEFAULT_WORKER_RUNTIMES, resolveRuntime, runtimeArguments, validateRuntime } from "./runtime-policy.mjs";
import { isSourceRef, describeSource } from "./task-source.mjs";
import path from "node:path";

export const EXECUTION_ROUTE_SCHEMA = "execution-route/v2";

export const WORKER_BOOTSTRAP_SCHEMA = "worker-bootstrap/v2";

export const MARKDOWN_PLAN_SCHEMA = "implementation-plan/v4";

export const EXECUTION_ROUTE_RISK_SIGNALS = new Set([
  "crossPackageCoupling",
  "noveltyOrAmbiguity",
  "highBlastRadius",
  "securityPrivacyBilling",
  "infrastructureOrDeployment",
  "heavyValidation",
]);

export const EXECUTION_RUNTIME_BY_CLASSIFICATION = Object.freeze(Object.fromEntries(
  Object.keys(DEFAULT_WORKER_RUNTIMES).map((classification) => [classification,
    Object.freeze(resolveRuntime(CONFIG, "worker", { classification }))]),
));

export const TESTER_RUNTIME = Object.freeze(resolveRuntime(CONFIG, "tester"));

export function validateExecutionRoute(route, expected = {}) {
  const errors = [];
  assertExactKeys(
    route,
    [
      "schemaVersion",
      "issueKey",
      "classification",
      "riskSignals",
      "model",
      "reasoningEffort",
      "rationale",
    ],
    "executionRoute",
    errors,
  );
  if (route?.schemaVersion !== EXECUTION_ROUTE_SCHEMA) {
    errors.push(`schemaVersion must be ${EXECUTION_ROUTE_SCHEMA}`);
  }
  if (!ISSUE_PATTERN.test(route?.issueKey ?? "")) {
    errors.push(
      "issueKey must match the configured issue prefix and a positive number",
    );
  }
  if (!Object.hasOwn(DEFAULT_WORKER_RUNTIMES, route?.classification)) {
    errors.push("classification is invalid");
  }
  try {
    validateRuntime({ model: route?.model, reasoningEffort: route?.reasoningEffort });
  } catch (error) { errors.push(error.message); }
  if (!Array.isArray(route?.riskSignals)) {
    errors.push("riskSignals must be an array");
  } else {
    const uniqueSignals = new Set(route.riskSignals);
    if (uniqueSignals.size !== route.riskSignals.length) {
      errors.push("riskSignals must not contain duplicates");
    }
    for (const signal of route.riskSignals) {
      if (!EXECUTION_ROUTE_RISK_SIGNALS.has(signal)) {
        errors.push(`riskSignals contains unsupported value: ${signal}`);
      }
    }
  }
  requireString(route?.rationale, "rationale", errors);
  if (
    expected.issueKey !== undefined &&
    route?.issueKey !== expected.issueKey
  ) {
    errors.push("issueKey does not match the expected identity");
  }
  const unsafe = detectUnsafeText(JSON.stringify(route));
  if (unsafe.length > 0) {
    errors.push(`execution route contains unsafe data: ${unsafe.join(", ")}`);
  }
  if (errors.length > 0) {
    throw new WorkflowValidationError([...new Set(errors)]);
  }
  return route;
}

export function createExecutionRoute({
  issueKey,
  classification,
  riskSignals = [],
  rationale,
}) {
  const runtime = EXECUTION_RUNTIME_BY_CLASSIFICATION[classification] ?? {};
  return validateExecutionRoute(
    {
      schemaVersion: EXECUTION_ROUTE_SCHEMA,
      issueKey,
      classification,
      riskSignals: Array.isArray(riskSignals)
        ? [...riskSignals].sort()
        : riskSignals,
      model: runtime.model,
      reasoningEffort: runtime.reasoningEffort,
      rationale,
    },
    { issueKey },
  );
}

export function workerThreadRuntimeArguments(route) {
  const validated = validateExecutionRoute(route);
  return { model: validated.model, thinking: validated.reasoningEffort };
}

export function reviewerThreadRuntimeArguments(route) {
  validateExecutionRoute(route);
  return runtimeArguments(resolveRuntime(CONFIG, "reviewer", { workerRoute: route }));
}

export function testerThreadRuntimeArguments() {
  return {
    model: TESTER_RUNTIME.model,
    thinking: TESTER_RUNTIME.reasoningEffort,
  };
}

function validateDeliveryTarget(value, issueKey, errors, expected = {}) {
  assertExactKeys(
    value,
    [
      "repository",
      "remoteUrl",
      "baseBranch",
      "headBranch",
      "push",
      "draftPullRequest",
      "readyForHumanReview",
      "sourceRef",
    ],
    "deliveryTarget",
    errors,
  );
  if (value?.repository !== REPOSITORY) {
    errors.push(`deliveryTarget.repository must be ${REPOSITORY}`);
  }
  if (value?.remoteUrl !== REMOTE_URL) {
    errors.push(`deliveryTarget.remoteUrl must be ${REMOTE_URL}`);
  }
  if (value?.baseBranch !== BASE_BRANCH) {
    errors.push(`deliveryTarget.baseBranch must be ${BASE_BRANCH}`);
  }
  const branchMatch = value?.headBranch?.match(BRANCH_PATTERN);
  if (!branchMatch || `${ISSUE_PREFIX}-${branchMatch[1]}` !== issueKey) {
    errors.push("deliveryTarget.headBranch must belong to issueKey");
  }
  for (const field of ["push", "draftPullRequest", "readyForHumanReview"]) {
    if (value?.[field] !== true) {
      errors.push(`deliveryTarget.${field} must be true`);
    }
  }
  if (!isSourceRef(value?.sourceRef)) {
    errors.push("deliveryTarget.sourceRef must be a source reference or null");
  }
  if (
    expected.headBranch !== undefined &&
    value?.headBranch !== expected.headBranch
  ) {
    errors.push("deliveryTarget.headBranch does not match the expected branch");
  }
}

export function validateWorkerBootstrap(value) {
  const errors = [];
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "issue",
      "reservedBranch",
      "deliveryTarget",
      "executionRoute",
      "taskContextPath",
    ],
    "workerBootstrap",
    errors,
  );
  if (value?.schemaVersion !== WORKER_BOOTSTRAP_SCHEMA) {
    errors.push(`schemaVersion must be ${WORKER_BOOTSTRAP_SCHEMA}`);
  }
  assertExactKeys(
    value?.issue,
    ["key", "summary", "sourceRef"],
    "workerBootstrap.issue",
    errors,
  );
  if (!ISSUE_PATTERN.test(value?.issue?.key ?? ""))
    errors.push(
      "issue.key must match the configured issue prefix and a positive number",
    );
  requireString(value?.issue?.summary, "issue.summary", errors);
  if (!isSourceRef(value?.issue?.sourceRef)) {
    errors.push("issue.sourceRef must be a source reference or null");
  }
  const branchMatch = value?.reservedBranch?.match(BRANCH_PATTERN);
  if (
    !branchMatch ||
    `${ISSUE_PREFIX}-${branchMatch[1]}` !== value?.issue?.key
  ) {
    errors.push("reservedBranch must belong to issue.key");
  }
  validateDeliveryTarget(value?.deliveryTarget, value?.issue?.key, errors, {
    headBranch: value?.reservedBranch,
  });
  if (
    (value?.deliveryTarget?.sourceRef ?? null) !==
    (value?.issue?.sourceRef ?? null)
  ) {
    errors.push(
      "deliveryTarget.sourceRef must match the selected work-item source",
    );
  }
  try {
    validateExecutionRoute(value?.executionRoute, {
      issueKey: value?.issue?.key,
    });
  } catch (error) {
    errors.push(
      ...(error instanceof WorkflowValidationError
        ? error.errors
        : [error.message]),
    );
  }
  if (
    value?.taskContextPath !== `.agents/task-context/${value?.issue?.key}.md`
  ) {
    errors.push("taskContextPath must be the issue local cache");
  }
  if (errors.length > 0)
    throw new WorkflowValidationError([...new Set(errors)]);
  return value;
}

export function buildDeliveryTaskDispatch(
  rawValue,
  { role = "planner", coordinator, planRevision } = {},
) {
  const value = validateWorkerBootstrap(rawValue);
  const issueKey = value.issue.key;
  if (!["planner", "worker"].includes(role)) {
    throw new WorkflowValidationError(["role must be planner or worker"]);
  }
  if (
    role === "planner" &&
    (!nonEmptyString(coordinator) || /\s/.test(coordinator))
  ) {
    throw new WorkflowValidationError([
      "Planner dispatch requires a Coordinator task ID",
    ]);
  }
  const planPath = `.agents/task-state/${issueKey}-plan.md`;
  if (role === "worker") {
    validatePlanReference(
      {
        schemaVersion: MARKDOWN_PLAN_SCHEMA,
        path: planPath,
        revision: planRevision,
      },
      issueKey,
    );
  }
  const title = `[${issueKey}] ${role === "planner" ? "Planner" : value.issue.summary}`;
  const target = value.deliveryTarget;
  return {
    title,
    runtime:
      role === "planner"
        ? runtimeArguments(resolveRuntime(CONFIG, "planner"))
        : workerThreadRuntimeArguments(value.executionRoute),
    prompt: [
      title,
      `Use $corch-${role} for this issue.`,
      ...(role === "planner" ? [`Corch bootstrap: ${issueKey}`] : []),
      `Task context: ${value.taskContextPath}`,
      `Reserved branch: ${value.reservedBranch}`,
      `Delivery: ${target.repository}; ${target.remoteUrl}; base ${target.baseBranch}; head ${target.headBranch}; source ${describeSource(target.sourceRef)}.`,
      `Implementation route: ${value.executionRoute.model}/${value.executionRoute.reasoningEffort} (${value.executionRoute.classification}).`,
      ...(role === "planner"
        ? [
            `Coordinator: ${coordinator}. No Worker exists yet. Use this prepared worktree; do not create another task or worktree.`,
            "Investigate first. Ask only unresolved material questions with a recommendation, normally one to three at a time; stop and wait for answers. No mandatory questionnaire; if clear, draft the concrete plan directly.",
            `Use the code-first handoff format: write ordered file/symbol edits, required behavior and concrete tests to ${planPath}. Identify affected classes/functions/interfaces, data flow, reuse, constraints and edge cases with expected outcomes. Resolve design, not coding mechanics: the Worker writes code/wording; exact replacement text is not required. Keep decisions in the file so implementation does not depend on chat history. No delivery-policy section or other tasks' plan templates. Register its revision. Explain material decisions and tradeoffs in chat: what changes, why, what stays unchanged and real risks, understandable without opening the file. Then link the file for approval. One approval covers that revision. Only the plan file and its workflow bookkeeping may be written; do not implement product code.`,
            "Disclose that plan approval authorizes implementation, commit, branch push, draft PR, selected gates, CI, authorized evidence publication and PR ready, but not merge, Done, production, credentials or destructive cleanup.",
            "After approval, send the Coordinator one deduplicated handoff with this task ID, worktree/branch, plan path/revision and the user's approval; end the turn. Reuse this Planner for amendments, never spawn a recovery Planner.",
          ]
        : [
            `The Coordinator supplies user approval from the Planner for ${planPath}, revision ${planRevision}. Read the entire file before editing; do not replan or request the same approval again.`,
            "Use the Planner's same worktree, branch, context and dependencies. Do not create another Planner or reinstall the initial environment. If the file is missing or has a material unresolved decision, report that specific gap instead of inventing a plan.",
            `Proceed within the approved scope through implementation, CI, commit, push to ${target.remoteUrl} on ${target.headBranch}, draft PR, selected gates, delivery evidence and PR ready. Verify origin; no additional publication phrase. Merge, Done, production, credentials and destructive cleanup remain excluded.`,
          ]),
    ].join("\n"),
  };
}

export function validatePlanReference(value, issueKey) {
  const errors = [];
  assertExactKeys(
    value,
    ["schemaVersion", "path", "revision"],
    "planReference",
    errors,
  );
  if (
    value?.schemaVersion !== MARKDOWN_PLAN_SCHEMA ||
    !ISSUE_PATTERN.test(issueKey ?? "") ||
    value?.path !== `.agents/task-state/${issueKey}-plan.md` ||
    !Number.isInteger(value?.revision) ||
    value.revision < 1
  ) {
    errors.push(
      "invalid Markdown plan reference: issue-local path and positive revision required",
    );
  }
  if (errors.length > 0) throw new WorkflowValidationError(errors);
  return value;
}
