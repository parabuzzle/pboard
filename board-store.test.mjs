import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BoardStoreError, createBoardStore, sanitizeBoardState } from "./board-store.mjs";

test("sanitizeBoardState rejects non-objects", () => {
  assert.throws(() => sanitizeBoardState(null), BoardStoreError);
  assert.throws(() => sanitizeBoardState([]), BoardStoreError);
  assert.throws(() => sanitizeBoardState("notes"), BoardStoreError);
});

test("sanitizeBoardState clamps values and drops malformed entries", () => {
  const state = sanitizeBoardState({
    notes: [
      { id: "note-a", text: "hello", x: 99, y: -3, width: 9999, height: 1, color: "neon", font: "comic", fontSize: 13, dueDate: "someday", z: "7" },
      "junk",
      null,
    ],
    linearLayouts: {
      "issue-1": { x: 0.5, y: 0.5, width: 260, height: 200, color: "mint", font: "mono", fontSize: 18, hidden: 1, z: 3 },
      "": { x: 0.2 },
      "issue-2": "junk",
    },
    linearSettings: { teamId: 42, projectId: "proj", days: 12, limit: 9, filterMode: "everything", cardsVisible: false },
  });

  assert.equal(state.notes.length, 1);
  assert.deepEqual(state.notes[0], {
    id: "note-a",
    text: "hello",
    x: 0.98,
    y: 0,
    width: 680,
    height: 145,
    color: "butter",
    font: "sans",
    fontSize: 24,
    dueDate: "",
    z: 7,
  });
  assert.deepEqual(Object.keys(state.linearLayouts), ["issue-1"]);
  assert.equal(state.linearLayouts["issue-1"].hidden, true);
  assert.deepEqual(state.linearSettings, {
    teamId: "",
    projectId: "proj",
    days: 14,
    limit: 12,
    filterMode: "focused",
    cardsVisible: false,
  });
});

test("store persists revisions across restarts and notifies subscribers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pboard-"));
  const file = join(directory, "board.json");
  try {
    const store = createBoardStore({ file });
    assert.deepEqual(store.get(), { rev: 0, state: null });

    const events = [];
    const unsubscribe = store.subscribe((update) => events.push(update));
    const first = store.replace({ notes: [{ id: "a", text: "hi" }] }, "client-1");
    assert.equal(first.rev, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].source, "client-1");
    assert.equal(events[0].state.notes[0].text, "hi");

    unsubscribe();
    store.replace({ notes: [{ id: "a", text: "updated" }] }, "client-2");
    assert.equal(events.length, 1);

    await store.flush();
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.equal(saved.rev, 2);
    assert.equal(saved.state.notes[0].text, "updated");

    const restarted = createBoardStore({ file });
    assert.equal(restarted.get().rev, 2);
    assert.equal(restarted.get().state.notes[0].text, "updated");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("store survives a corrupt data file and rejects invalid replacements", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pboard-"));
  const file = join(directory, "board.json");
  try {
    const quiet = { warn: () => {} };
    await writeFile(file, "{not json", "utf8");
    const store = createBoardStore({ file, logger: quiet });
    assert.deepEqual(store.get(), { rev: 0, state: null });

    assert.throws(() => store.replace(null, "client-1"), BoardStoreError);
    assert.throws(() => store.replace([], "client-1"), BoardStoreError);

    const update = store.replace({ notes: [] }, "client-1");
    assert.equal(update.rev, 1);
    await store.flush();
    assert.equal(JSON.parse(await readFile(file, "utf8")).rev, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
