import { REPOSITORY, escapeRegExp } from "./workflow-config.mjs";

export const EVIDENCE_PROFILES = new Set([
  "frontend",
  "backend",
  "mixed",
  "general",
]);

export const SHA_PATTERN = /^[0-9a-f]{40}$/;

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

export function assertExactKeys(value, allowed, label, errors) {
  if (!plainObject(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      errors.push(`${label}.${key} is not supported`);
    }
  }
}

export function requireString(value, label, errors) {
  if (!nonEmptyString(value)) {
    errors.push(`${label} must be a non-empty string`);
  }
}

export function requireStringArray(value, label, errors, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    errors.push(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array`);
    return;
  }
  value.forEach((item, index) =>
    requireString(item, `${label}[${index}]`, errors),
  );
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

export function detectSecretText(text) {
  const findings = [];
  for (const { label, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
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
