import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRuntimeSettings } from "./runtime-policy.mjs";

export function validateConfig(value) {
  const fail = (message) => {
    throw new Error(`Invalid Corch configuration: ${message}`);
  };
  if (
    !value ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository ?? "")
  )
    fail("repository must be owner/name");
  if (!/^[A-Z][A-Z0-9]*$/.test(value.issuePrefix ?? ""))
    fail("issuePrefix must be an uppercase project key");
  if (value.scrum !== undefined) {
    if (
      !value.scrum ||
      typeof value.scrum !== "object" ||
      Array.isArray(value.scrum) ||
      Object.keys(value.scrum).some(
        (key) => !["provider", "projectUrl"].includes(key),
      )
    )
      fail(
        "scrum must contain only provider and projectUrl; keep credentials at runtime",
      );
    if (
      value.scrum.provider != null &&
      (typeof value.scrum.provider !== "string" ||
        !/^[a-z][a-z0-9-]*$/.test(value.scrum.provider))
    )
      fail("scrum.provider must be a provider identifier or null");
    if (value.scrum.projectUrl != null) {
      let url;
      try {
        url = new URL(value.scrum.projectUrl);
      } catch {
        /* Report a field error below. */
      }
      if (
        typeof value.scrum.projectUrl !== "string" ||
        !value.scrum.projectUrl.startsWith("https://") ||
        /[\s<>()[\]\\]/u.test(value.scrum.projectUrl) ||
        !url ||
        url.protocol !== "https:" ||
        url.username ||
        url.password
      )
        fail("scrum.projectUrl must be a credential-free HTTPS URL or null");
    }
  }
  if (
    typeof value.baseBranch !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value.baseBranch) ||
    value.baseBranch.includes("..") ||
    value.baseBranch.includes("//") ||
    value.baseBranch.endsWith("/") ||
    value.baseBranch.endsWith(".") ||
    value.baseBranch
      .split("/")
      .some((part) => part.startsWith(".") || part.endsWith(".lock"))
  )
    fail("baseBranch must be a Git branch name");
  if (
    typeof value.localCiCommand !== "string" ||
    !value.localCiCommand.trim() ||
    /[\r\n]/.test(value.localCiCommand)
  )
    fail("localCiCommand must be a single command label");
  if (!Array.isArray(value.setup?.steps)) fail("setup.steps must be an array");
  const names = new Set();
  for (const step of value.setup.steps) {
    if (!/^[a-z][a-z0-9-]*$/.test(step.name ?? "") || names.has(step.name))
      fail("setup step names must be unique lowercase identifiers");
    names.add(step.name);
    if (
      typeof step.command !== "string" ||
      !step.command ||
      /[\r\n\0]/.test(step.command)
    )
      fail("setup command must be an executable");
    if (
      !Array.isArray(step.args) ||
      step.args.some((arg) => typeof arg !== "string" || /[\r\n\0]/.test(arg))
    )
      fail("setup args must be separate strings");
    for (const field of ["inputs", "outputs"]) {
      if (
        !Array.isArray(step[field]) ||
        step[field].some(
          (entry) =>
            typeof entry !== "string" ||
            !entry ||
            /[\\:\0]/.test(entry) ||
            path.posix.isAbsolute(entry) ||
            entry
              .split("/")
              .some((part) => !part || part === "." || part === ".."),
        )
      )
        fail(`${step.name}.${field} must contain repository-relative paths`);
    }
  }
  try {
    validateRuntimeSettings(value.runtimes);
  } catch (error) {
    fail(error.message);
  }
  return value;
}

export function readConfig(
  configPath = process.env.CORCH_CONFIG ||
    fileURLToPath(new URL("../../../../workflow.json", import.meta.url)),
) {
  return validateConfig(JSON.parse(readFileSync(configPath, "utf8")));
}

export const CONFIG = readConfig();
export const REPOSITORY = CONFIG.repository;
export const REMOTE_URL = `https://github.com/${REPOSITORY}.git`;
export const BASE_BRANCH = CONFIG.baseBranch;
export const ISSUE_PREFIX = CONFIG.issuePrefix;
export const ISSUE_PATTERN = new RegExp(`^${ISSUE_PREFIX}-([1-9]\\d*)$`);
// Preserve existing families on legacy branches; new branches use corch/.
export const BRANCH_PATTERN = new RegExp(
  `^(?:corch|codex)/${ISSUE_PREFIX.toLowerCase()}-([1-9]\\d*)-[a-z0-9]+(?:-[a-z0-9]+)*$`,
);
export function issueFromBranch(branch) {
  const match = BRANCH_PATTERN.exec(branch ?? "");
  return match ? `${ISSUE_PREFIX}-${match[1]}` : undefined;
}
export const escapeRegExp = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
