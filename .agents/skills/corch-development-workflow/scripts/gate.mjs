#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { BASE_BRANCH, ISSUE_PATTERN, REPOSITORY } from "./lib/workflow-config.mjs";
import { gitValue, readDeliveryState, sameCheckout, verifyWorkerCheckout } from "./lib/delivery-state.mjs";
import { SHA_PATTERN, WorkflowValidationError, detectUnsafeText, parseJsonDocument, plainObject, redactText } from "./lib/validation.mjs";
import { reviewerThreadRuntimeArguments, testerThreadRuntimeArguments, validatePlanReference } from "./lib/bootstrap.mjs";
import { composeGateResult, validateCommands, validateGateDecision, validateGateResult, validateGateSelection, validateWaivers } from "./lib/gate-contracts.mjs";
import { artifactMetadata, buildGateSelectionMarker, resolveEvidenceFiles, resultArtifactPaths, validateHandoffEvidence } from "./lib/report.mjs";

const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const strings = (value, nonempty = false) => Array.isArray(value) && (!nonempty || value.length > 0) &&
  value.every((item) => typeof item === "string" && item.trim());

function localFile(worktree, supplied, prefix, { mustExist = true } = {}) {
  requireValue(typeof supplied === "string" && supplied.startsWith(prefix) &&
    !/[\\\0]/.test(supplied) && !supplied.split("/").some((part) => ["", ".", ".."].includes(part)), "invalid checkout-local reference");
  const file = path.join(worktree, supplied);
  // Follow existing parents to reject links escaping the checkout, including output directories.
  let parent = file;
  while (!existsSync(parent)) parent = path.dirname(parent);
  const relative = path.relative(realpathSync(worktree), realpathSync(parent));
  requireValue(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), "reference escapes the Worker checkout");
  if (mustExist) requireValue(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), "reference must be a regular file");
  return file;
}

export function buildGateDispatch(input) {
  const allowed = ["issueKey", "gate", "worktree", "projectId", "projectPath", "observedSha", "comparedFromSha",
    "pullRequest", "acceptanceCriteria", "userDecisions", "waivers", "validation", "reviewDecision", "resultPath", "delta", "attempt"];
  requireValue(input && typeof input === "object" && !Array.isArray(input) && Object.keys(input).every((key) => allowed.includes(key)), "unsupported gate dispatch fields; do not transfer transcripts or implementation narratives");
  const { issueKey, gate, worktree, observedSha } = input;
  requireValue(ISSUE_PATTERN.test(issueKey ?? "") && ["review", "test"].includes(gate), "gate dispatch requires an issue and review/test gate");
  requireValue(typeof worktree === "string" && path.isAbsolute(worktree), "gate dispatch requires an absolute Worker checkout");
  requireValue(SHA_PATTERN.test(observedSha ?? "") && (input.comparedFromSha == null || SHA_PATTERN.test(input.comparedFromSha)), "invalid gate commit identity");
  requireValue(strings(input.acceptanceCriteria, true) && strings(input.userDecisions) && Array.isArray(input.validation), "current acceptanceCriteria, userDecisions and validation are required");
  requireValue(input.pullRequest && Object.keys(input.pullRequest).every((key) => ["number", "url"].includes(key)) &&
    Number.isSafeInteger(input.pullRequest?.number) && input.pullRequest.number > 0 &&
    input.pullRequest.url === `https://github.com/${REPOSITORY}/pull/${input.pullRequest.number}`, "invalid pull request identity");
  requireValue(Number.isSafeInteger(input.attempt) && input.attempt > 0, "a positive stable attempt number is required");
  const errors = [];
  validateGateDecision(input.reviewDecision, "reviewDecision", errors);
  if (input.validation.length) validateCommands(input.validation, errors, { allowSkipped: true });
  validateWaivers({ waivers: input.waivers, acceptance: input.acceptanceCriteria.map((criterion) => ({ criterion })), commands: input.validation }, errors);
  requireValue(errors.length === 0, errors.join("\n"));
  requireValue(detectUnsafeText(JSON.stringify(input)).length === 0, "gate dispatch contains unsafe data");
  const state = readDeliveryState(worktree, issueKey);
  const worker = verifyWorkerCheckout(state, worktree, observedSha);
  requireValue(!state.activeCheckoutGate, "wait for the active checkout gate to finish before dispatch");
  const primary = path.dirname(gitValue(worktree, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  requireValue(typeof input.projectId === "string" && /^[A-Za-z0-9_-]+$/.test(input.projectId) &&
    sameCheckout(input.projectPath, primary), "select the matching saved project ID/path from list_projects");
  validatePlanReference(state.implementationPlan, issueKey);
  const contextPath = localFile(worktree, `.agents/task-context/${issueKey}.md`, ".agents/task-context/");
  const planPath = localFile(worktree, state.implementationPlan.path, ".agents/task-state/");
  const resultPath = localFile(worktree, input.resultPath, `.agents/evidence/${issueKey}/${observedSha}/`, { mustExist: false });
  if (gate === "test" && input.reviewDecision.decision === "required") {
    const review = state.gates.review;
    requireValue(review?.observedSha === observedSha, "complete Reviewer at the current commit before Tester");
    const resultFile = localFile(worktree, review.resultPath, ".agents/");
    const result = validateGateResult("reviewer", JSON.parse(readFileSync(resultFile, "utf8")), {
      issueKey, observedSha, headBranch: worker.branch, pullRequestNumber: input.pullRequest.number,
    });
    requireValue(result.verdict === "APPROVED", "resolve the Reviewer verdict before Tester");
    requireValue(JSON.stringify(result.acceptance.map((item) => item.criterion).sort()) ===
      JSON.stringify([...input.acceptanceCriteria].sort()), "refresh Reviewer for the current acceptance criteria before Tester");
  }
  const delta = {};
  if (input.delta !== undefined) {
    requireValue(plainObject(input.delta), "delta must be an object");
    const compactFields = ["impact", "rationale", "acceptanceFocus", "priorFindingIds"];
    const complete = Object.hasOwn(input.delta, "schemaVersion");
    if (complete) {
      requireValue(input.delta.schemaVersion === "gate-delta-assessment/v1" &&
        input.delta.role === gate && input.delta.toSha === observedSha &&
        input.delta.fromSha === input.comparedFromSha, "delta assessment identity does not match gate attempt");
    } else {
      requireValue(Object.keys(input.delta).every((key) => compactFields.includes(key)), "unsupported delta fields");
    }
    const assessment = assessGateDelta({
      gate, fromSha: input.comparedFromSha, toSha: observedSha,
      impact: input.delta.impact, rationale: input.delta.rationale,
      acceptanceFocus: input.delta.acceptanceFocus, priorFindingIds: input.delta.priorFindingIds,
    }, worktree);
    if (complete) requireValue(isDeepStrictEqual(input.delta, assessment),
      "delta assessment contradicts recomputed Git facts or normalized judgment");
    for (const key of ["comparisonRange", "descendant", "rewrittenHistory", "impact", "rationale",
      "action", "changedFiles", "statistics", "acceptanceFocus", "priorFindingIds", "requestedResult"]) {
      delta[key] = assessment[key];
    }
  }
  const role = gate === "review" ? "reviewer" : "tester";
  const title = `[${issueKey}] ${gate === "review" ? "Reviewer" : "Tester"}`;
  const eventKey = `gate:${gate}:${observedSha}:${input.attempt}`;
  const packet = {
    schemaVersion: "gate-attempt/v1", issueKey, role, worker: { threadId: worker.threadId, hostId: worker.hostId ?? "local" },
    repository: REPOSITORY, baseBranch: BASE_BRANCH, headBranch: worker.branch, worktree: path.resolve(worktree),
    observedSha, comparedFromSha: input.comparedFromSha ?? null, pullRequest: input.pullRequest,
    acceptanceCriteria: input.acceptanceCriteria, userDecisions: input.userDecisions, waivers: input.waivers ?? [],
    validation: input.validation, reviewDecision: input.reviewDecision, contextPath,
    plan: { path: planPath, revision: state.implementationPlan.revision }, resultPath, ...delta,
  };
  const claim = [process.execPath, path.join(worktree, ".agents/skills/corch-development-workflow/scripts/task-state.mjs"),
    "claim-gate", "--issue", issueKey, "--gate", gate, "--thread", "<SessionStart session ID>", "--worktree", path.resolve(worktree), "--sha", observedSha];
  const prompt = [title, `Use $corch-${role} for this gate.`,
    `Attempt event: ${eventKey}.`,
    "Your first action is claim-gate with your validated Corch session ID from SessionStart. If unavailable, stop and report the missing identity. Execute this argument array without a shell; replace only the session ID placeholder:",
    JSON.stringify(claim),
    "Inspect only after the claim succeeds. The initial project directory is not the inspection target: use the absolute Worker checkout for every command, source read, state and evidence operation. Create no worktree and run no setup. Do not start subagents.",
    "Use the current acceptance criteria and user decisions below; references provide local context without inheriting a Worker transcript. Return the existing v2 result on the first attempt; for corrections follow requestedResult. Send the result to the Worker and resultPath. Stop every process you start before ending the turn.",
    JSON.stringify(packet, null, 2),
  ].join("\n");
  const existing = state.tasks[role];
  const deliveredTo = state.deliveredEvents[eventKey];
  if (existing && !existing.retired) {
    requireValue(sameCheckout(existing.worktree, worktree), "registered gate checkout conflicts with Worker");
    requireValue(!deliveredTo || deliveredTo === existing.threadId, "gate delivery event conflicts with registered identity");
    return { action: deliveredTo ? "delivered" : "reuse", eventKey,
      arguments: { threadId: existing.threadId, ...(existing.hostId ? { hostId: existing.hostId } : {}), prompt } };
  }
  if (deliveredTo) return { action: "recover", eventKey, threadId: deliveredTo,
    reason: "Inspect this chat and its claim before resending; do not create a duplicate." };
  const runtime = gate === "review" ? reviewerThreadRuntimeArguments(state.executionRoute) : testerThreadRuntimeArguments();
  return { action: "create", eventKey, arguments: { title, prompt, ...runtime,
    target: { type: "project", projectId: input.projectId, environment: { type: "local" } } } };
}

// Git topology is observed here; impact remains the caller's explicit judgment.
export function assessGateDelta({ gate, fromSha, toSha, impact, rationale,
  acceptanceFocus = [], priorFindingIds = [] }, worktree = process.cwd()) {
  const errors = [];
  if (!["review", "test"].includes(gate)) errors.push("--gate must be review or test");
  if (!SHA_PATTERN.test(fromSha ?? "") || !SHA_PATTERN.test(toSha ?? ""))
    errors.push("--from and --to must be lowercase full SHAs");
  if (!["irrelevant", "affected", "material"].includes(impact))
    errors.push("--impact must be irrelevant, affected, or material");
  if (typeof rationale !== "string" || rationale.trim().length < 12)
    errors.push("--rationale must explain the impact judgment");
  if (!strings(acceptanceFocus) || !strings(priorFindingIds))
    errors.push("acceptanceFocus and priorFindingIds must be arrays of non-empty strings");
  if (errors.length) throw new WorkflowValidationError(errors);
  const cwd = path.resolve(worktree);
  function git(args, allowedStatuses = [0]) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false, windowsHide: true, timeout: 15_000 });
    if (result.error || !allowedStatuses.includes(result.status))
      throw new WorkflowValidationError([redactText(result.error?.message || result.stderr?.trim() || `git ${args[0]} failed`)]);
    return result;
  }
  git(["rev-parse", "--show-toplevel"]);
  git(["cat-file", "-e", `${fromSha}^{commit}`]);
  git(["cat-file", "-e", `${toSha}^{commit}`]);
  const sameCommit = fromSha === toSha;
  const descendant = sameCommit || git(["merge-base", "--is-ancestor", fromSha, toSha], [0, 1]).status === 0;
  const lines = (args) => git(args).stdout.trim().split(/\r?\n/).filter(Boolean);
  const changedFiles = sameCommit ? [] : lines(["diff", "--name-only", "--diff-filter=ACMRD", fromSha, toSha, "--"]);
  const statistics = sameCommit ? [] : lines(["diff", "--numstat", fromSha, toSha, "--"]).map((line) => {
    const [additions, deletions, ...fileParts] = line.split("\t");
    return { path: fileParts.join("\t"), additions: additions === "-" ? null : Number(additions),
      deletions: deletions === "-" ? null : Number(deletions) };
  });
  const action = sameCommit || (descendant && impact === "irrelevant") ? "carry-forward"
    : !descendant || impact === "material" ? "coherent-recheck" : "targeted-delta";
  return {
    schemaVersion: "gate-delta-assessment/v1", status: "assessed", role: gate,
    fromSha, toSha, comparisonRange: `${fromSha}..${toSha}`, descendant, rewrittenHistory: !descendant,
    impact, rationale: rationale.trim(), action, changedFiles, statistics, acceptanceFocus,
    priorFindingIds: [...new Set(priorFindingIds)],
    requestedResult: action === "targeted-delta" ? `${gate}-amendment/v1` : `${gate}-result/v2`,
  };
}

const OPTIONS = {
  selection: { "--issue": "issueKey", "--pr": "pullRequestNumber", "--head-branch": "headBranch", "--selection": "selectionPath" },
  assess: { "--gate": "gate", "--from": "fromSha", "--to": "toSha", "--impact": "impact", "--rationale": "rationale",
    "--acceptance": "acceptanceFocus", "--finding": "priorFindingIds" },
  compose: { "--gate": "gate", "--base": "basePath", "--amendment": "amendmentPath", "--output": "outputPath" },
  dispatch: {},
};

function usage(command) {
  const help = {
    selection: "gate.mjs selection --issue TASK-N --pr N --head-branch codex/task-n-<slug> --selection <path>\nValidates gate-selection/v2 and declared artifacts; optional early feedback before prepare-report.",
    assess: "gate.mjs assess --gate review|test --from <40-hex> --to <40-hex> --impact irrelevant|affected|material --rationale <text> [--acceptance <criterion>] [--finding <id>]\nRepeat --acceptance/--finding as needed. Rewritten history requires a coherent recheck.",
    compose: "gate.mjs compose --gate review|test --base <result.json> --amendment <amendment.json> [--output <result.json>]\nEvery previous finding/failure needs a disposition and every acceptance criterion an update or explicit carry-forward. Without --output, prints the complete v2 result. Output must be its canonical .agents/evidence/<issue>/<sha>/<gate>-result.json and must not exist.",
    dispatch: "gate.mjs dispatch < request.json\nPrepares create/reuse/delivered/recover from JSON stdin. Optional delta accepts a compact impact/rationale judgment or a complete assessment, verified against Git in the absolute Worker checkout. Writes no state or files.",
  };
  return command ? help[command] : "Usage: node gate.mjs <selection|assess|compose|dispatch> [arguments]\nUse gate.mjs <command> --help for command arguments.";
}

function parseArguments(command, argv) {
  if (!Object.hasOwn(OPTIONS, command)) throw new WorkflowValidationError([`unknown gate command: ${command ?? "(missing)"}`]);
  const spec = OPTIONS[command];
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") { args.help = true; continue; }
    const key = Object.hasOwn(spec, flag) ? spec[flag] : undefined;
    if (!key) throw new WorkflowValidationError([`unknown argument: ${flag}`]);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new WorkflowValidationError([`missing value for ${flag}`]);
    if (["acceptanceFocus", "priorFindingIds"].includes(key)) (args[key] ??= []).push(value);
    else {
      if (Object.hasOwn(args, key)) throw new WorkflowValidationError([`duplicate argument: ${flag}`]);
      args[key] = key === "pullRequestNumber" ? Number(value) : value;
    }
  }
  return args;
}

function prepareSelection(args) {
  for (const field of ["issueKey", "pullRequestNumber", "headBranch", "selectionPath"])
    requireValue(args[field], `missing argument: ${field}`);
  const root = gitValue(process.cwd(), ["rev-parse", "--show-toplevel"]);
  const selection = validateGateSelection(parseJsonDocument(readFileSync(path.resolve(root, args.selectionPath), "utf8")), {
    issueKey: args.issueKey, repository: REPOSITORY, pullRequestNumber: args.pullRequestNumber,
    baseBranch: BASE_BRANCH, headBranch: args.headBranch,
  });
  const evidence = resolveEvidenceFiles({ repositoryRoot: root, issueKey: selection.issueKey,
    observedSha: selection.observedSha, files: resultArtifactPaths(selection), metadata: artifactMetadata(selection) });
  if (selection.actual.test.decision === "skipped") validateHandoffEvidence(selection, evidence);
  return { status: "valid", issueKey: selection.issueKey, pullRequestNumber: selection.pullRequest.number,
    observedSha: selection.observedSha, review: selection.actual.review.decision, test: selection.actual.test.decision,
    artifacts: evidence.map((item) => item.suppliedPath),
    marker: buildGateSelectionMarker({ issueKey: selection.issueKey, pullRequestNumber: selection.pullRequest.number,
      observedSha: selection.observedSha, review: selection.actual.review.decision, test: selection.actual.test.decision,
      waivers: selection.waivers }),
  };
}

function prepareComposition(args) {
  requireValue(["review", "test"].includes(args.gate) && args.basePath && args.amendmentPath,
    "--gate review|test, --base, and --amendment are required");
  const result = composeGateResult(args.gate === "review" ? "reviewer" : "tester",
    parseJsonDocument(readFileSync(args.basePath, "utf8")), parseJsonDocument(readFileSync(args.amendmentPath, "utf8")));
  if (!args.outputPath) return result;
  const outputPath = path.resolve(args.outputPath);
  const expected = `.agents/evidence/${result.issueKey}/${result.observedSha}/${args.gate}-result.json`;
  requireValue(outputPath === path.resolve(expected), `--output must be ${expected}`);
  // Check existing ancestors before creating directories, including symlinks.
  localFile(process.cwd(), expected, ".agents/evidence/", { mustExist: false });
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return { status: "written", path: path.relative(process.cwd(), outputPath).replaceAll("\\", "/") };
}

function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (["--help", "-h"].includes(command) && argv.length === 0) {
    process.stdout.write(`${usage()}\n`); return;
  }
  const args = parseArguments(command, argv);
  if (args.help) { process.stdout.write(`${usage(command)}\n`); return; }
  const result = command === "selection" ? prepareSelection(args)
    : command === "assess" ? assessGateDelta(args)
    : command === "compose" ? prepareComposition(args)
    : buildGateDispatch(parseJsonDocument(readFileSync(0, "utf8")));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${redactText(error.message)}\n`);
    process.exitCode = 1;
  }
}
