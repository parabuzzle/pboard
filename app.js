const NOTES_STORAGE_KEY = "pboard.notes.v1";
const LINEAR_SETTINGS_KEY = "pboard.linear.settings.v1";
const LINEAR_LAYOUTS_KEY = "pboard.linear.layouts.v1";
const LINEAR_CACHE_KEY = "pboard.linear.cache.v1";

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

const linearButton = document.querySelector("#linearButton");
const linearVisibilityButton = document.querySelector("#linearVisibilityButton");
const linearDialog = document.querySelector("#linearDialog");
const linearCloseButton = document.querySelector("#linearCloseButton");
const linearSetupState = document.querySelector("#linearSetupState");
const linearSetupTitle = document.querySelector("#linearSetupTitle");
const linearSetupMessage = document.querySelector("#linearSetupMessage");
const linearSetupCommand = document.querySelector("#linearSetupCommand");
const linearRetryButton = document.querySelector("#linearRetryButton");
const linearSettingsForm = document.querySelector("#linearSettingsForm");
const linearTeamSelect = document.querySelector("#linearTeamSelect");
const linearProjectSelect = document.querySelector("#linearProjectSelect");
const linearDaysSelect = document.querySelector("#linearDaysSelect");
const linearFilterSelect = document.querySelector("#linearFilterSelect");
const linearLimitSelect = document.querySelector("#linearLimitSelect");
const linearFeedRuleText = document.querySelector("#linearFeedRuleText");
const linearLastSync = document.querySelector("#linearLastSync");
const linearHiddenCount = document.querySelector("#linearHiddenCount");
const linearRestoreButton = document.querySelector("#linearRestoreButton");
const linearSyncButton = document.querySelector("#linearSyncButton");

const COLORS = ["butter", "coral", "sky", "mint", "lilac", "paper"];
const FONTS = ["sans", "rounded", "serif", "mono"];
const FONT_SIZES = [18, 24, 32, 42];

let notes = loadNotes();
let linearSettings = loadLinearSettings();
let linearLayouts = loadObject(LINEAR_LAYOUTS_KEY);
const cachedLinear = loadObject(LINEAR_CACHE_KEY);
let linearIssues = Array.isArray(cachedLinear.issues) ? cachedLinear.issues.map(sanitizeLinearIssue) : [];
let linearSyncedAt = typeof cachedLinear.syncedAt === "string" ? cachedLinear.syncedAt : "";
let linearOptions = null;
let linearConfigured = false;
let linearSyncPromise = null;
let selectedId = null;
let highestZ = [
  ...notes.map((note) => note.z ?? 1),
  ...Object.values(linearLayouts).map((layout) => layout.z ?? 1),
].reduce((max, z) => Math.max(max, z), 1);
let interaction = null;
let saveTimer = null;
let toastTimer = null;

function uid() {
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function linearElementId(issueId) {
  return `linear:${issueId}`;
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
    x: clamp(finiteNumber(note.x, 0.1), 0, 0.98),
    y: clamp(finiteNumber(note.y, 0.1), 0, 0.98),
    width: clamp(finiteNumber(note.width, 280), 190, 680),
    height: clamp(finiteNumber(note.height, 220), 145, 680),
    color: COLORS.includes(note.color) ? note.color : "butter",
    font: FONTS.includes(note.font) ? note.font : "sans",
    fontSize: FONT_SIZES.includes(Number(note.fontSize)) ? Number(note.fontSize) : 24,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(note.dueDate ?? "") ? note.dueDate : "",
    z: Number(note.z) || index + 1,
  };
}

function sanitizeLinearIssue(issue) {
  return {
    id: String(issue.id ?? ""),
    identifier: String(issue.identifier ?? ""),
    title: String(issue.title ?? "Untitled Linear issue"),
    priority: Number(issue.priority) || 0,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(issue.dueDate ?? "") ? issue.dueDate : "",
    url: typeof issue.url === "string" && issue.url.startsWith("https://") ? issue.url : "",
    updatedAt: issue.updatedAt ?? "",
    assignee: issue.assignee?.name ? { id: issue.assignee.id ?? "", name: String(issue.assignee.name) } : null,
    state: issue.state?.name
      ? { id: issue.state.id ?? "", name: String(issue.state.name), type: issue.state.type ?? "", color: issue.state.color ?? "#777" }
      : null,
    team: issue.team?.name
      ? { id: issue.team.id ?? "", name: String(issue.team.name), key: issue.team.key ?? "" }
      : null,
    project: issue.project?.name ? { id: issue.project.id ?? "", name: String(issue.project.name) } : null,
  };
}

function sanitizeLinearLayout(layout = {}) {
  return {
    x: clamp(finiteNumber(layout.x, 0.1), 0, 0.98),
    y: clamp(finiteNumber(layout.y, 0.1), 0, 0.98),
    width: clamp(finiteNumber(layout.width, 300), 245, 680),
    height: clamp(finiteNumber(layout.height, 190), 165, 680),
    color: COLORS.includes(layout.color) ? layout.color : "paper",
    font: FONTS.includes(layout.font) ? layout.font : "sans",
    fontSize: FONT_SIZES.includes(Number(layout.fontSize)) ? Number(layout.fontSize) : 24,
    hidden: Boolean(layout.hidden),
    z: Number(layout.z) || ++highestZ,
  };
}

function loadNotes() {
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    if (raw === null) return defaultNotes();
    const saved = JSON.parse(raw);
    if (Array.isArray(saved)) return saved.map(sanitizeNote);
  } catch {
    localStorage.removeItem(NOTES_STORAGE_KEY);
  }
  return defaultNotes();
}

function loadObject(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    localStorage.removeItem(key);
    return {};
  }
}

function loadLinearSettings() {
  const saved = loadObject(LINEAR_SETTINGS_KEY);
  return {
    teamId: typeof saved.teamId === "string" ? saved.teamId : "",
    projectId: typeof saved.projectId === "string" ? saved.projectId : "",
    days: [7, 14, 30].includes(Number(saved.days)) ? Number(saved.days) : 14,
    limit: [8, 12, 16, 24].includes(Number(saved.limit)) ? Number(saved.limit) : 12,
    filterMode: ["focused", "due-only"].includes(saved.filterMode) ? saved.filterMode : "focused",
    cardsVisible: saved.cardsVisible !== false,
  };
}

function writeBoardState() {
  localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
  localStorage.setItem(LINEAR_LAYOUTS_KEY, JSON.stringify(linearLayouts));
  localStorage.setItem(LINEAR_SETTINGS_KEY, JSON.stringify(linearSettings));
}

function saveBoardState() {
  boardStatus.classList.add("is-saving");
  boardStatus.querySelector("span:last-child").textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    writeBoardState();
    boardStatus.classList.remove("is-saving");
    boardStatus.querySelector("span:last-child").textContent = "Saved on this display";
  }, 180);
}

function render() {
  const existing = new Map([...notesLayer.children].map((element) => [element.dataset.id, element]));
  let visibleCount = 0;
  let createdLayout = false;

  for (const note of notes) {
    let element = existing.get(note.id);
    if (!element) {
      element = createNoteElement(note);
      notesLayer.append(element);
    }
    updateNoteElement(element, note);
    existing.delete(note.id);
    visibleCount += 1;
  }

  if (linearSettings.cardsVisible) linearIssues.forEach((issue, index) => {
    if (!issue.id) return;
    if (!linearLayouts[issue.id]) {
      linearLayouts[issue.id] = createLinearLayout(issue, index);
      createdLayout = true;
    } else {
      linearLayouts[issue.id] = sanitizeLinearLayout(linearLayouts[issue.id]);
    }
    const layout = linearLayouts[issue.id];
    const elementId = linearElementId(issue.id);
    if (layout.hidden) {
      existing.get(elementId)?.remove();
      existing.delete(elementId);
      return;
    }

    let element = existing.get(elementId);
    if (!element) {
      element = createLinearElement(issue);
      notesLayer.append(element);
    }
    updateLinearElement(element, issue, layout);
    existing.delete(elementId);
    visibleCount += 1;
  });

  for (const orphan of existing.values()) orphan.remove();
  emptyState.hidden = visibleCount > 0;
  updateInspector();
  updateLinearSettingsUI();
  if (createdLayout) saveBoardState();
}

function createNoteElement(note) {
  const element = document.createElement("article");
  element.className = "note";
  element.dataset.id = note.id;
  element.dataset.kind = "note";
  element.setAttribute("aria-label", "Board note");
  element.innerHTML = `
    <div class="note-top" title="Drag to move">
      <span class="note-date" hidden></span>
      ${dragDotsHTML()}
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
    saveBoardState();
  });
  textarea.addEventListener("focus", () => selectItem(note.id, false));
  bindCardInteractions(element);
  return element;
}

function createLinearElement(issue) {
  const element = document.createElement("article");
  element.className = "note linear-note";
  element.dataset.id = linearElementId(issue.id);
  element.dataset.kind = "linear";
  element.dataset.issueId = issue.id;
  element.setAttribute("aria-label", `Linear issue ${issue.identifier}`);
  element.innerHTML = `
    <div class="note-top" title="Drag to move">
      <span class="linear-identity">
        <svg class="linear-mini-logo" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.3 5.3a9.5 9.5 0 0 1 13.4 13.4M3.7 8.3l12 12M3 12l9 9M4 16l4 4" /></svg>
        <span class="linear-identifier"></span>
        <span class="linear-priority"></span>
      </span>
      ${dragDotsHTML()}
    </div>
    <div class="linear-card-content">
      <p class="linear-project-name" hidden></p>
      <h2 class="linear-title"></h2>
      <footer class="linear-card-footer">
        <span class="linear-assignee" hidden><span class="assignee-avatar"></span><span class="assignee-name"></span></span>
        <span class="linear-state" hidden><i class="state-dot"></i><span></span></span>
        <span class="linear-due" hidden></span>
        <a class="linear-open" target="_blank" rel="noreferrer" title="Open in Linear" aria-label="Open issue in Linear">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M11 13l8-8M19 13v6H5V5h6" /></svg>
        </a>
      </footer>
    </div>
    <div class="resize-handle" role="presentation" title="Drag to resize"></div>
  `;
  element.querySelector(".linear-open").addEventListener("click", (event) => event.stopPropagation());
  bindCardInteractions(element);
  return element;
}

function dragDotsHTML() {
  return `<span class="drag-dots" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>`;
}

function bindCardInteractions(element) {
  element.addEventListener("pointerdown", onNotePointerDown);
  element.addEventListener("click", (event) => {
    if (event.target.closest("a, button")) return;
    event.stopPropagation();
    selectItem(element.dataset.id);
  });
}

function updateNoteElement(element, note) {
  applyCardLayout(element, note);
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

function updateLinearElement(element, issue, layout) {
  applyCardLayout(element, layout);
  element.querySelector(".linear-identifier").textContent = issue.identifier;
  element.querySelector(".linear-priority").textContent = priorityLabel(issue.priority);

  const project = element.querySelector(".linear-project-name");
  project.hidden = !issue.project?.name;
  project.textContent = issue.project?.name ?? "";

  const title = element.querySelector(".linear-title");
  title.textContent = issue.title;
  title.style.fontSize = `${layout.fontSize}px`;

  const assignee = element.querySelector(".linear-assignee");
  assignee.hidden = !issue.assignee?.name;
  if (issue.assignee?.name) {
    assignee.querySelector(".assignee-avatar").textContent = initials(issue.assignee.name);
    assignee.querySelector(".assignee-name").textContent = issue.assignee.name;
  }

  const state = element.querySelector(".linear-state");
  state.hidden = !issue.state?.name;
  if (issue.state?.name) {
    state.style.setProperty("--state-color", safeColor(issue.state.color));
    state.querySelector("span").textContent = issue.state.name;
  }

  const due = element.querySelector(".linear-due");
  due.hidden = !issue.dueDate;
  if (issue.dueDate) {
    const info = describeDate(issue.dueDate);
    due.textContent = info.label;
    due.classList.toggle("is-overdue", issue.dueDate < todayISO());
  }

  const openLink = element.querySelector(".linear-open");
  openLink.hidden = !issue.url;
  if (issue.url) openLink.href = issue.url;
}

function applyCardLayout(element, layout) {
  const bounds = boardBounds();
  const width = Math.min(layout.width, Math.max(190, bounds.width - 16));
  const height = Math.min(layout.height, Math.max(145, bounds.height - 16));
  const maxX = Math.max(8, bounds.width - width - 8);
  const maxY = Math.max(8, bounds.height - height - 8);
  const left = clamp(layout.x * bounds.width, 8, maxX);
  const top = clamp(layout.y * bounds.height, 8, maxY);

  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  element.style.zIndex = layout.z;
  element.dataset.color = layout.color;
  element.dataset.font = layout.font;
  element.classList.toggle("is-selected", element.dataset.id === selectedId);
}

function createLinearLayout(issue, index) {
  const width = 300;
  const height = 190;
  const position = findOpenPosition(width, height, index);
  const isOverdue = issue.dueDate && issue.dueDate < todayISO();
  const color = isOverdue || issue.priority === 1
    ? "coral"
    : issue.priority === 2
      ? "butter"
      : ["sky", "mint", "lilac", "paper"][index % 4];
  return {
    ...position,
    width,
    height,
    color,
    font: "sans",
    fontSize: 24,
    hidden: false,
    z: ++highestZ,
  };
}

function findOpenPosition(width, height, index) {
  const bounds = boardBounds();
  if (!bounds.width || !bounds.height) return { x: 0.1, y: 0.1 };

  const occupied = notes.map((note) => ({
    left: note.x * bounds.width,
    top: note.y * bounds.height,
    width: note.width,
    height: note.height,
  }));
  for (const layout of Object.values(linearLayouts)) {
    if (layout.hidden) continue;
    occupied.push({
      left: finiteNumber(layout.x, 0.1) * bounds.width,
      top: finiteNumber(layout.y, 0.1) * bounds.height,
      width: finiteNumber(layout.width, width),
      height: finiteNumber(layout.height, height),
    });
  }

  const gap = 18;
  for (let top = 18; top <= bounds.height - height - 8; top += 34) {
    for (let left = 18; left <= bounds.width - width - 8; left += 34) {
      const candidate = { left, top, width, height };
      if (occupied.every((rect) => !rectsOverlap(candidate, rect, gap))) {
        return { x: left / bounds.width, y: top / bounds.height };
      }
    }
  }

  const left = 16 + (index % 6) * 24;
  const top = 16 + (index % 8) * 20;
  return { x: left / bounds.width, y: top / bounds.height };
}

function rectsOverlap(left, right, gap = 0) {
  return !(
    left.left + left.width + gap <= right.left
    || right.left + right.width + gap <= left.left
    || left.top + left.height + gap <= right.top
    || right.top + right.height + gap <= left.top
  );
}

function boardBounds() {
  return board.getBoundingClientRect();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function findNote(id) {
  return notes.find((note) => note.id === id);
}

function findLinearIssue(issueId) {
  return linearIssues.find((issue) => issue.id === issueId);
}

function selectedItem(id = selectedId) {
  if (!id) return null;
  if (id.startsWith("linear:")) {
    const issueId = id.slice("linear:".length);
    const issue = findLinearIssue(issueId);
    const layout = linearLayouts[issueId];
    return issue && layout ? { kind: "linear", id, issue, layout } : null;
  }
  const note = findNote(id);
  return note ? { kind: "note", id, layout: note, note } : null;
}

function selectItem(id, raise = true) {
  const item = selectedItem(id);
  if (!item) return;
  selectedId = id;
  if (raise) item.layout.z = ++highestZ;
  render();
  if (raise) saveBoardState();
}

function deselectItem() {
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
  saveBoardState();
  requestAnimationFrame(() => notesLayer.querySelector(`[data-id="${note.id}"] .note-text`)?.focus());
}

function deleteSelected() {
  const item = selectedItem();
  if (!item) return;
  const element = notesLayer.querySelector(`[data-id="${selectedId}"]`);
  if (element) {
    element.style.opacity = "0";
    element.style.transform = "scale(0.94)";
  }

  if (item.kind === "linear") {
    item.layout.hidden = true;
    showToast(`${item.issue.identifier} hidden from this board`);
  } else {
    notes = notes.filter((note) => note.id !== selectedId);
    showToast("Note deleted");
  }
  selectedId = null;
  saveBoardState();
  setTimeout(render, 140);
}

function onNotePointerDown(event) {
  if (event.button !== 0 || event.target.closest("textarea, a, button")) return;
  const element = event.currentTarget;
  const item = selectedItem(element.dataset.id);
  if (!item) return;

  const resize = event.target.closest(".resize-handle");
  if (!resize && !event.target.closest(".note-top")) return;
  const mode = resize ? "resize" : "drag";
  selectItem(item.id);

  const bounds = boardBounds();
  const rect = element.getBoundingClientRect();
  interaction = {
    mode,
    pointerId: event.pointerId,
    id: item.id,
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
  const item = selectedItem(interaction.id);
  if (!item) return;
  const layout = item.layout;
  const bounds = boardBounds();
  const dx = event.clientX - interaction.startX;
  const dy = event.clientY - interaction.startY;

  if (interaction.mode === "drag") {
    const left = clamp(interaction.initialLeft + dx, 8, bounds.width - layout.width - 8);
    const top = clamp(interaction.initialTop + dy, 8, bounds.height - layout.height - 8);
    layout.x = left / bounds.width;
    layout.y = top / bounds.height;
  } else {
    const minWidth = item.kind === "linear" ? 245 : 190;
    const minHeight = item.kind === "linear" ? 165 : 145;
    layout.width = clamp(interaction.initialWidth + dx, minWidth, Math.min(680, bounds.width - interaction.initialLeft - 8));
    layout.height = clamp(interaction.initialHeight + dy, minHeight, Math.min(680, bounds.height - interaction.initialTop - 8));
  }
  if (item.kind === "linear") updateLinearElement(event.currentTarget, item.issue, layout);
  else updateNoteElement(event.currentTarget, layout);
}

function onPointerEnd(event) {
  if (!interaction || event.pointerId !== interaction.pointerId) return;
  event.currentTarget.classList.remove("is-dragging", "is-resizing");
  event.currentTarget.removeEventListener("pointermove", onPointerMove);
  event.currentTarget.removeEventListener("pointerup", onPointerEnd);
  event.currentTarget.removeEventListener("pointercancel", onPointerEnd);
  interaction = null;
  saveBoardState();
}

function updateInspector() {
  const item = selectedItem();
  const visible = Boolean(item) && !appShell.classList.contains("is-presenting");
  inspector.classList.toggle("is-visible", visible);
  inspector.classList.toggle("is-linear", item?.kind === "linear");
  inspector.setAttribute("aria-hidden", String(!visible));
  if (!item) return;

  inspector.querySelectorAll(".swatch").forEach((swatch) => {
    swatch.classList.toggle("is-selected", swatch.dataset.color === item.layout.color);
  });
  fontSelect.value = item.layout.font;
  fontSizeSelect.value = String(item.layout.fontSize);
  dateInput.value = item.kind === "note" ? item.note.dueDate : "";
  dateInput.closest(".date-control").classList.toggle("has-date", item.kind === "note" && Boolean(item.note.dueDate));
  deleteButton.title = item.kind === "linear" ? "Hide Linear card" : "Delete note";
  deleteButton.querySelector(".sr-only").textContent = item.kind === "linear" ? "Hide selected Linear card" : "Delete selected note";
}

function changeSelected(changes) {
  const item = selectedItem();
  if (!item) return;
  Object.assign(item.layout, changes);
  render();
  saveBoardState();
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
  updateLinearSettingsUI();
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
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2000);
}

async function initializeLinear() {
  setLinearButtonState("syncing");
  try {
    const status = await requestJSON("/api/linear/status");
    linearConfigured = Boolean(status.configured);
    if (!linearConfigured) {
      setLinearButtonState("off");
      return;
    }

    await loadLinearOptions();
    if (!linearSettings.teamId && linearOptions.teams.length) {
      linearSettings.teamId = linearOptions.teams[0].id;
      saveBoardState();
    }
    if (linearSettings.teamId) await syncLinear(false, false);
    else setLinearButtonState("connected");
  } catch (error) {
    setLinearButtonState("error");
    console.warn("Linear initialization failed:", error.message);
  }
}

async function openLinearSettings() {
  if (!linearDialog.open) linearDialog.showModal();
  await refreshLinearConnection(false);
}

async function refreshLinearConnection(force) {
  linearSetupState.hidden = false;
  linearSettingsForm.hidden = true;
  linearSetupState.classList.add("is-checking");
  linearSetupCommand.hidden = true;
  linearRetryButton.disabled = true;
  linearSetupTitle.textContent = "Checking the connection…";
  linearSetupMessage.textContent = "Looking for a server-side Linear credential.";

  try {
    const status = await requestJSON("/api/linear/status");
    linearConfigured = Boolean(status.configured);
    if (!linearConfigured) {
      showLinearSetupMessage({
        title: "Add a Linear API key",
        message: "The credential stays on this display’s server and is never sent to browser storage.",
        showCommand: true,
      });
      setLinearButtonState("off");
      return;
    }

    await loadLinearOptions(force);
    if (!linearOptions.teams.length) {
      showLinearSetupMessage({
        title: "No Linear teams found",
        message: "The connected credential can authenticate, but it does not have access to an active team.",
      });
      setLinearButtonState("error");
      return;
    }

    populateLinearControls();
    linearSetupState.hidden = true;
    linearSettingsForm.hidden = false;
    setLinearButtonState("connected");
  } catch (error) {
    showLinearSetupMessage({ title: "Linear could not connect", message: error.message });
    setLinearButtonState("error");
  } finally {
    linearSetupState.classList.remove("is-checking");
    linearRetryButton.disabled = false;
  }
}

function showLinearSetupMessage({ title, message, showCommand = false }) {
  linearSetupState.hidden = false;
  linearSettingsForm.hidden = true;
  linearSetupTitle.textContent = title;
  linearSetupMessage.textContent = message;
  linearSetupCommand.hidden = !showCommand;
}

async function loadLinearOptions(force = false) {
  linearOptions = await requestJSON(`/api/linear/options${force ? "?refresh=1" : ""}`);
  linearOptions.teams = Array.isArray(linearOptions.teams) ? linearOptions.teams : [];
  linearOptions.projects = Array.isArray(linearOptions.projects) ? linearOptions.projects : [];
}

function populateLinearControls() {
  const validTeam = linearOptions.teams.some((team) => team.id === linearSettings.teamId);
  if (!validTeam) linearSettings.teamId = linearOptions.teams[0]?.id ?? "";

  linearTeamSelect.replaceChildren(...linearOptions.teams.map((team) => optionElement(team.id, `${team.name} (${team.key})`)));
  linearTeamSelect.value = linearSettings.teamId;
  populateProjectSelect();
  linearDaysSelect.value = String(linearSettings.days);
  linearFilterSelect.value = linearSettings.filterMode;
  linearLimitSelect.value = String(linearSettings.limit);
  updateLinearSettingsUI();
}

function populateProjectSelect() {
  const projects = linearOptions?.projects.filter((project) => project.teamIds.includes(linearTeamSelect.value)) ?? [];
  linearProjectSelect.replaceChildren(optionElement("", "All projects"), ...projects.map((project) => optionElement(project.id, project.name)));
  const validProject = projects.some((project) => project.id === linearSettings.projectId);
  linearProjectSelect.value = validProject ? linearSettings.projectId : "";
}

function optionElement(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

async function syncLinear(force = false, notify = true) {
  if (!linearConfigured || !linearSettings.teamId) return false;
  if (linearSyncPromise) return linearSyncPromise;

  setLinearButtonState("syncing");
  linearSyncButton.disabled = true;
  linearSyncButton.textContent = "Syncing…";

  const params = new URLSearchParams({
    teamId: linearSettings.teamId,
    projectId: linearSettings.projectId,
    days: String(linearSettings.days),
    limit: String(linearSettings.limit),
    dueOnly: linearSettings.filterMode === "due-only" ? "1" : "0",
  });
  if (force) params.set("refresh", "1");

  linearSyncPromise = requestJSON(`/api/linear/issues?${params}`)
    .then((result) => {
      linearIssues = Array.isArray(result.issues) ? result.issues.map(sanitizeLinearIssue) : [];
      linearSyncedAt = result.syncedAt ?? new Date().toISOString();
      localStorage.setItem(LINEAR_CACHE_KEY, JSON.stringify({ issues: linearIssues, syncedAt: linearSyncedAt }));
      render();
      setLinearButtonState("connected");
      if (notify) showToast(linearIssues.length ? `${linearIssues.length} Linear cards synced` : "Linear is synced — no matching issues");
      return true;
    })
    .catch((error) => {
      setLinearButtonState("error");
      if (notify) showToast(`Linear: ${error.message}`);
      return false;
    })
    .finally(() => {
      linearSyncPromise = null;
      linearSyncButton.disabled = false;
      linearSyncButton.textContent = "Sync now";
      updateLinearSettingsUI();
    });

  return linearSyncPromise;
}

async function requestJSON(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The board server returned an unreadable response.");
  }
  if (!response.ok) throw new Error(payload.error?.message ?? `Request failed with HTTP ${response.status}.`);
  return payload;
}

function setLinearButtonState(state) {
  linearButton.dataset.state = state;
  const labels = {
    off: "Linear is not configured",
    connected: "Linear feed connected",
    syncing: "Syncing Linear…",
    error: "Linear needs attention",
  };
  linearButton.title = labels[state] ?? "Configure the Linear feed";
}

function updateLinearSettingsUI() {
  if (linearSyncedAt) {
    const date = new Date(linearSyncedAt);
    linearLastSync.textContent = Number.isNaN(date.getTime()) ? "Previously synced" : `Synced ${relativeTime(date)}`;
  } else {
    linearLastSync.textContent = "Not synced yet";
  }

  const hidden = linearIssues.filter((issue) => linearLayouts[issue.id]?.hidden).length;
  linearHiddenCount.textContent = hidden === 0 ? "None hidden" : `${hidden} hidden ${hidden === 1 ? "card" : "cards"}`;
  linearRestoreButton.disabled = hidden === 0;

  linearFeedRuleText.textContent = linearSettings.filterMode === "due-only"
    ? "Only incomplete issues with a due date inside the selected window. Priority alone will not add a card."
    : "Incomplete issues due in the selected window, plus urgent or high-priority work already in progress.";

  linearVisibilityButton.hidden = linearIssues.length === 0;
  linearVisibilityButton.dataset.visible = String(linearSettings.cardsVisible);
  linearVisibilityButton.querySelector("span").textContent = linearSettings.cardsVisible ? "Hide cards" : "Show cards";
  linearVisibilityButton.title = linearSettings.cardsVisible ? "Hide Linear cards" : "Show Linear cards";
}

function relativeTime(date) {
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 30) return "just now";
  if (seconds < 90) return "1 minute ago";
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes ago`;
  if (seconds < 5400) return "1 hour ago";
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hours ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function priorityLabel(priority) {
  return ({ 1: "· Urgent", 2: "· High", 3: "· Medium", 4: "· Low" })[priority] ?? "";
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function safeColor(value) {
  return /^#[0-9a-f]{3,8}$/i.test(value ?? "") ? value : "#777";
}

addButton.addEventListener("click", addNote);
emptyAddButton.addEventListener("click", addNote);
presentButton.addEventListener("click", togglePresent);
deleteButton.addEventListener("click", deleteSelected);
board.addEventListener("pointerdown", (event) => {
  if (event.target === board || event.target.classList.contains("board-grain") || event.target === notesLayer) {
    deselectItem();
  }
});

inspector.querySelectorAll(".swatch").forEach((swatch) => {
  swatch.addEventListener("click", () => changeSelected({ color: swatch.dataset.color }));
});
fontSelect.addEventListener("change", () => changeSelected({ font: fontSelect.value }));
fontSizeSelect.addEventListener("change", () => changeSelected({ fontSize: Number(fontSizeSelect.value) }));
dateInput.addEventListener("change", () => {
  const item = selectedItem();
  if (item?.kind === "note") changeSelected({ dueDate: dateInput.value });
});

linearButton.addEventListener("click", openLinearSettings);
linearVisibilityButton.addEventListener("click", () => {
  linearSettings.cardsVisible = !linearSettings.cardsVisible;
  if (!linearSettings.cardsVisible && selectedId?.startsWith("linear:")) selectedId = null;
  saveBoardState();
  render();
  showToast(linearSettings.cardsVisible ? "Linear cards shown" : "Linear cards hidden");
});
linearCloseButton.addEventListener("click", () => linearDialog.close());
linearRetryButton.addEventListener("click", () => refreshLinearConnection(true));
linearDialog.addEventListener("click", (event) => {
  if (event.target === linearDialog) linearDialog.close();
});
linearTeamSelect.addEventListener("change", () => {
  linearSettings.teamId = linearTeamSelect.value;
  linearSettings.projectId = "";
  populateProjectSelect();
});
linearProjectSelect.addEventListener("change", () => {
  linearSettings.projectId = linearProjectSelect.value;
});
linearDaysSelect.addEventListener("change", () => {
  linearSettings.days = Number(linearDaysSelect.value);
});
linearFilterSelect.addEventListener("change", () => {
  linearSettings.filterMode = linearFilterSelect.value;
  updateLinearSettingsUI();
});
linearLimitSelect.addEventListener("change", () => {
  linearSettings.limit = Number(linearLimitSelect.value);
});
linearSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  linearSettings.teamId = linearTeamSelect.value;
  linearSettings.projectId = linearProjectSelect.value;
  linearSettings.days = Number(linearDaysSelect.value);
  linearSettings.filterMode = linearFilterSelect.value;
  linearSettings.limit = Number(linearLimitSelect.value);
  linearSettings.cardsVisible = true;
  saveBoardState();
  const success = await syncLinear(true);
  if (success) linearDialog.close();
});
linearSyncButton.addEventListener("click", () => syncLinear(true));
linearRestoreButton.addEventListener("click", () => {
  Object.values(linearLayouts).forEach((layout) => { layout.hidden = false; });
  saveBoardState();
  render();
  showToast("Hidden Linear cards restored");
});

window.addEventListener("keydown", (event) => {
  const editing = event.target.matches("textarea, input, select");
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    addNote();
  } else if (!editing && !linearDialog.open && (event.key === "Delete" || event.key === "Backspace")) {
    deleteSelected();
  } else if (!editing && !linearDialog.open && event.key.toLowerCase() === "p") {
    togglePresent();
  } else if (event.key === "Escape" && !linearDialog.open) {
    if (appShell.classList.contains("is-presenting")) togglePresent();
    else deselectItem();
  }
});

window.addEventListener("resize", render);
window.addEventListener("beforeunload", writeBoardState);

updateTime();
setInterval(updateTime, 15000);
setInterval(() => {
  if (linearConfigured && linearSettings.teamId && !document.hidden) syncLinear(false, false);
}, 10 * 60 * 1000);
render();
initializeLinear();
