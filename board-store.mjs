import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const COLORS = ["butter", "coral", "sky", "mint", "lilac", "paper"];
const FONTS = ["sans", "rounded", "serif", "mono"];
const FONT_SIZES = [18, 24, 32, 42];
const MAX_NOTES = 300;
const MAX_NOTE_TEXT = 10000;
const MAX_LINEAR_LAYOUTS = 500;
const MAX_ID_LENGTH = 100;

export class BoardStoreError extends Error {
  constructor(message, { status = 400, code = "INVALID_BOARD_STATE" } = {}) {
    super(message);
    this.name = "BoardStoreError";
    this.status = status;
    this.code = code;
  }
}

export function sanitizeBoardState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BoardStoreError("Board state must be an object with notes, layouts, and settings.");
  }

  const notes = (Array.isArray(raw.notes) ? raw.notes : [])
    .slice(0, MAX_NOTES)
    .filter((note) => note && typeof note === "object")
    .map(sanitizeNote);

  const linearLayouts = {};
  if (raw.linearLayouts && typeof raw.linearLayouts === "object" && !Array.isArray(raw.linearLayouts)) {
    for (const [issueId, layout] of Object.entries(raw.linearLayouts).slice(0, MAX_LINEAR_LAYOUTS)) {
      if (!issueId || issueId.length > MAX_ID_LENGTH || !layout || typeof layout !== "object") continue;
      linearLayouts[issueId] = sanitizeLinearLayout(layout);
    }
  }

  return { notes, linearLayouts, linearSettings: sanitizeLinearSettings(raw.linearSettings ?? {}) };
}

export function createBoardStore({ file, logger = console }) {
  mkdirSync(dirname(file), { recursive: true });

  let rev = 0;
  let state = null;
  const listeners = new Set();
  let writeTask = null;
  let writeAgain = false;

  try {
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, "utf8"));
      state = saved.state ? sanitizeBoardState(saved.state) : null;
      rev = Number.isInteger(saved.rev) && saved.rev > 0 ? saved.rev : state ? 1 : 0;
    }
  } catch (error) {
    logger.warn(`Could not read the board data file (${file}): ${error.message}`);
  }

  function persist() {
    if (writeTask) {
      writeAgain = true;
      return writeTask;
    }
    writeTask = (async () => {
      do {
        writeAgain = false;
        const temporary = `${file}.tmp`;
        await writeFile(temporary, `${JSON.stringify({ rev, state }, null, 2)}\n`, "utf8");
        await rename(temporary, file);
      } while (writeAgain);
    })()
      .catch((error) => logger.warn(`Could not write the board data file (${file}): ${error.message}`))
      .finally(() => {
        writeTask = null;
      });
    return writeTask;
  }

  return {
    get() {
      return { rev, state };
    },

    replace(rawState, source = null) {
      state = sanitizeBoardState(rawState);
      rev += 1;
      persist();
      const update = {
        rev,
        state,
        source: typeof source === "string" ? source.slice(0, MAX_ID_LENGTH) : null,
      };
      for (const listener of listeners) {
        try {
          listener(update);
        } catch (error) {
          logger.warn(`A board update listener failed: ${error.message}`);
        }
      }
      return update;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    flush() {
      return writeTask ?? Promise.resolve();
    },
  };
}

function sanitizeNote(note, index) {
  return {
    id: typeof note.id === "string" && note.id ? note.id.slice(0, MAX_ID_LENGTH) : `note-${index + 1}`,
    text: typeof note.text === "string" ? note.text.slice(0, MAX_NOTE_TEXT) : "",
    x: clamp(finiteNumber(note.x, 0.1), 0, 0.98),
    y: clamp(finiteNumber(note.y, 0.1), 0, 0.98),
    width: clamp(finiteNumber(note.width, 280), 190, 680),
    height: clamp(finiteNumber(note.height, 220), 145, 680),
    color: COLORS.includes(note.color) ? note.color : "butter",
    font: FONTS.includes(note.font) ? note.font : "sans",
    fontSize: FONT_SIZES.includes(Number(note.fontSize)) ? Number(note.fontSize) : 24,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(note.dueDate ?? "") ? note.dueDate : "",
    z: clamp(Math.round(finiteNumber(note.z, index + 1)), 1, 1000000),
  };
}

function sanitizeLinearLayout(layout) {
  return {
    x: clamp(finiteNumber(layout.x, 0.1), 0, 0.98),
    y: clamp(finiteNumber(layout.y, 0.1), 0, 0.98),
    width: clamp(finiteNumber(layout.width, 300), 245, 680),
    height: clamp(finiteNumber(layout.height, 190), 165, 680),
    color: COLORS.includes(layout.color) ? layout.color : "paper",
    font: FONTS.includes(layout.font) ? layout.font : "sans",
    fontSize: FONT_SIZES.includes(Number(layout.fontSize)) ? Number(layout.fontSize) : 24,
    hidden: Boolean(layout.hidden),
    z: clamp(Math.round(finiteNumber(layout.z, 1)), 1, 1000000),
  };
}

function sanitizeLinearSettings(settings) {
  const saved = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
  return {
    teamId: typeof saved.teamId === "string" ? saved.teamId.slice(0, MAX_ID_LENGTH) : "",
    projectId: typeof saved.projectId === "string" ? saved.projectId.slice(0, MAX_ID_LENGTH) : "",
    days: [7, 14, 30].includes(Number(saved.days)) ? Number(saved.days) : 14,
    limit: [8, 12, 16, 24].includes(Number(saved.limit)) ? Number(saved.limit) : 12,
    filterMode: ["focused", "due-only"].includes(saved.filterMode) ? saved.filterMode : "focused",
    cardsVisible: saved.cardsVisible !== false,
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
