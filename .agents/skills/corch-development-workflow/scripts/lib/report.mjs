import {
  EVIDENCE_PROFILES,
  SHA_PATTERN,
  WorkflowValidationError,
  plainObject,
  detectUnsafeText,
  parseJsonDocument,
} from "./validation.mjs";
import {
  waiversFor,
  hasWaiver,
  acceptanceWaived,
  validateGateResult,
  validateReadyHandoff,
} from "./gate-contracts.mjs";
import { ISSUE_PATTERN, REPOSITORY, BASE_BRANCH } from "./workflow-config.mjs";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { isHttpsUrl } from "./task-source.mjs";

export const MAX_EVIDENCE_FILES = 10;

export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

export const MAX_TEXT_EVIDENCE_BYTES = 512 * 1024;

export const EVIDENCE_EXTENSIONS = new Set([
  ".json",
  ".txt",
  ".log",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);

export function validateHandoffEvidence(selection, evidenceFiles) {
  // Callers validate the packet before adding publication metadata or resolving files.
  // Aggregate profile minima cannot attribute artifacts to individual waived checks.
  // Verified acceptance still needs its recorded evidence; supplied files are validated separately.
  const unverified = selection.acceptance.some(
    (item) =>
      item.status === "NOT_VERIFIED" &&
      acceptanceWaived(selection, item.criterion),
  );
  if (hasWaiver(selection, "test") || unverified) return;
  validateEvidenceProfile(selection.evidenceProfile, evidenceFiles, {
    gate: "test",
    verdict: "PASS",
  });
}

export function resultArtifactPaths(result) {
  const paths = [];
  for (const artifact of result.artifacts ?? []) {
    paths.push(artifact.path);
  }
  for (const command of result.commands ?? []) {
    for (const artifact of command.artifacts ?? []) {
      paths.push(artifact.path);
    }
  }
  return [...new Set(paths)];
}

export function artifactMetadata(result) {
  const artifacts = [
    ...(result.artifacts ?? []),
    ...(result.commands ?? []).flatMap((command) => command.artifacts ?? []),
  ];
  return artifacts;
}

export function buildIdempotencyMarker({
  schemaVersion,
  issueKey,
  observedSha,
  gate,
}) {
  return `[corch-validation:v2 schema=${schemaVersion} issue=${issueKey} observed=${observedSha} gate=${gate}]`;
}

function waiverMarker(waivers = []) {
  if (waivers.length === 0) return "";
  const normalized = waivers
    .map((waiver) => ({
      target: waiver.target,
      command: waiver.command ?? null,
      userDecision: waiver.userDecision,
      reason: waiver.reason,
      acceptanceCriteria: [...waiver.acceptanceCriteria].sort(),
    }))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  return ` waivers=${createHash("sha256").update(JSON.stringify(normalized)).digest("hex")}`;
}

export function buildGateSelectionMarker({
  issueKey,
  pullRequestNumber,
  observedSha,
  review,
  test,
  waivers,
}) {
  return `[corch-handoff:v2 issue=${issueKey} pr=${pullRequestNumber} observed=${observedSha} review=${review} test=${test}${waiverMarker(waivers)}]`;
}

export function buildPullRequestCommentMarker({
  issueKey,
  pullRequestNumber,
  observedSha,
  gate,
  waivers,
}) {
  return `[corch-pr-result:v2 issue=${issueKey} pr=${pullRequestNumber} observed=${observedSha} gate=${gate}${waiverMarker(waivers)}]`;
}

export function waiverSummaryLines(selection) {
  return waiversFor(selection).map((waiver) => {
    const target = waiver.target === "command" ? waiver.command : waiver.target;
    const gap =
      waiver.acceptanceCriteria.length > 0
        ? ` Coverage waived: ${waiver.acceptanceCriteria.join("; ")}.`
        : "";
    return `${target}: ${waiver.reason}. User decision: ${waiver.userDecision}.${gap}`;
  });
}

export function buildEvidenceComment({
  marker,
  result,
  profile,
  attachments,
  localArtifacts = [],
  gate,
}) {
  const lines = [
    marker,
    "",
    `## ${gate === "handoff" ? `Ready for human review${waiversFor(result).length ? " with explicit check waivers" : ""}` : `${result.verdict} ${result.schemaVersion}`}`,
    "",
    `Pull request: [#${result.pullRequest.number}](${result.pullRequest.url})`,
    `Observed commit: \`${result.observedSha}\``,
    `Evidence profile: ${profile}`,
    "",
    result.summary,
    "",
    "### Acceptance",
    ...result.acceptance.map(
      (item) => `- **${item.status}** — ${item.criterion} — ${item.evidence}`,
    ),
  ];
  if (waiversFor(result).length > 0) {
    lines.push(
      "",
      "### Explicit check waivers and confidence gaps",
      ...waiverSummaryLines(result).map((line) => `- ${line}`),
    );
  }
  if (Array.isArray(result.commands) && result.commands.length > 0) {
    lines.push("", "### Validation commands");
    lines.push(
      ...result.commands.map(
        (item) =>
          `- **${item.status}** — \`${item.command}\` — ${item.summary}`,
      ),
    );
  }
  if (plainObject(result.outcomes)) {
    lines.push("", "### Gate outcomes");
    for (const [label, outcome] of [
      ["Reviewer", result.outcomes.review],
      ["Tester", result.outcomes.test],
    ]) {
      const observed = outcome.observedSha
        ? ` at \`${outcome.observedSha}\``
        : "";
      const evidence = outcome.evidenceUrl
        ? ` — [material attempt](${outcome.evidenceUrl})`
        : "";
      lines.push(
        `- **${label}: ${outcome.status}**${observed} — ${outcome.summary}${evidence}`,
      );
    }
    lines.push(
      `- **CI: ${result.outcomes.ci.status}** at \`${result.outcomes.ci.observedSha}\` — ` +
        result.outcomes.ci.summary +
        (result.outcomes.ci.runUrl
          ? ` — [GitHub Actions run](${result.outcomes.ci.runUrl})`
          : ""),
    );
    if (result.outcomes.warnings.length > 0) {
      lines.push("", "### Non-blocking publication warnings");
      lines.push(...result.outcomes.warnings.map((warning) => `- ${warning}`));
    }
  }
  if (attachments.length > 0) {
    lines.push("", "### Evidence");
    for (const attachment of attachments) {
      lines.push(
        `- ${attachment.caption} — [${attachment.filename}](${attachment.url}) — acceptance: ${attachment.acceptanceCriteria.join(", ")}`,
      );
      if (
        new Set([".png", ".jpg", ".jpeg", ".webp"]).has(attachment.extension)
      ) {
        lines.push(`![${attachment.caption}](${attachment.url})`);
      }
    }
  } else if (localArtifacts.length > 0) {
    lines.push("", "### Validated evidence metadata");
    lines.push(
      ...localArtifacts.map(
        (artifact) =>
          `- ${artifact.caption} — \`${artifact.filename}\` — SHA-256 \`${artifact.sha256}\` — acceptance: ${artifact.acceptanceCriteria.join(", ")}`,
      ),
    );
    lines.push(
      "- Binary artifacts are retained locally. Publish them only to an authorized destination with attachment support; the technical result remains valid.",
    );
  }
  const findings = result.findings ?? result.failures ?? [];
  if (findings.length > 0) {
    lines.push("", `### ${result.findings ? "Findings" : "Failures"}`);
    lines.push(
      ...findings.map(
        (item) => `- **${item.id}: ${item.title}** — ${item.evidence}`,
      ),
    );
  }
  return `${lines.join("\n")}\n`;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngDimensions(buffer) {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  if (
    buffer.length < 24 ||
    !buffer.subarray(0, 8).equals(signature) ||
    buffer.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    return undefined;
  }
  let offset = 8;
  let dimensions;
  const imageData = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) {
      return undefined;
    }
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const checksum = buffer.readUInt32BE(offset + 8 + length);
    if (crc32(buffer.subarray(offset + 4, offset + 8 + length)) !== checksum) {
      return undefined;
    }
    if (type === "IHDR") {
      if (offset !== 8 || length !== 13) {
        return undefined;
      }
      dimensions = {
        width: buffer.readUInt32BE(offset + 8),
        height: buffer.readUInt32BE(offset + 12),
      };
    } else if (type === "IDAT") {
      if (length > 0) {
        imageData.push(buffer.subarray(offset + 8, offset + 8 + length));
      }
    } else if (type === "IEND") {
      if (
        length !== 0 ||
        end !== buffer.length ||
        !dimensions ||
        imageData.length === 0
      ) {
        return undefined;
      }
      try {
        return inflateSync(Buffer.concat(imageData)).length > 0
          ? dimensions
          : undefined;
      } catch {
        return undefined;
      }
    }
    offset = end;
  }
  return undefined;
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return undefined;
  }
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;
  let dimensions;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) {
      return undefined;
    }
    if (startOfFrame.has(marker) && segmentLength >= 7) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      dimensions = width > 0 && height > 0 ? { width, height } : undefined;
    }
    if (marker === 0xda) {
      return dimensions && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9
        ? dimensions
        : undefined;
    }
    offset += 2 + segmentLength;
  }
  return undefined;
}

function webpDimensions(buffer) {
  if (
    buffer.length < 30 ||
    buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buffer.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    return undefined;
  }
  if (buffer.readUInt32LE(4) + 8 !== buffer.length) {
    return undefined;
  }
  const chunkLength = buffer.readUInt32LE(16);
  if (20 + chunkLength + (chunkLength % 2) > buffer.length) {
    return undefined;
  }
  const kind = buffer.subarray(12, 16).toString("ascii");
  if (kind === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (kind === "VP8L" && buffer[20] === 0x2f) {
    return {
      width: 1 + buffer[21] + ((buffer[22] & 0x3f) << 8),
      height:
        1 +
        ((buffer[22] & 0xc0) >> 6) +
        (buffer[23] << 2) +
        ((buffer[24] & 0x0f) << 10),
    };
  }
  if (
    kind === "VP8 " &&
    buffer[23] === 0x9d &&
    buffer[24] === 0x01 &&
    buffer[25] === 0x2a
  ) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  return undefined;
}

function imageDimensions(buffer, extension) {
  if (extension === ".png") {
    return pngDimensions(buffer);
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return jpegDimensions(buffer);
  }
  if (extension === ".webp") {
    return webpDimensions(buffer);
  }
  return undefined;
}

function readableScreenshotDimensions(dimensions) {
  return dimensions && dimensions.width >= 64 && dimensions.height >= 64;
}

export function resolveEvidenceFiles({
  repositoryRoot,
  issueKey,
  observedSha,
  files,
  metadata = [],
}) {
  if (!ISSUE_PATTERN.test(issueKey) || !SHA_PATTERN.test(observedSha)) {
    throw new WorkflowValidationError(["evidence identity is invalid"]);
  }
  const unique = [...new Set(files)];
  if (unique.length > MAX_EVIDENCE_FILES) {
    throw new WorkflowValidationError([
      `evidence may contain at most ${MAX_EVIDENCE_FILES} files`,
    ]);
  }
  const rootReal = realpathSync(repositoryRoot);
  const expectedDirectory = path.join(
    rootReal,
    ".agents",
    "evidence",
    issueKey,
    observedSha,
  );
  const expectedRelativePrefix = `.agents/evidence/${issueKey}/${observedSha}/`;
  const metaByPath = new Map(metadata.map((item) => [item.path, item]));
  return unique.map((suppliedPath) => {
    if (
      !suppliedPath.replaceAll("\\", "/").startsWith(expectedRelativePrefix)
    ) {
      throw new WorkflowValidationError([
        `evidence must stay under ${expectedRelativePrefix}`,
      ]);
    }
    const absolutePath = path.resolve(rootReal, suppliedPath);
    let current = absolutePath;
    while (current !== expectedDirectory) {
      const stats = lstatSync(current);
      if (stats.isSymbolicLink()) {
        throw new WorkflowValidationError([
          `${suppliedPath} contains a symlink`,
        ]);
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw new WorkflowValidationError([
          `${suppliedPath} resolves outside its evidence directory`,
        ]);
      }
      current = parent;
    }
    const real = realpathSync(absolutePath);
    const relative = path.relative(expectedDirectory, real);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new WorkflowValidationError([
        `${suppliedPath} resolves outside its evidence directory`,
      ]);
    }
    const stats = statSync(real);
    if (!stats.isFile()) {
      throw new WorkflowValidationError([
        `${suppliedPath} must be a regular file`,
      ]);
    }
    const extension = path.extname(real).toLowerCase();
    if (!EVIDENCE_EXTENSIONS.has(extension)) {
      throw new WorkflowValidationError([
        `${suppliedPath} has an unsupported extension`,
      ]);
    }
    if (stats.size > MAX_EVIDENCE_BYTES) {
      throw new WorkflowValidationError([`${suppliedPath} exceeds 10 MiB`]);
    }
    const content = readFileSync(real);
    const image = new Set([".png", ".jpg", ".jpeg", ".webp"]).has(extension)
      ? imageDimensions(content, extension)
      : undefined;
    if (
      new Set([".png", ".jpg", ".jpeg", ".webp"]).has(extension) &&
      !readableScreenshotDimensions(image)
    ) {
      throw new WorkflowValidationError([
        `${suppliedPath} is not a complete structurally valid image of at least 64x64 pixels`,
      ]);
    }
    if (new Set([".json", ".txt", ".log"]).has(extension)) {
      if (stats.size > MAX_TEXT_EVIDENCE_BYTES) {
        throw new WorkflowValidationError([
          `${suppliedPath} text evidence exceeds 512 KiB`,
        ]);
      }
      const unsafe = detectUnsafeText(content.toString("utf8"));
      if (unsafe.length > 0) {
        throw new WorkflowValidationError([
          `${suppliedPath} contains unsafe data: ${unsafe.join(", ")}`,
        ]);
      }
    } else {
      const unsafe = detectUnsafeText(content.toString("utf8"));
      if (unsafe.length > 0) {
        throw new WorkflowValidationError([
          `${suppliedPath} contains unsafe textual metadata: ${unsafe.join(", ")}`,
        ]);
      }
    }
    const itemMetadata = metaByPath.get(suppliedPath);
    if (!itemMetadata) {
      throw new WorkflowValidationError([
        `${suppliedPath} is missing caption and acceptance metadata`,
      ]);
    }
    return {
      suppliedPath,
      absolutePath: real,
      extension,
      size: stats.size,
      ...(image ? { width: image.width, height: image.height } : {}),
      caption: itemMetadata.caption,
      acceptanceCriteria: itemMetadata.acceptanceCriteria,
    };
  });
}

export function validateEvidenceProfile(
  profile,
  evidenceFiles,
  { gate = "test", verdict = "PASS" } = {},
) {
  if (!EVIDENCE_PROFILES.has(profile)) {
    throw new WorkflowValidationError(["evidence profile is invalid"]);
  }
  if (gate === "review" || verdict !== "PASS") {
    return;
  }
  const hasImage = evidenceFiles.some((file) =>
    new Set([".png", ".jpg", ".jpeg", ".webp"]).has(file.extension),
  );
  const hasDiagnostic = evidenceFiles.some((file) =>
    new Set([".log", ".txt"]).has(file.extension),
  );
  const errors = [];
  if (new Set(["frontend", "mixed"]).has(profile) && !hasImage) {
    errors.push(`${profile} passing evidence requires a screenshot`);
  }
  if (new Set(["backend", "mixed"]).has(profile) && !hasDiagnostic) {
    errors.push(
      `${profile} passing evidence requires a bounded log or text report`,
    );
  }
  if (errors.length > 0) {
    throw new WorkflowValidationError(errors);
  }
}

export function validateUniqueLogicalEvidenceFilenames(evidenceFiles) {
  const names = new Set();
  for (const file of evidenceFiles) {
    const name = path.basename(file.suppliedPath).toLowerCase();
    if (names.has(name)) {
      throw new WorkflowValidationError([
        `duplicate evidence filename: ${name}`,
      ]);
    }
    names.add(name);
  }
}

function bulletAcceptance(acceptance) {
  return acceptance
    .map((item) => `- **${item.status}** — ${item.criterion}: ${item.evidence}`)
    .join("\n");
}

// Both renderers receive the same already-validated technical result.
function buildPrComment(model, { gate, evidenceUrl }) {
  let verdict = model.verdict;
  let route;
  if (gate === "handoff") {
    verdict = `READY FOR HUMAN REVIEW${model.waivers?.length ? " WITH EXPLICIT CHECK WAIVERS" : ""}`;
    route = [
      `Reviewer: **${model.outcomes.review.status}** — ${model.outcomes.review.summary}`,
      `Tester: **${model.outcomes.test.status}** — ${model.outcomes.test.summary}`,
      `CI: **${model.outcomes.ci.status}** — ${model.outcomes.ci.summary}` +
        (model.outcomes.ci.runUrl
          ? ` — [GitHub Actions run](${model.outcomes.ci.runUrl})`
          : ""),
    ].join("\n\n");
  }
  const marker = buildPullRequestCommentMarker({
    issueKey: model.issueKey,
    pullRequestNumber: model.pullRequest.number,
    observedSha: model.observedSha,
    gate,
    waivers: model.waivers,
  });
  const findings = model.findings ?? model.failures ?? [];
  const body = [
    marker,
    "",
    `## ${model.issueKey}: ${verdict}`,
    "",
    `Observed commit: \`${model.observedSha}\``,
    "",
    model.summary,
    ...(route ? ["", route] : []),
    ...(gate === "handoff" && model.commands.length > 0
      ? [
          "",
          "### Validation commands",
          "",
          ...model.commands.map(
            (item) => `- **${item.status}** — ${item.command}: ${item.summary}`,
          ),
        ]
      : []),
    ...(model.waivers?.length
      ? [
          "",
          "### Explicit check waivers and confidence gaps",
          "",
          ...waiverSummaryLines(model).map((line) => `- ${line}`),
        ]
      : []),
    "",
    "### Acceptance",
    "",
    bulletAcceptance(model.acceptance),
    ...(findings.length > 0
      ? [
          "",
          `### ${model.findings ? "Findings" : "Failures"}`,
          "",
          ...findings.map(
            (item) => `- **${item.id}: ${item.title}** — ${item.evidence}`,
          ),
        ]
      : []),
    "",
    evidenceUrl
      ? `Full evidence and attachments: [Delivery evidence](${evidenceUrl})`
      : "Evidence is retained in local task artifacts; the acceptance and validation results are summarized above.",
  ].join("\n");
  return {
    status: "ready",
    marker,
    body,
    evidenceUrl: evidenceUrl ?? null,
    nativeUploads: [],
    browserRequired: false,
  };
}

export function prepareReport(args, repositoryRoot) {
  if (args.evidenceUrl !== undefined && !isHttpsUrl(args.evidenceUrl)) {
    throw new WorkflowValidationError([
      "--evidence-url must be a credential-free HTTPS URL",
    ]);
  }
  const raw = parseJsonDocument(
    readFileSync(path.resolve(repositoryRoot, args.resultPath), "utf8"),
  );
  const expected = {
    issueKey: args.issueKey,
    repository: REPOSITORY,
    pullRequestNumber: args.pullRequestNumber,
    headBranch: args.headBranch,
    baseBranch: BASE_BRANCH,
  };
  const model = args.gate === "handoff"
    ? validateReadyHandoff(raw, expected)
    : validateGateResult(
        args.gate === "review" ? "reviewer" : "tester", raw, expected,
      );
  const profile = args.gate === "handoff" ? model.evidenceProfile : args.profile;
  if (args.gate === "handoff" && args.profile !== undefined && args.profile !== profile) {
    throw new WorkflowValidationError(["handoff profile must match the gate selection"]);
  }
  const evidence = resolveEvidenceFiles({
    repositoryRoot,
    issueKey: model.issueKey,
    observedSha: model.observedSha,
    files: resultArtifactPaths(model),
    metadata: artifactMetadata(model),
  });
  validateUniqueLogicalEvidenceFilenames(evidence);
  if (args.gate === "handoff") {
    validateHandoffEvidence(model, evidence);
  } else {
    validateEvidenceProfile(profile, evidence, {
      gate: args.gate,
      verdict: model.verdict,
    });
  }
  const files = evidence.map((file, index) => {
    const sha256 = createHash("sha256")
      .update(readFileSync(file.absolutePath))
      .digest("hex");
    const safeBasename = path.basename(file.suppliedPath)
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .slice(-100);
    return {
      filename: `${model.issueKey}_${model.observedSha.slice(0, 12)}_${args.gate}_${index + 1}_${sha256.slice(0, 12)}_${safeBasename}`,
      caption: file.caption,
      acceptanceCriteria: file.acceptanceCriteria,
      extension: file.extension,
      sha256,
      size: file.size,
    };
  });
  const marker = args.gate === "handoff"
    ? buildGateSelectionMarker({
        issueKey: model.issueKey,
        pullRequestNumber: model.pullRequest.number,
        observedSha: model.observedSha,
        review: model.actual.review.decision,
        test: model.actual.test.decision,
        waivers: model.waivers,
      })
    : buildIdempotencyMarker({
        schemaVersion: model.schemaVersion,
        issueKey: model.issueKey,
        observedSha: model.observedSha,
        gate: args.gate,
      });
  return {
    status: args.dryRun ? "dry-run" : "prepared",
    marker,
    result: model.schemaVersion,
    observedSha: model.observedSha,
    commentBody: buildEvidenceComment({
      marker,
      result: model,
      profile,
      attachments: [],
      localArtifacts: files,
      gate: args.gate,
    }),
    files,
    publication: { performed: false, destination: null },
    prComment: buildPrComment(model, args),
  };
}
