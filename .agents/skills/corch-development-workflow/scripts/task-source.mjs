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

export function describeSource(value) {
  return value ?? "current conversation (no external ticket)";
}
