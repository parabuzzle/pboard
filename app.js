const STORAGE_KEY = "pboard.notes.v1";

const appShell = document.querySelector(".app-shell");
const board = document.querySelector("#board");
const notesLayer = document.querySelector("#notesLayer");
const inspector = document.querySelector("#inspector");
const emptyState = document.querySelector("#emptyState");
const boardStatus = document.querySelector("#boardStatus");
const addButton = document.querySelector("#addButton");
const emptyAddButton = document.querySelector("#emptyAddButton");
const presentButton = document.querySelector("#presentButton");
const deleteButton = document.querySelector("#deleteButton");
const fontSelect = document.querySelector("#fontSelect");
const fontSizeSelect = document.querySelector("#fontSizeSelect");
const dateInput = document.querySelector("#dateInput");
const todayLabel = document.querySelector("#todayLabel");
const clock = document.querySelector("#clock");
const toast = document.querySelector("#toast");

const COLORS = ["butter", "coral", "sky", "mint", "lilac", "paper"];
const FONTS = ["sans", "rounded", "serif", "mono"];
const FONT_SIZES = [18, 24, 32, 42];

let notes = loadNotes();
let selectedId = null;
let highestZ = notes.reduce((max, note) => Math.max(max, note.z ?? 1), 1);
let interaction = null;
let saveTimer = null;
let toastTimer = null;

function uid() {
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function defaultNotes() {
  return [
    {
      id: uid(),
      text: "What’s the one thing that would make today feel well spent?",
      x: 0.075,
      y: 0.11,
      width: 330,
      height: 242,
      color: "butter",
      font: "serif",
      fontSize: 32,
      dueDate: "",
      z: 1,
    },
    {
      id: uid(),
      text: "CURRENT FOCUS\n\nShip the smallest useful version of the lab dashboard.",
      x: 0.39,
      y: 0.25,
      width: 360,
      height: 250,
      color: "mint",
      font: "sans",
      fontSize: 24,
      dueDate: todayISO(2),
      z: 2,
    },
    {
      id: uid(),
      text: "Ask the team:\nWhat keeps getting in the way?",
      x: 0.73,
      y: 0.12,
      width: 270,
      height: 205,
      color: "sky",
      font: "rounded",
      fontSize: 24,
      dueDate: "",
      z: 3,
    },
    {
      id: uid(),
      text: "Upcoming\n\n• Demo prep\n• Replace camera cable\n• Friday retro",
      x: 0.69,
      y: 0.55,
      width: 300,
      height: 235,
      color: "coral",
      font: "mono",
      fontSize: 18,
      dueDate: todayISO(5),
      z: 4,
    },
  ];
}

function todayISO(offsetDays = 0) {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function sanitizeNote(note, index) {
  return {
    id: typeof note.id === "string" ? note.id : uid(),
    text: typeof note.text === "string" ? note.text : "",
    x: clamp(Number(note.x) || 0.1, 0, 0.98),
    y: clamp(Number(note.y) || 0.1, 0, 0.98),
    width: clamp(Number(note.width) || 280, 190, 680),
    height: clamp(Number(note.height) || 220, 145, 680),
    color: COLORS.includes(note.color) ? note.color : "butter",
    font: FONTS.includes(note.font) ? note.font : "sans",
    fontSize: FONT_SIZES.includes(Number(note.fontSize)) ? Number(note.fontSize) : 24,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(note.dueDate ?? "") ? note.dueDate : "",
    z: Number(note.z) || index + 1,
  };
}

function loadNotes() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved)) return saved.map(sanitizeNote);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return defaultNotes();
}

function saveNotes() {
  boardStatus.classList.add("is-saving");
  boardStatus.querySelector("span:last-child").textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    boardStatus.classList.remove("is-saving");
    boardStatus.querySelector("span:last-child").textContent = "Saved on this display";
  }, 180);
}

function render() {
  const existing = new Map([...notesLayer.children].map((element) => [element.dataset.id, element]));

  for (const note of notes) {
    let element = existing.get(note.id);
    if (!element) {
      element = createNoteElement(note);
      notesLayer.append(element);
    }
    updateNoteElement(element, note);
    existing.delete(note.id);
  }

  for (const orphan of existing.values()) orphan.remove();
  emptyState.hidden = notes.length > 0;
  updateInspector();
}

function createNoteElement(note) {
  const element = document.createElement("article");
  element.className = "note";
  element.dataset.id = note.id;
  element.setAttribute("aria-label", "Board note");
  element.innerHTML = `
    <div class="note-top" title="Drag to move">
      <span class="note-date" hidden></span>
      <span class="drag-dots" aria-hidden="true">
        <i></i><i></i><i></i><i></i><i></i><i></i>
      </span>
    </div>
    <textarea class="note-text" aria-label="Note text" placeholder="Write something…" spellcheck="true"></textarea>
    <div class="resize-handle" role="presentation" title="Drag to resize"></div>
  `;

  const textarea = element.querySelector(".note-text");
  textarea.value = note.text;
  textarea.addEventListener("input", () => {
    const current = findNote(note.id);
    if (!current) return;
    current.text = textarea.value;
    saveNotes();
  });
  textarea.addEventListener("focus", () => selectNote(note.id, false));

  element.addEventListener("pointerdown", onNotePointerDown);
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    selectNote(note.id);
  });
  return element;
}

function updateNoteElement(element, note) {
  const bounds = boardBounds();
  const maxX = Math.max(0, bounds.width - note.width - 8);
  const maxY = Math.max(0, bounds.height - note.height - 8);
  const left = clamp(note.x * bounds.width, 8, maxX);
  const top = clamp(note.y * bounds.height, 8, maxY);

  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
  element.style.width = `${Math.min(note.width, bounds.width - 16)}px`;
  element.style.height = `${Math.min(note.height, bounds.height - 16)}px`;
  element.style.zIndex = note.z;
  element.dataset.color = note.color;
  element.dataset.font = note.font;
  element.classList.toggle("is-selected", note.id === selectedId);

  const textarea = element.querySelector(".note-text");
  if (textarea !== document.activeElement && textarea.value !== note.text) textarea.value = note.text;
  textarea.style.fontSize = `${note.fontSize}px`;

  const dateBadge = element.querySelector(".note-date");
  dateBadge.hidden = !note.dueDate;
  if (note.dueDate) {
    const dateInfo = describeDate(note.dueDate);
    dateBadge.textContent = dateInfo.label;
    dateBadge.classList.toggle("is-soon", dateInfo.isSoon);
  }
}

function boardBounds() {
  return board.getBoundingClientRect();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function findNote(id) {
  return notes.find((note) => note.id === id);
}

function selectNote(id, raise = true) {
  const note = findNote(id);
  if (!note) return;
  selectedId = id;
  if (raise) note.z = ++highestZ;
  render();
  if (raise) saveNotes();
}

function deselectNote() {
  selectedId = null;
  render();
}

function addNote() {
  const bounds = boardBounds();
  const width = Math.min(300, bounds.width - 32);
  const height = Math.min(220, bounds.height - 32);
  const stagger = (notes.length % 5) * 18;
  const note = {
    id: uid(),
    text: "",
    x: clamp((bounds.width - width) / 2 + stagger, 12, bounds.width - width - 12) / bounds.width,
    y: clamp((bounds.height - height) / 2 + stagger / 2, 12, bounds.height - height - 12) / bounds.height,
    width,
    height,
    color: COLORS[notes.length % COLORS.length],
    font: "sans",
    fontSize: 24,
    dueDate: "",
    z: ++highestZ,
  };
  notes.push(note);
  selectedId = note.id;
  render();
  saveNotes();
  requestAnimationFrame(() => notesLayer.querySelector(`[data-id="${note.id}"] .note-text`)?.focus());
}

function deleteSelected() {
  if (!selectedId) return;
  const element = notesLayer.querySelector(`[data-id="${selectedId}"]`);
  if (element) {
    element.style.opacity = "0";
    element.style.transform = "scale(0.94)";
  }
  notes = notes.filter((note) => note.id !== selectedId);
  selectedId = null;
  saveNotes();
  setTimeout(render, 140);
  showToast("Note deleted");
}

function onNotePointerDown(event) {
  if (event.button !== 0) return;
  const element = event.currentTarget;
  const note = findNote(element.dataset.id);
  if (!note) return;

  if (event.target.closest(".note-text")) return;
  const mode = event.target.closest(".resize-handle") ? "resize" : "drag";
  selectNote(note.id);

  const bounds = boardBounds();
  const rect = element.getBoundingClientRect();
  interaction = {
    mode,
    pointerId: event.pointerId,
    id: note.id,
    startX: event.clientX,
    startY: event.clientY,
    initialLeft: rect.left - bounds.left,
    initialTop: rect.top - bounds.top,
    initialWidth: rect.width,
    initialHeight: rect.height,
  };
  element.classList.add(mode === "drag" ? "is-dragging" : "is-resizing");
  element.setPointerCapture(event.pointerId);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerEnd);
  element.addEventListener("pointercancel", onPointerEnd);
  event.preventDefault();
}

function onPointerMove(event) {
  if (!interaction || event.pointerId !== interaction.pointerId) return;
  const note = findNote(interaction.id);
  if (!note) return;
  const bounds = boardBounds();
  const dx = event.clientX - interaction.startX;
  const dy = event.clientY - interaction.startY;

  if (interaction.mode === "drag") {
    const left = clamp(interaction.initialLeft + dx, 8, bounds.width - note.width - 8);
    const top = clamp(interaction.initialTop + dy, 8, bounds.height - note.height - 8);
    note.x = left / bounds.width;
    note.y = top / bounds.height;
  } else {
    note.width = clamp(interaction.initialWidth + dx, 190, Math.min(680, bounds.width - interaction.initialLeft - 8));
    note.height = clamp(interaction.initialHeight + dy, 145, Math.min(680, bounds.height - interaction.initialTop - 8));
  }
  updateNoteElement(event.currentTarget, note);
}

function onPointerEnd(event) {
  if (!interaction || event.pointerId !== interaction.pointerId) return;
  event.currentTarget.classList.remove("is-dragging", "is-resizing");
  event.currentTarget.removeEventListener("pointermove", onPointerMove);
  event.currentTarget.removeEventListener("pointerup", onPointerEnd);
  event.currentTarget.removeEventListener("pointercancel", onPointerEnd);
  interaction = null;
  saveNotes();
}

function updateInspector() {
  const note = findNote(selectedId);
  const visible = Boolean(note) && !appShell.classList.contains("is-presenting");
  inspector.classList.toggle("is-visible", visible);
  inspector.setAttribute("aria-hidden", String(!visible));
  if (!note) return;

  inspector.querySelectorAll(".swatch").forEach((swatch) => {
    swatch.classList.toggle("is-selected", swatch.dataset.color === note.color);
  });
  fontSelect.value = note.font;
  fontSizeSelect.value = String(note.fontSize);
  dateInput.value = note.dueDate;
  dateInput.closest(".date-control").classList.toggle("has-date", Boolean(note.dueDate));
}

function changeSelected(changes) {
  const note = findNote(selectedId);
  if (!note) return;
  Object.assign(note, changes);
  render();
  saveNotes();
}

function describeDate(isoDate) {
  const target = new Date(`${isoDate}T12:00:00`);
  const today = new Date(`${todayISO()}T12:00:00`);
  const days = Math.round((target - today) / 86400000);
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, isSoon: true };
  if (days === 0) return { label: "Today", isSoon: true };
  if (days === 1) return { label: "Tomorrow", isSoon: true };
  if (days <= 7) return { label: target.toLocaleDateString(undefined, { weekday: "short" }), isSoon: true };
  return { label: target.toLocaleDateString(undefined, { month: "short", day: "numeric" }), isSoon: false };
}

function updateTime() {
  const now = new Date();
  todayLabel.textContent = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  clock.textContent = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function togglePresent() {
  appShell.classList.toggle("is-presenting");
  if (appShell.classList.contains("is-presenting")) selectedId = null;
  render();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 1600);
}

addButton.addEventListener("click", addNote);
emptyAddButton.addEventListener("click", addNote);
presentButton.addEventListener("click", togglePresent);
deleteButton.addEventListener("click", deleteSelected);
board.addEventListener("pointerdown", (event) => {
  if (event.target === board || event.target.classList.contains("board-grain") || event.target === notesLayer) {
    deselectNote();
  }
});

inspector.querySelectorAll(".swatch").forEach((swatch) => {
  swatch.addEventListener("click", () => changeSelected({ color: swatch.dataset.color }));
});
fontSelect.addEventListener("change", () => changeSelected({ font: fontSelect.value }));
fontSizeSelect.addEventListener("change", () => changeSelected({ fontSize: Number(fontSizeSelect.value) }));
dateInput.addEventListener("change", () => changeSelected({ dueDate: dateInput.value }));

window.addEventListener("keydown", (event) => {
  const editing = event.target.matches("textarea, input, select");
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    addNote();
  } else if (!editing && (event.key === "Delete" || event.key === "Backspace")) {
    deleteSelected();
  } else if (!editing && event.key.toLowerCase() === "p") {
    togglePresent();
  } else if (event.key === "Escape") {
    if (appShell.classList.contains("is-presenting")) togglePresent();
    else deselectNote();
  }
});

window.addEventListener("resize", render);
window.addEventListener("beforeunload", () => localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)));

updateTime();
setInterval(updateTime, 15000);
render();
