import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";

import { BoardStoreError, createBoardStore } from "./board-store.mjs";
import { createLinearService, LinearServiceError } from "./linear.mjs";

const root = process.cwd();

loadLocalEnvironment(join(root, ".env"));
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 4173);
const dataFile = process.env.BOARD_DATA_FILE ?? join(root, "data", "board.json");
const linear = createLinearService();
const board = createBoardStore({ file: dataFile });

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const boardStreams = new Set();
let heartbeatTimer = null;

board.subscribe((update) => {
  const message = boardEventMessage(update);
  for (const stream of boardStreams) stream.write(message);
});

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (requestUrl.pathname === "/api/board" || requestUrl.pathname === "/api/board/events") {
    await handleBoardRequest(request, response, requestUrl);
    return;
  }

  if (requestUrl.pathname.startsWith("/api/linear/")) {
    await handleLinearRequest(request, response, requestUrl);
    return;
  }

  serveStatic(response, requestUrl);
}).listen(port, host, () => {
  const linearState = linear.status().configured ? "configured" : "not configured";
  console.log(`Priority Board is ready at http://localhost:${port}`);
  console.log(`Board data file: ${dataFile}`);
  console.log(`Linear feed: ${linearState}`);
});

async function handleBoardRequest(request, response, requestUrl) {
  try {
    if (requestUrl.pathname === "/api/board/events") {
      if (request.method !== "GET") {
        sendJSON(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use GET for this endpoint." } });
        return;
      }
      openBoardStream(request, response);
      return;
    }

    if (request.method === "GET") {
      sendJSON(response, 200, board.get());
      return;
    }

    if (request.method === "PUT") {
      const payload = await readJSONBody(request);
      const update = board.replace(payload?.state, typeof payload?.clientId === "string" ? payload.clientId : null);
      sendJSON(response, 200, { rev: update.rev });
      return;
    }

    sendJSON(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or PUT for this endpoint." } });
  } catch (error) {
    const expected = error instanceof BoardStoreError;
    sendJSON(response, expected ? error.status : 500, {
      error: {
        code: expected ? error.code : "INTERNAL_ERROR",
        message: expected ? error.message : "The board could not be saved because of an unexpected error.",
      },
    });
  }
}

function openBoardStream(request, response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.write("retry: 3000\n\n");
  response.write(boardEventMessage({ ...board.get(), source: null, initial: true }));

  boardStreams.add(response);
  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      for (const stream of boardStreams) stream.write(": ping\n\n");
    }, 25000);
  }

  request.on("close", () => {
    boardStreams.delete(response);
    if (boardStreams.size === 0 && heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  });
}

function boardEventMessage(update) {
  return `event: board\ndata: ${JSON.stringify(update)}\n\n`;
}

async function readJSONBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new BoardStoreError("The board update is too large to store.", {
        status: 413,
        code: "PAYLOAD_TOO_LARGE",
      });
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BoardStoreError("The request body must be valid JSON.", { code: "INVALID_JSON" });
  }
}

async function handleLinearRequest(request, response, requestUrl) {
  if (request.method !== "GET") {
    sendJSON(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use GET for this endpoint." } });
    return;
  }

  try {
    if (requestUrl.pathname === "/api/linear/status") {
      sendJSON(response, 200, linear.status());
      return;
    }

    if (requestUrl.pathname === "/api/linear/options") {
      const options = await linear.options({ force: requestUrl.searchParams.get("refresh") === "1" });
      sendJSON(response, 200, options);
      return;
    }

    if (requestUrl.pathname === "/api/linear/issues") {
      const result = await linear.issues({
        teamId: requestUrl.searchParams.get("teamId") ?? "",
        projectId: requestUrl.searchParams.get("projectId") ?? "",
        days: requestUrl.searchParams.get("days") ?? 14,
        limit: requestUrl.searchParams.get("limit") ?? 12,
        dueOnly: requestUrl.searchParams.get("dueOnly") === "1",
        force: requestUrl.searchParams.get("refresh") === "1",
      });
      sendJSON(response, 200, result);
      return;
    }

    sendJSON(response, 404, { error: { code: "NOT_FOUND", message: "Unknown Linear endpoint." } });
  } catch (error) {
    const expected = error instanceof LinearServiceError;
    sendJSON(response, expected ? error.status : 500, {
      error: {
        code: expected ? error.code : "INTERNAL_ERROR",
        message: expected ? error.message : "The Linear integration encountered an unexpected error.",
      },
    });
  }
}

function serveStatic(response, requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    sendJSON(response, 400, { error: { code: "BAD_REQUEST", message: "The requested path could not be decoded." } });
    return;
  }

  const candidate = normalize(join(root, pathname === "/" ? "index.html" : pathname));
  const relativePath = candidate.startsWith(root + sep) ? candidate.slice(root.length + 1) : null;
  const servable = relativePath !== null
    && extname(candidate) in types
    && relativePath !== "data" && !relativePath.startsWith(`data${sep}`)
    && !relativePath.split(sep).some((segment) => segment.startsWith("."));
  const file = servable && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : join(root, "index.html");

  response.writeHead(200, {
    "Content-Type": types[extname(file)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(response);
}

function sendJSON(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function loadLocalEnvironment(file) {
  if (!existsSync(file)) return;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || key in process.env) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
