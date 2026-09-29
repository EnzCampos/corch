import {
  EVIDENCE_PROFILES,
  SHA_PATTERN,
  WorkflowValidationError,
  plainObject,
  nonEmptyString,
  assertExactKeys,
  requireString,
  requireStringArray,
  detectUnsafeText,
} from "./validation.mjs";
import {
  REPOSITORY,
  BASE_BRANCH,
  ISSUE_PREFIX,
  LOCAL_CI_COMMAND,
  ISSUE_PATTERN,
  BRANCH_PATTERN,
  CI_RUN_PATTERN,
} from "./workflow-config.mjs";
import { isHttpsUrl } from "./task-source.mjs";
import path from "node:path";

export const GATE_SELECTION_SCHEMA = "gate-selection/v2";

const WAIVER_TARGETS = new Set([
  "review",
  "test",
  "local-ci",
  "remote-ci",
  "command",
]);

export const REVIEW_SCHEMA = "review-result/v2";

export const TEST_SCHEMA = "test-result/v2";

export const REVIEW_AMENDMENT_SCHEMA = "review-amendment/v1";

export const TEST_AMENDMENT_SCHEMA = "test-amendment/v1";

export const GATE_RISK_FIELDS = Object.freeze([
  "behaviorOrLogic",
  "structuralOrMaintainability",
  "sharedOrCrossBoundary",
  "contractOrData",
  "securityPrivacyBilling",
  "infrastructureOrDependencies",
  "interactionAccessibilityResponsive",
  "ambiguityOrNovelty",
]);

function validatePullRequest(value, errors) {
  assertExactKeys(value, ["number", "url"], "pullRequest", errors);
  if (!Number.isInteger(value?.number) || value.number < 1) {
    errors.push("pullRequest.number must be a positive integer");
  }
  if (value?.url !== `https://github.com/${REPOSITORY}/pull/${value?.number}`) {
    errors.push("pullRequest.url must match repository and number");
  }
}

function validateAcceptance(value, errors, { allowNotVerified = false } = {}) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("acceptance must be a non-empty array");
    return;
  }
  value.forEach((item, index) => {
    assertExactKeys(
      item,
      ["criterion", "status", "evidence"],
      `acceptance[${index}]`,
      errors,
    );
    requireString(item?.criterion, `acceptance[${index}].criterion`, errors);
    if (
      !new Set([
        "PASS",
        "FAIL",
        ...(allowNotVerified ? ["NOT_VERIFIED"] : []),
      ]).has(item?.status)
    ) {
      errors.push(
        `acceptance[${index}].status must be PASS or FAIL${allowNotVerified ? " or NOT_VERIFIED" : ""}`,
      );
    }
    requireString(item?.evidence, `acceptance[${index}].evidence`, errors);
  });
}

function validateArtifacts(value, errors) {
  if (!Array.isArray(value)) {
    errors.push("artifacts must be an array");
    return;
  }
  value.forEach((item, index) => {
    if (typeof item === "string") {
      errors.push(`artifacts[${index}] must be a captioned artifact object`);
      return;
    }
    assertExactKeys(
      item,
      ["path", "caption", "acceptanceCriteria"],
      `artifacts[${index}]`,
      errors,
    );
    requireString(item?.path, `artifacts[${index}].path`, errors);
    requireString(item?.caption, `artifacts[${index}].caption`, errors);
    requireStringArray(
      item?.acceptanceCriteria,
      `artifacts[${index}].acceptanceCriteria`,
      errors,
    );
  });
}

function validateFindings(value, errors) {
  if (!Array.isArray(value)) {
    errors.push("findings must be an array");
    return;
  }
  const ids = new Set();
  value.forEach((item, index) => {
    const label = `findings[${index}]`;
    assertExactKeys(
      item,
      ["id", "severity", "title", "evidence", "requiredOutcome", "location"],
      label,
      errors,
    );
    if (!/^REV-[1-9]\d*$/.test(item?.id ?? "")) {
      errors.push(`${label}.id must match REV-N`);
    } else if (ids.has(item.id)) {
      errors.push(`${label}.id must be unique`);
    } else {
      ids.add(item.id);
    }
    if (
      !new Set(["critical", "high", "medium", "low", "info"]).has(
        item?.severity,
      )
    ) {
      errors.push(`${label}.severity is invalid`);
    }
    for (const field of ["title", "evidence", "requiredOutcome"]) {
      requireString(item?.[field], `${label}.${field}`, errors);
    }
    if (item?.location !== undefined) {
      requireString(item.location, `${label}.location`, errors);
    }
  });
}

export function validateCommands(value, errors, { allowSkipped = false } = {}) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("commands must be a non-empty array");
    return;
  }
  value.forEach((item, index) => {
    const label = `commands[${index}]`;
    assertExactKeys(
      item,
      ["command", "status", "exitCode", "durationMs", "summary", "artifacts"],
      label,
      errors,
    );
    requireString(item?.command, `${label}.command`, errors);
    if (
      !new Set([
        "PASS",
        "FAIL",
        "BLOCKED",
        ...(allowSkipped ? ["SKIPPED"] : []),
      ]).has(item?.status)
    ) {
      errors.push(`${label}.status is invalid`);
    }
    if (
      item?.status === "SKIPPED" &&
      (item.exitCode !== null || item.durationMs !== 0)
    ) {
      errors.push(
        `${label} SKIPPED requires exitCode null and durationMs zero`,
      );
    }
    if (item?.exitCode !== null && !Number.isInteger(item?.exitCode)) {
      errors.push(`${label}.exitCode must be an integer or null`);
    }
    if (!Number.isInteger(item?.durationMs) || item.durationMs < 0) {
      errors.push(`${label}.durationMs must be a non-negative integer`);
    }
    requireString(item?.summary, `${label}.summary`, errors);
    if (item?.artifacts !== undefined) {
      validateArtifacts(item.artifacts, errors);
    }
  });
}

function validateFailures(value, errors) {
  if (!Array.isArray(value)) {
    errors.push("failures must be an array");
    return;
  }
  const ids = new Set();
  value.forEach((item, index) => {
    const label = `failures[${index}]`;
    assertExactKeys(
      item,
      ["id", "title", "evidence", "nextAction"],
      label,
      errors,
    );
    if (!/^TEST-[1-9]\d*$/.test(item?.id ?? "")) {
      errors.push(`${label}.id must match TEST-N`);
    } else if (ids.has(item.id)) {
      errors.push(`${label}.id must be unique`);
    } else {
      ids.add(item.id);
    }
    for (const field of ["title", "evidence", "nextAction"]) {
      requireString(item?.[field], `${label}.${field}`, errors);
    }
  });
}

export function validateGateResult(role, rawResult, expected = {}) {
  if (!new Set(["reviewer", "tester"]).has(role)) {
    throw new WorkflowValidationError(["role must be reviewer or tester"]);
  }
  const result = rawResult;
  const errors = [];
  const commonKeys = [
    "schemaVersion",
    "issueKey",
    "repository",
    "pullRequest",
    "baseBranch",
    "headBranch",
    "observedSha",
    "comparedFromSha",
    "verdict",
    "summary",
    "acceptance",
    "artifacts",
  ];
  const roleKeys =
    role === "reviewer" ? ["findings"] : ["commands", "failures"];
  assertExactKeys(result, [...commonKeys, ...roleKeys], "result", errors);
  const schema = role === "reviewer" ? REVIEW_SCHEMA : TEST_SCHEMA;
  if (result.schemaVersion !== schema) {
    errors.push(`schemaVersion must be ${schema}`);
  }
  if (!ISSUE_PATTERN.test(result.issueKey ?? "")) {
    errors.push(
      "issueKey must match the configured issue prefix and a positive number",
    );
  }
  if (result.repository !== REPOSITORY) {
    errors.push(`repository must be ${REPOSITORY}`);
  }
  validatePullRequest(result.pullRequest, errors);
  if (result.baseBranch !== BASE_BRANCH) {
    errors.push(`baseBranch must be ${BASE_BRANCH}`);
  }
  const branchMatch = result.headBranch?.match(BRANCH_PATTERN);
  if (!branchMatch || `${ISSUE_PREFIX}-${branchMatch[1]}` !== result.issueKey) {
    errors.push("headBranch must belong to issueKey");
  }
  if (!SHA_PATTERN.test(result.observedSha ?? "")) {
    errors.push("observedSha must be a lowercase full SHA");
  }
  if (
    result.comparedFromSha !== undefined &&
    result.comparedFromSha !== null &&
    !SHA_PATTERN.test(result.comparedFromSha ?? "")
  ) {
    errors.push("comparedFromSha must be null or a lowercase full SHA");
  }
  requireString(result.summary, "summary", errors);
  validateAcceptance(result.acceptance, errors);
  validateArtifacts(result.artifacts, errors);
  if (role === "reviewer") {
    if (
      !new Set(["APPROVED", "CHANGES_REQUESTED", "BLOCKED"]).has(result.verdict)
    ) {
      errors.push("review verdict is invalid");
    }
    validateFindings(result.findings, errors);
    if (
      result.verdict === "APPROVED" &&
      result.findings?.some((item) => item.severity !== "info")
    ) {
      errors.push("APPROVED cannot contain blocking findings");
    }
  } else {
    if (!new Set(["PASS", "FAIL", "BLOCKED"]).has(result.verdict)) {
      errors.push("test verdict is invalid");
    }
    validateCommands(result.commands, errors);
    validateFailures(result.failures, errors);
    if (
      result.verdict === "PASS" &&
      result.commands?.some(
        (item) => item.status !== "PASS" || item.exitCode !== 0,
      )
    ) {
      errors.push("PASS requires every command to pass with exit code zero");
    }
    if (result.verdict === "PASS" && result.failures?.length > 0) {
      errors.push("PASS cannot contain failures");
    }
  }
  if (
    (result.verdict === "APPROVED" || result.verdict === "PASS") &&
    result.acceptance?.some((item) => item.status !== "PASS")
  ) {
    errors.push(`${result.verdict} requires every acceptance item to pass`);
  }
  const expectations = {
    issueKey: result.issueKey,
    repository: result.repository,
    pullRequestNumber: result.pullRequest?.number,
    baseBranch: result.baseBranch,
    headBranch: result.headBranch,
    observedSha: result.observedSha,
  };
  for (const [field, actual] of Object.entries(expectations)) {
    if (expected[field] !== undefined && expected[field] !== actual) {
      errors.push(`${field} does not match the expected identity`);
    }
  }
  const unsafe = detectUnsafeText(JSON.stringify(result));
  if (unsafe.length > 0) {
    errors.push(`result contains unsafe data: ${unsafe.join(", ")}`);
  }
  if (errors.length > 0) {
    throw new WorkflowValidationError([...new Set(errors)]);
  }
  return result;
}

function validateCarryForward(value, baseAcceptance, errors) {
  if (!Array.isArray(value)) {
    errors.push("carryForward must be an array");
    return;
  }
  const known = new Set(baseAcceptance.map((item) => item.criterion));
  const seen = new Set();
  value.forEach((item, index) => {
    const label = `carryForward[${index}]`;
    assertExactKeys(item, ["criterion", "rationale"], label, errors);
    requireString(item?.criterion, `${label}.criterion`, errors);
    requireString(item?.rationale, `${label}.rationale`, errors);
    if (!known.has(item?.criterion)) {
      errors.push(`${label}.criterion does not exist in the base result`);
    }
    if (seen.has(item?.criterion)) {
      errors.push(`${label}.criterion must be unique`);
    }
    seen.add(item?.criterion);
  });
}

function validateResolvedItems(value, baseItems, prefix, label, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return;
  }
  const known = new Set(baseItems.map((item) => item.id));
  const seen = new Set();
  value.forEach((item, index) => {
    const itemLabel = `${label}[${index}]`;
    assertExactKeys(item, ["id", "rationale"], itemLabel, errors);
    if (!new RegExp(`^${prefix}-[1-9]\\d*$`).test(item?.id ?? "")) {
      errors.push(`${itemLabel}.id must match ${prefix}-N`);
    } else if (!known.has(item.id)) {
      errors.push(`${itemLabel}.id does not exist in the base result`);
    } else if (seen.has(item.id)) {
      errors.push(`${itemLabel}.id must be unique`);
    } else {
      seen.add(item.id);
    }
    requireString(item?.rationale, `${itemLabel}.rationale`, errors);
  });
}

export function composeGateResult(
  role,
  baseRawResult,
  amendment,
  expected = {},
) {
  const base = validateGateResult(role, baseRawResult, expected);
  const errors = [];
  const schema =
    role === "reviewer" ? REVIEW_AMENDMENT_SCHEMA : TEST_AMENDMENT_SCHEMA;
  const roleKeys =
    role === "reviewer"
      ? ["findings", "resolvedFindings"]
      : ["commands", "failures", "resolvedFailures"];
  assertExactKeys(
    amendment,
    [
      "schemaVersion",
      "baseResultPath",
      "issueKey",
      "observedSha",
      "comparedFromSha",
      "verdict",
      "summary",
      "acceptanceUpdates",
      "carryForward",
      "artifacts",
      ...roleKeys,
    ],
    "amendment",
    errors,
  );
  if (amendment?.schemaVersion !== schema) {
    errors.push(`schemaVersion must be ${schema}`);
  }
  requireString(amendment?.baseResultPath, "baseResultPath", errors);
  if (amendment?.issueKey !== base.issueKey) {
    errors.push("amendment issueKey must match the base result");
  }
  if (amendment?.comparedFromSha !== base.observedSha) {
    errors.push("amendment comparedFromSha must equal the base observedSha");
  }
  if (!SHA_PATTERN.test(amendment?.observedSha ?? "")) {
    errors.push("amendment observedSha must be a lowercase full SHA");
  }
  requireString(amendment?.summary, "amendment.summary", errors);
  if (!Array.isArray(amendment?.acceptanceUpdates)) {
    errors.push("acceptanceUpdates must be an array");
  } else if (amendment.acceptanceUpdates.length > 0) {
    validateAcceptance(amendment.acceptanceUpdates, errors);
  }
  validateCarryForward(amendment?.carryForward, base.acceptance, errors);
  validateArtifacts(amendment?.artifacts, errors);
  if (role === "reviewer") {
    if (
      !new Set(["APPROVED", "CHANGES_REQUESTED", "BLOCKED"]).has(
        amendment?.verdict,
      )
    ) {
      errors.push("review amendment verdict is invalid");
    }
    validateFindings(amendment?.findings, errors);
    validateResolvedItems(
      amendment?.resolvedFindings,
      base.findings,
      "REV",
      "resolvedFindings",
      errors,
    );
  } else {
    if (!new Set(["PASS", "FAIL", "BLOCKED"]).has(amendment?.verdict)) {
      errors.push("test amendment verdict is invalid");
    }
    validateCommands(amendment?.commands, errors);
    validateFailures(amendment?.failures, errors);
    validateResolvedItems(
      amendment?.resolvedFailures,
      base.failures,
      "TEST",
      "resolvedFailures",
      errors,
    );
  }
  const updatedCriteria = new Set(
    (amendment?.acceptanceUpdates ?? []).map((item) => item.criterion),
  );
  const carriedCriteria = new Set(
    (amendment?.carryForward ?? []).map((item) => item.criterion),
  );
  for (const criterion of updatedCriteria) {
    if (carriedCriteria.has(criterion)) {
      errors.push(
        `acceptance criterion cannot be both updated and carried forward: ${criterion}`,
      );
    }
  }
  for (const item of base.acceptance) {
    if (
      !updatedCriteria.has(item.criterion) &&
      !carriedCriteria.has(item.criterion)
    ) {
      errors.push(
        `base acceptance criterion requires an update or carry-forward rationale: ${item.criterion}`,
      );
    }
  }
  const baseItems = role === "reviewer" ? base.findings : base.failures;
  const currentItems =
    role === "reviewer" ? amendment?.findings : amendment?.failures;
  const resolvedItems =
    role === "reviewer"
      ? amendment?.resolvedFindings
      : amendment?.resolvedFailures;
  const currentIds = new Set((currentItems ?? []).map((item) => item.id));
  const resolvedIds = new Set((resolvedItems ?? []).map((item) => item.id));
  for (const id of currentIds) {
    if (resolvedIds.has(id)) {
      errors.push(`base item cannot be both current and resolved: ${id}`);
    }
  }
  for (const item of baseItems) {
    if (!currentIds.has(item.id) && !resolvedIds.has(item.id)) {
      errors.push(
        `base item requires a current or resolved disposition: ${item.id}`,
      );
    }
  }
  if (errors.length > 0) {
    throw new WorkflowValidationError([...new Set(errors)]);
  }
  const updates = new Map(
    amendment.acceptanceUpdates.map((item) => [item.criterion, item]),
  );
  const acceptance = base.acceptance.map(
    (item) => updates.get(item.criterion) ?? item,
  );
  for (const item of amendment.acceptanceUpdates) {
    if (
      !base.acceptance.some((baseItem) => baseItem.criterion === item.criterion)
    ) {
      acceptance.push(item);
    }
  }
  const merged = {
    ...base,
    schemaVersion: role === "reviewer" ? REVIEW_SCHEMA : TEST_SCHEMA,
    observedSha: amendment.observedSha,
    comparedFromSha: amendment.comparedFromSha,
    verdict: amendment.verdict,
    summary: amendment.summary,
    acceptance,
    artifacts: amendment.artifacts,
    ...(role === "reviewer"
      ? { findings: amendment.findings }
      : { commands: amendment.commands, failures: amendment.failures }),
  };
  return validateGateResult(role, merged, {
    ...expected,
    observedSha: amendment.observedSha,
  });
}

export function validateGateDecision(value, label, errors) {
  assertExactKeys(value, ["decision", "rationale"], label, errors);
  if (!new Set(["required", "skipped"]).has(value?.decision)) {
    errors.push(`${label}.decision is invalid`);
  }
  requireString(value?.rationale, `${label}.rationale`, errors);
}

export function waiversFor(selection) {
  return Array.isArray(selection?.waivers) ? selection.waivers : [];
}

export function hasWaiver(selection, target, command) {
  return waiversFor(selection).some(
    (waiver) =>
      waiver?.target === target &&
      (target !== "command" || waiver.command === command),
  );
}

function commandWaived(selection, command) {
  return (
    hasWaiver(selection, "command", command) ||
    (command === LOCAL_CI_COMMAND && hasWaiver(selection, "local-ci"))
  );
}

export function validateWaivers(selection, errors) {
  if (selection?.waivers === undefined) return;
  if (!Array.isArray(selection.waivers)) {
    errors.push("waivers must be an array");
    return;
  }
  const criteria = new Set(
    (Array.isArray(selection.acceptance) ? selection.acceptance : []).map(
      (item) => item?.criterion,
    ),
  );
  const seen = new Set();
  selection.waivers.forEach((waiver, index) => {
    const label = `waivers[${index}]`;
    assertExactKeys(
      waiver,
      ["target", "command", "userDecision", "reason", "acceptanceCriteria"],
      label,
      errors,
    );
    if (!WAIVER_TARGETS.has(waiver?.target))
      errors.push(`${label}.target is invalid`);
    if (waiver?.target === "command") {
      requireString(waiver.command, `${label}.command`, errors);
      if (
        !Array.isArray(selection.commands) ||
        !selection.commands.some((item) => item?.command === waiver.command)
      ) {
        errors.push(
          `${label}.command must have a recorded outcome, including SKIPPED when not run`,
        );
      }
    } else if (waiver?.command !== undefined)
      errors.push(`${label}.command is only valid for a command waiver`);
    requireString(waiver?.userDecision, `${label}.userDecision`, errors);
    requireString(waiver?.reason, `${label}.reason`, errors);
    requireStringArray(
      waiver?.acceptanceCriteria,
      `${label}.acceptanceCriteria`,
      errors,
      { allowEmpty: true },
    );
    if (Array.isArray(waiver?.acceptanceCriteria)) {
      for (const criterion of waiver.acceptanceCriteria) {
        if (!criteria.has(criterion))
          errors.push(`${label} references an unknown acceptance criterion`);
      }
      if (
        new Set(waiver.acceptanceCriteria).size !==
        waiver.acceptanceCriteria.length
      ) {
        errors.push(`${label}.acceptanceCriteria must not contain duplicates`);
      }
    }
    const key = JSON.stringify([waiver?.target, waiver?.command]);
    if (seen.has(key)) errors.push(`${label} duplicates a waiver target`);
    seen.add(key);
  });
}

export function acceptanceWaived(selection, criterion) {
  return waiversFor(selection).some(
    (waiver) =>
      Array.isArray(waiver?.acceptanceCriteria) &&
      waiver.acceptanceCriteria.includes(criterion),
  );
}

function validateGateOutcome(value, label, allowedStatuses, errors) {
  assertExactKeys(
    value,
    ["status", "observedSha", "summary", "evidenceUrl"],
    label,
    errors,
  );
  if (!allowedStatuses.has(value?.status)) {
    errors.push(`${label}.status is invalid`);
  }
  if (
    value?.observedSha !== null &&
    value?.observedSha !== undefined &&
    !SHA_PATTERN.test(value.observedSha)
  ) {
    errors.push(`${label}.observedSha must be null or a lowercase full SHA`);
  }
  requireString(value?.summary, `${label}.summary`, errors);
  if (
    value?.evidenceUrl !== null &&
    value?.evidenceUrl !== undefined &&
    (!nonEmptyString(value.evidenceUrl) || !isHttpsUrl(value.evidenceUrl))
  ) {
    errors.push(
      `${label}.evidenceUrl must be null or a credential-free HTTPS URL`,
    );
  }
}

function validateGateOutcomes(value, errors, { allowSkippedCi = false } = {}) {
  assertExactKeys(
    value,
    ["review", "test", "ci", "warnings"],
    "outcomes",
    errors,
  );
  validateGateOutcome(
    value?.review,
    "outcomes.review",
    new Set(["APPROVED", "CHANGES_REQUESTED", "BLOCKED", "SKIPPED"]),
    errors,
  );
  validateGateOutcome(
    value?.test,
    "outcomes.test",
    new Set(["PASS", "FAIL", "BLOCKED", "SKIPPED"]),
    errors,
  );
  validateCiOutcome(value?.ci, errors, { allowSkippedCi });
  requireStringArray(value?.warnings, "outcomes.warnings", errors, {
    allowEmpty: true,
  });
}

function validateCiOutcome(value, errors, { allowSkippedCi = false } = {}) {
  assertExactKeys(
    value,
    ["status", "observedSha", "runUrl", "summary"],
    "outcomes.ci",
    errors,
  );
  if (
    !new Set([
      "PASS",
      "FAIL",
      "PENDING",
      "BLOCKED",
      ...(allowSkippedCi ? ["SKIPPED"] : []),
    ]).has(value?.status)
  ) {
    errors.push("outcomes.ci.status is invalid");
  }
  if (!SHA_PATTERN.test(value?.observedSha ?? "")) {
    errors.push("outcomes.ci.observedSha must be a lowercase full SHA");
  }
  if (value?.status === "SKIPPED" && value.runUrl !== null) {
    errors.push("outcomes.ci SKIPPED requires runUrl null");
  }
  if (
    value?.runUrl === null &&
    value?.status !== "BLOCKED" &&
    !(allowSkippedCi && value?.status === "SKIPPED")
  ) {
    errors.push(
      "outcomes.ci.runUrl may be null only when the expected run is blocked or missing",
    );
  } else if (
    value?.runUrl !== null &&
    (!nonEmptyString(value?.runUrl) || !CI_RUN_PATTERN.test(value.runUrl))
  ) {
    errors.push(
      "outcomes.ci.runUrl must be null or a configured-repository GitHub Actions run URL",
    );
  }
  requireString(value?.summary, "outcomes.ci.summary", errors);
}

export function validateGateSelection(selection, expected = {}) {
  const errors = [];
  assertExactKeys(
    selection,
    [
      "schemaVersion",
      "issueKey",
      "repository",
      "pullRequest",
      "baseBranch",
      "headBranch",
      "observedSha",
      "evidenceProfile",
      "classification",
      "planned",
      "actual",
      "risk",
      "summary",
      "acceptance",
      "commands",
      "artifacts",
      "outcomes",
      "waivers",
    ],
    "selection",
    errors,
  );
  if (selection?.schemaVersion !== GATE_SELECTION_SCHEMA) {
    errors.push(`schemaVersion must be ${GATE_SELECTION_SCHEMA}`);
  }
  if (!ISSUE_PATTERN.test(selection?.issueKey ?? "")) {
    errors.push(
      "issueKey must match the configured issue prefix and a positive number",
    );
  }
  if (selection?.repository !== REPOSITORY) {
    errors.push(`repository must be ${REPOSITORY}`);
  }
  validatePullRequest(selection?.pullRequest, errors);
  if (selection?.baseBranch !== BASE_BRANCH) {
    errors.push(`baseBranch must be ${BASE_BRANCH}`);
  }
  const branchMatch = selection?.headBranch?.match(BRANCH_PATTERN);
  if (
    !branchMatch ||
    `${ISSUE_PREFIX}-${branchMatch[1]}` !== selection?.issueKey
  ) {
    errors.push("headBranch must belong to issueKey");
  }
  if (!SHA_PATTERN.test(selection?.observedSha ?? "")) {
    errors.push("observedSha must be a lowercase full SHA");
  }
  if (!EVIDENCE_PROFILES.has(selection?.evidenceProfile)) {
    errors.push("evidenceProfile is invalid");
  }
  if (
    !new Set(["trivial", "routine", "standard", "high-risk"]).has(
      selection?.classification,
    )
  ) {
    errors.push("classification is invalid");
  }
  for (const route of ["planned", "actual"]) {
    assertExactKeys(selection?.[route], ["review", "test"], route, errors);
    validateGateDecision(selection?.[route]?.review, `${route}.review`, errors);
    validateGateDecision(selection?.[route]?.test, `${route}.test`, errors);
  }
  assertExactKeys(selection?.risk, GATE_RISK_FIELDS, "risk", errors);
  for (const field of GATE_RISK_FIELDS) {
    if (typeof selection?.risk?.[field] !== "boolean") {
      errors.push(`risk.${field} must be boolean`);
    }
  }
  const hasRisk = GATE_RISK_FIELDS.some((field) => selection?.risk?.[field]);
  validateWaivers(selection, errors);
  if (
    selection?.actual?.review?.decision === "skipped" &&
    selection?.actual?.test?.decision === "skipped" &&
    (selection?.classification !== "trivial" || hasRisk) &&
    !(hasWaiver(selection, "review") && hasWaiver(selection, "test"))
  ) {
    errors.push(
      "both gates may be skipped only for trivial work with no material risk flag, or explicit waivers for both gates",
    );
  }
  requireString(selection?.summary, "summary", errors);
  validateAcceptance(selection?.acceptance, errors, { allowNotVerified: true });
  for (const item of Array.isArray(selection?.acceptance)
    ? selection.acceptance
    : []) {
    if (
      item?.status === "NOT_VERIFIED" &&
      !acceptanceWaived(selection, item.criterion)
    ) {
      errors.push(
        "NOT_VERIFIED acceptance requires an explicit associated waiver",
      );
    }
  }
  if (!Array.isArray(selection?.commands)) {
    errors.push("commands must be an array");
  } else if (selection.commands.length > 0) {
    validateCommands(selection.commands, errors, { allowSkipped: true });
    for (const item of selection.commands) {
      if (
        item?.status === "SKIPPED" &&
        !commandWaived(selection, item.command)
      ) {
        errors.push("SKIPPED command requires an explicit matching waiver");
      }
    }
  }
  validateArtifacts(selection?.artifacts, errors);
  if (selection?.outcomes !== undefined) {
    validateGateOutcomes(selection.outcomes, errors, {
      allowSkippedCi: hasWaiver(selection, "remote-ci"),
    });
  }
  const expectations = {
    issueKey: selection?.issueKey,
    repository: selection?.repository,
    pullRequestNumber: selection?.pullRequest?.number,
    baseBranch: selection?.baseBranch,
    headBranch: selection?.headBranch,
    observedSha: selection?.observedSha,
  };
  for (const [field, actual] of Object.entries(expectations)) {
    if (expected[field] !== undefined && expected[field] !== actual) {
      errors.push(`${field} does not match the expected identity`);
    }
  }
  const unsafe = detectUnsafeText(JSON.stringify(selection));
  if (unsafe.length > 0) {
    errors.push(`selection contains unsafe data: ${unsafe.join(", ")}`);
  }
  if (errors.length > 0) {
    throw new WorkflowValidationError([...new Set(errors)]);
  }
  return selection;
}

export function validateReadyHandoff(selection, expectedIdentity = {}) {
  validateGateSelection(selection, expectedIdentity);
  const errors = [];
  if (!plainObject(selection?.outcomes)) {
    throw new WorkflowValidationError(["ready handoff requires gate outcomes"]);
  }
  const expected = {
    review:
      selection.actual.review.decision === "required" ? "APPROVED" : "SKIPPED",
    test: selection.actual.test.decision === "required" ? "PASS" : "SKIPPED",
  };
  for (const role of ["review", "test"]) {
    const outcome = selection.outcomes[role];
    if (outcome.status !== expected[role] && !hasWaiver(selection, role)) {
      errors.push(`ready handoff requires ${role} outcome ${expected[role]}`);
    }
    if (
      selection.actual[role].decision === "required" &&
      !(hasWaiver(selection, role) && outcome.status === "SKIPPED") &&
      !SHA_PATTERN.test(outcome.observedSha ?? "")
    ) {
      errors.push(`ready handoff requires ${role} observedSha`);
    }
  }
  if (!plainObject(selection.outcomes.ci)) {
    errors.push("ready handoff requires a CI outcome");
  } else {
    if (
      selection.outcomes.ci.status !== "PASS" &&
      !hasWaiver(selection, "remote-ci")
    ) {
      errors.push("ready handoff requires current-head CI outcome PASS");
    }
    if (
      selection.outcomes.ci.observedSha !== selection.observedSha &&
      !hasWaiver(selection, "remote-ci")
    ) {
      errors.push(
        "ready handoff requires CI observedSha to match the current PR head",
      );
    }
  }
  if (
    selection.acceptance.some(
      (item) =>
        item.status !== "PASS" &&
        !(
          item.status === "NOT_VERIFIED" &&
          acceptanceWaived(selection, item.criterion)
        ),
    )
  ) {
    errors.push("ready handoff requires every acceptance item to pass");
  }
  if (
    selection.commands.some(
      (item) =>
        (item.status !== "PASS" || item.exitCode !== 0) &&
        !commandWaived(selection, item.command),
    )
  ) {
    errors.push(
      "ready handoff requires every recorded command to pass with exit code zero",
    );
  }
  const localCi = selection.commands.find(
    (item) => item.command === LOCAL_CI_COMMAND,
  );
  if (
    !localCi ||
    ((localCi.status !== "PASS" || localCi.exitCode !== 0) &&
      !commandWaived(selection, LOCAL_CI_COMMAND))
  ) {
    errors.push(
      `ready handoff requires an inspected passing ${LOCAL_CI_COMMAND} result`,
    );
  }
  if (errors.length > 0) {
    throw new WorkflowValidationError(errors);
  }
  return selection;
}
