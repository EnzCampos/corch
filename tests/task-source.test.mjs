import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fixture, workItem, delivery } from "./helpers.mjs";

test("one task record supports conversation, document, chat and tracker sources with optimistic revisions", () => fixture(({ root, state, invoke }) => {
  let revision = 0;
  for (const sourceRef of [null, "docs/change.md", "codex://threads/source-chat", "https://github.com/example/project/issues/7", "https://tracker.example.test/issue/7"]) {
    const input = workItem({ sourceRef, userDecisions: ["Use the revised acceptance"] });
    state("record-context", ["--expected-revision", String(revision)], { input });
    assert.equal(state("record-context", ["--expected-revision", String(revision)], { input }).status, "already-recorded");
    revision++;
    assert.equal(state("show").workItem.revision, revision);
    assert.equal(state("show").workItem.sourceRef, sourceRef);
    assert.deepEqual(state("show").workItem.userDecisions, input.userDecisions);
  }
  const before = readFileSync(path.join(root, ".agents/task-state/TASK-42.json"), "utf8");
  const stale = invoke(["record-context", "--issue", "TASK-42", "--expected-revision", "1"], { input: workItem() });
  assert.equal(stale.status, 1); assert.match(stale.stderr, /stale workItem revision/);
  assert.equal(readFileSync(path.join(root, ".agents/task-state/TASK-42.json"), "utf8"), before);
}));

test("context input rejects unsafe references and malformed acceptance without storing them", () => fixture(({ state, invoke }) => {
  for (const sourceRef of ["https://user:password@example.test/item", "javascript:alert(1)", "../outside.md", "C:/outside.md", "https://example.test/a\nother"]) {
    assert.equal(invoke(["record-context", "--issue", "TASK-42", "--expected-revision", "0"], { input: workItem({ sourceRef }) }).status, 1, sourceRef);
  }
  for (const acceptance of [[], [{ id: "AC-1", text: "" }], [{ id: "AC-1", text: "one" }, { id: "AC-1", text: "two" }]]) {
    assert.equal(invoke(["record-context", "--issue", "TASK-42", "--expected-revision", "0"], { input: workItem({ acceptance }) }).status, 1);
  }
  const unsafe = invoke(["record-context", "--issue", "TASK-42", "--expected-revision", "0"], { input: workItem({ outcome: "token=" + "z".repeat(30) }) });
  assert.equal(unsafe.status, 1); assert.doesNotMatch(unsafe.stderr, /z{30}/);
  assert.equal(state("show").workItem, undefined);
}));

test("dependency facts are stored without executing a preflight or inventing source authority", () => fixture(({ state }) => {
  const dependencies = [
    { key: "TASK-41", kind: "hard", requiredMilestone: "merged", verified: false, evidence: "Relationship still needs verification" },
    { key: "TASK-43", kind: "coordination", boundary: "Separate package ownership" },
  ];
  state("record-context", ["--expected-revision", "0"], { input: workItem({ dependencies, sourceRef: "https://tracker.example.test/item/42" }) });
  assert.deepEqual(state("show").workItem.dependencies, dependencies);
  state("record-delivery", ["--expected-revision", "0"], { input: delivery() });
  assert.deepEqual(state("show").delivery.allowedOperations, []);
  assert.equal(state("show").delivery.evidenceDestination, null);
}));

test("external scrum identity stays distinct from request provenance and internal execution identity", () => fixture(({ state, invoke }) => {
  const scrum = { provider: "jira", key: "PROJ-107", url: "https://tracker.example.test/browse/PROJ-107" };
  const original = workItem({ sourceRef: "docs/request.md", scrum });
  state("record-context", ["--expected-revision", "0"], { input: original });
  assert.equal(state("record-context", ["--expected-revision", "0"], { input: original }).status, "already-recorded");
  state("record-delivery", ["--expected-revision", "0"], { input: delivery() });
  const revised = { ...original, userDecisions: ["Keep the newer approved scope"] };
  state("record-context", ["--expected-revision", "1"], { input: revised });
  const current = state("show");
  assert.deepEqual(current.workItem.scrum, scrum);
  assert.equal(current.workItem.sourceRef, "docs/request.md");
  assert.equal(current.workItem.revision, 2);
  assert.equal(current.delivery.headBranch, "corch/task-42-fixture");
  assert.deepEqual(current.delivery.allowedOperations, []);
  assert.equal(current.delivery.evidenceDestination, null);
  const stale = invoke(["record-context", "--issue", "TASK-42", "--expected-revision", "1"], {
    input: { ...revised, scrum: { ...scrum, key: "PROJ-108", url: "https://tracker.example.test/browse/PROJ-108" } },
  });
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /stale workItem revision/);
  assert.deepEqual(state("show"), current);
}));

test("invalid provider bindings cannot replace an existing external item", () => fixture(({ state, invoke }) => {
  const scrum = { provider: "linear", key: "ENG-17", url: "https://linear.app/example/issue/ENG-17" };
  state("record-context", ["--expected-revision", "0"], { input: workItem({ scrum }) });
  const before = state("show");
  for (const invalid of ["jira", {}, { ...scrum, provider: "bad provider" }, { ...scrum, key: "" },
    { ...scrum, key: "ENG-17\nENG-18" }, { ...scrum, url: "https://user:pass@tracker.example.test/17" },
    { ...scrum, url: "docs/item.md" }, { ...scrum, token: "unexpected" }]) {
    const result = invoke(["record-context", "--issue", "TASK-42", "--expected-revision", "1"], { input: workItem({ scrum: invalid }) });
    assert.equal(result.status, 1);
    assert.deepEqual(state("show"), before);
  }
}));
