import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { REPOSITORY, escapeRegExp } from "./workflow-config.mjs";

const SECRET_PATTERNS = [
  { label: "OpenAI key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  {
    label: "GitHub token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: "Bearer token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi },
  {
    label: "private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    label: "credential assignment",
    pattern:
      /\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*[^\s,;]{12,}/gi,
  },
];

const CUSTOMER_DATA_PATTERNS = [
  {
    label: "email address",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    label: "Brazilian phone number",
    pattern:
      /(?<![A-F0-9])(?:\+55\s*\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}|\(\d{2}\)\s*9?\d{4}[-\s]?\d{4}|\d{2}[\s-]9?\d{4}[-\s]\d{4}|9?\d{4}-\d{4}|\d{10,11})(?![A-F0-9])/gi,
  },
];

const SAFE_MACHINE_IDENTIFIER_PATTERNS = [
  new RegExp(
    "(?<=https://github\\.com/" +
      escapeRegExp(REPOSITORY) +
      "/actions/runs/)\\d+\\b",
    "g",
  ),
];

function protectSafeMachineIdentifiers(text) {
  const values = [];
  let protectedText = String(text ?? "");
  for (const pattern of SAFE_MACHINE_IDENTIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    protectedText = protectedText.replace(pattern, (value) => {
      const marker = `[Corch_MACHINE_ID_${values.length}]`;
      values.push(value);
      return marker;
    });
  }
  return {
    text: protectedText,
    restore(value) {
      return value.replace(
        /\[Corch_MACHINE_ID_(\d+)\]/g,
        (match, index) => values[Number(index)] ?? match,
      );
    },
  };
}

export class WorkflowValidationError extends Error {
  constructor(errors) {
    super(errors.join("\n"));
    this.name = "WorkflowValidationError";
    this.errors = errors;
  }
}

export function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function detectUnsafeText(text) {
  const findings = [];
  const protectedInput = protectSafeMachineIdentifiers(text).text;
  for (const { label, pattern } of [
    ...SECRET_PATTERNS,
    ...CUSTOMER_DATA_PATTERNS,
  ]) {
    pattern.lastIndex = 0;
    if (pattern.test(protectedInput)) {
      findings.push(label);
    }
  }
  return [...new Set(findings)];
}

export function redactText(text) {
  const protectedInput = protectSafeMachineIdentifiers(text);
  let output = protectedInput.text;
  for (const { pattern } of [...SECRET_PATTERNS, ...CUSTOMER_DATA_PATTERNS]) {
    pattern.lastIndex = 0;
    output = output.replace(pattern, "[REDACTED]");
  }
  return protectedInput.restore(output);
}

export function parseJsonDocument(text) {
  try {
    const value = JSON.parse(text);
    if (!plainObject(value)) {
      throw new Error("document must be an object");
    }
    return value;
  } catch (error) {
    throw new WorkflowValidationError([
      `invalid JSON document: ${error.message}`,
    ]);
  }
}

// A work item can originate in a tracker, a document, or the current conversation.
// These helpers validate references; they never fetch a source or authorize a write.
export function isHttpsUrl(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("https://") ||
    /[\s<>()[\]\\]/u.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isSourceRef(value) {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string" || !value || /[\r\n\0<>]/u.test(value))
    return false;
  if (isHttpsUrl(value)) return true;
  if (/^codex:\/\/threads\/[a-zA-Z0-9_-]+$/u.test(value)) return true;
  // Local documents use portable repository-relative paths; no traversal or drives.
  if (/[\\:]/u.test(value) || value.startsWith("/") || value.trim() !== value)
    return false;
  const documentPath = value.split("#", 1)[0];
  return (
    (documentPath.includes("/") ||
      /^[^.].*\.[a-zA-Z0-9]+$/u.test(documentPath)) &&
    documentPath
      .split("/")
      .every((part) => part && part !== "." && part !== "..")
  );
}

export function containedPath(root, relative) {
  if (
    typeof relative !== "string" ||
    !relative ||
    /[\\:\0]/.test(relative) ||
    path.isAbsolute(relative) ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("invalid checkout-relative path");
  const candidate = path.resolve(root, relative);
  let ancestor = candidate;
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const difference = path.relative(realpathSync(root), realpathSync(ancestor));
  if (
    difference === ".." ||
    difference.startsWith(".." + path.sep) ||
    path.isAbsolute(difference)
  )
    throw new Error("path escapes the checkout");
  return candidate;
}
