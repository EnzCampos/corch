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
