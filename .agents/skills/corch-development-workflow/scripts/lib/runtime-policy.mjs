// Configuration selects new runtimes; saved routes retain their original pairs.
export const DEFAULT_WORKER_RUNTIMES = Object.freeze({
  bounded: { model: "gpt-6-luna", reasoningEffort: "xhigh" },
  routine: { model: "gpt-6-luna", reasoningEffort: "xhigh" },
  standard: { model: "gpt-6-luna", reasoningEffort: "max" },
  complex: { model: "gpt-6-luna", reasoningEffort: "max" },
  "high-risk": { model: "gpt-5.6-sol", reasoningEffort: "high" },
  exceptional: { model: "gpt-5.6-sol", reasoningEffort: "xhigh" },
});
export const ROUTE_LEVELS = Object.freeze({
  bounded: 0, routine: 0, standard: 1, complex: 1, "high-risk": 2, exceptional: 3,
});
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const efforts = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

export function validateRuntime(value, label = "runtime") {
  if (!object(value) || Object.keys(value).some((key) => !["model", "reasoningEffort"].includes(key)) ||
      typeof value.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value.model) ||
      !efforts.has(value.reasoningEffort)) {
    throw new Error(`${label} requires a complete model/reasoningEffort pair`);
  }
  return value;
}

export function validateRuntimeSettings(settings) {
  if (settings === undefined) return;
  if (!object(settings) || Object.keys(settings).some((key) => !["planner", "worker", "reviewer", "tester"].includes(key))) {
    throw new Error("runtimes must contain only planner, worker, reviewer and tester settings");
  }
  for (const role of ["planner", "reviewer", "tester"]) {
    if (settings[role] === undefined || (role === "reviewer" && settings[role] === "worker")) continue;
    validateRuntime(settings[role], `runtimes.${role}`);
  }
  if (settings.worker !== undefined) {
    if (!object(settings.worker)) throw new Error("runtimes.worker must contain classification overrides");
    for (const [classification, runtime] of Object.entries(settings.worker)) {
      if (!Object.hasOwn(DEFAULT_WORKER_RUNTIMES, classification)) throw new Error(`invalid Worker classification: ${classification}`);
      validateRuntime(runtime, `runtimes.worker.${classification}`);
    }
  }
}

export function resolveRuntime(config, role, { classification, workerRoute } = {}) {
  validateRuntimeSettings(config.runtimes);
  const settings = config.runtimes ?? {};
  let runtime;
  if (role === "worker") {
    if (!Object.hasOwn(DEFAULT_WORKER_RUNTIMES, classification)) throw new Error("classification is invalid");
    runtime = settings.worker?.[classification] ?? DEFAULT_WORKER_RUNTIMES[classification];
  } else if (role === "planner") {
    runtime = settings.planner ?? { model: "gpt-6-astra", reasoningEffort: "xhigh" };
  } else if (role === "tester") {
    runtime = settings.tester ?? DEFAULT_WORKER_RUNTIMES.bounded;
  } else if (role === "reviewer") {
    const selected = settings.reviewer ?? "worker";
    runtime = selected === "worker"
      ? { model: workerRoute?.model, reasoningEffort: workerRoute?.reasoningEffort }
      : selected;
  } else throw new Error(`unknown runtime role: ${role}`);
  return { ...validateRuntime(runtime) };
}

export function runtimeArguments(runtime) {
  validateRuntime(runtime);
  return { model: runtime.model, thinking: runtime.reasoningEffort };
}

export const EXECUTION_ROUTE_SCHEMA = "execution-route/v2";
const RISK_SIGNALS = new Set(["crossPackageCoupling", "noveltyOrAmbiguity", "highBlastRadius",
  "securityPrivacyBilling", "infrastructureOrDeployment", "heavyValidation"]);

export function validateExecutionRoute(route, expected = {}) {
  if (!object(route) || route.schemaVersion !== EXECUTION_ROUTE_SCHEMA ||
      !/^[A-Z][A-Z0-9]*-[1-9]\d*$/.test(route.issueKey ?? "") ||
      (expected.issueKey !== undefined && route.issueKey !== expected.issueKey))
    throw new Error("execution route issue identity is invalid");
  if (!Object.hasOwn(DEFAULT_WORKER_RUNTIMES, route.classification)) throw new Error("classification is invalid");
  validateRuntime({ model: route.model, reasoningEffort: route.reasoningEffort });
  if (!Array.isArray(route.riskSignals) || new Set(route.riskSignals).size !== route.riskSignals.length ||
      route.riskSignals.some((signal) => !RISK_SIGNALS.has(signal))) throw new Error("riskSignals are invalid");
  if (typeof route.rationale !== "string" || !route.rationale.trim()) throw new Error("rationale is required");
  return route;
}

export function createExecutionRoute({ issueKey, classification, riskSignals = [], rationale }, config = {}) {
  return validateExecutionRoute({ schemaVersion: EXECUTION_ROUTE_SCHEMA, issueKey, classification,
    riskSignals: [...riskSignals].sort(), ...resolveRuntime(config, "worker", { classification }), rationale });
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
