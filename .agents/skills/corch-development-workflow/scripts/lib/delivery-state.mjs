import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ISSUE_PATTERN } from "./workflow-config.mjs";
import { buildDeliveryTaskDispatch, validateExecutionRoute } from "./bootstrap.mjs";
import { ROUTE_LEVELS } from "./runtime-policy.mjs";

export const TASK_STATE_SCHEMA = "task-state/v2";

export const WORKFLOW_PROTOCOL = "delivery-v3";

export function gitValue(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, shell: false, timeout: 15_000 });
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `git ${args[0]} failed`);
  return result.stdout.trim();
}

export function sameCheckout(left, right) {
  return typeof left === "string" && typeof right === "string" &&
    path.isAbsolute(left) && path.isAbsolute(right) && realpathSync(left) === realpathSync(right);
}

export function verifyWorkerCheckout(state, worktree, sha) {
  const worker = state.tasks?.worker;
  if (!worker?.threadId || worker.retired || !sameCheckout(worker.worktree, worktree)) {
    throw new Error("an active Worker with the matching registered checkout is required");
  }
  if (!sameCheckout(gitValue(worktree, ["rev-parse", "--show-toplevel"]), worktree) ||
      !worker.branch || worker.branch !== gitValue(worktree, ["branch", "--show-current"])) {
    throw new Error("Worker checkout root or branch does not match registration");
  }
  if (sha && gitValue(worktree, ["rev-parse", "HEAD"]) !== sha) throw new Error("Worker checkout commit does not match requested commit");
  return worker;
}

export function validateRouteState(state) {
  if (!state.executionRoute) throw new Error("record the execution route before dispatch");
  validateExecutionRoute(state.executionRoute, { issueKey: state.issueKey });
  const revision = state.executionRouteRevision ?? 1;
  const history = state.executionRouteHistory ?? [];
  if (!Number.isSafeInteger(revision) || revision < 1 || !Array.isArray(history) || history.length !== revision - 1) {
    throw new Error("invalid execution route revision/history");
  }
  let previousLevel = -1;
  for (const [index, snapshot] of history.entries()) {
    if (snapshot?.revision !== index + 1) throw new Error("invalid execution route history revision");
    validateExecutionRoute(snapshot.route, { issueKey: state.issueKey });
    const level = ROUTE_LEVELS[snapshot.route.classification];
    if (level <= previousLevel) throw new Error("execution route history must escalate");
    previousLevel = level;
  }
  if (ROUTE_LEVELS[state.executionRoute.classification] <= previousLevel) throw new Error("execution route history must escalate");
  return revision;
}

export function readDeliveryState(worktree, issueKey) {
  if (!path.isAbsolute(worktree) || !ISSUE_PATTERN.test(issueKey)) throw new Error("absolute worktree and valid issue required");
  const common = gitValue(worktree, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const local = path.join(worktree, ".agents", "task-state", `${issueKey}.json`);
  const shared = path.join(path.dirname(common), ".agents", "task-state", `${issueKey}.json`);
  const file = existsSync(local) ? local : shared;
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("task state must be a regular file");
  const state = JSON.parse(readFileSync(file, "utf8"));
  if (state.schemaVersion !== TASK_STATE_SCHEMA || state.workflowProtocol !== WORKFLOW_PROTOCOL || state.issueKey !== issueKey ||
      !state.tasks || !state.gates || !state.deliveredEvents) throw new Error("invalid task state identity");
  validateRouteState(state);
  return state;
}

export function buildWorkerContinuation(bootstrap, state, planRevision) {
  const revision = validateRouteState(state);
  if (state.issueKey !== bootstrap.issue.key || state.implementationPlan?.revision !== planRevision) {
    throw new Error("Worker dispatch requires the current recorded plan revision and matching issue");
  }
  if (state.activeCheckoutGate) throw new Error("end the active checkout gate before Worker continuation");
  const eventKey = `worker-route:${revision}`;
  const worker = state.tasks.worker;
  if (!worker?.threadId || worker.retired) throw new Error("register the active Worker before continuation");
  const deliveredTo = state.deliveredEvents?.[eventKey];
  if (deliveredTo && deliveredTo !== worker?.threadId) throw new Error("Worker continuation event conflicts with registered identity");
  const dispatch = buildDeliveryTaskDispatch({ ...bootstrap, executionRoute: state.executionRoute }, { role: "worker", planRevision });
  return {
    ...dispatch,
    prompt: `${dispatch.prompt}\nContinuation event: ${eventKey}; route revision ${revision}. Rationale: ${state.executionRoute.rationale}. Preserve implementation progress and completed validation.`,
    routeRevision: revision,
    eventKey,
    delivered: Boolean(deliveredTo),
    ...(worker && !worker.retired ? { threadId: worker.threadId } : {}),
  };
}
