import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

import { createLinearService, LinearServiceError } from "./linear.mjs";

const root = process.cwd();

loadLocalEnvironment(join(root, ".env"));
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 4173);
const linear = createLinearService();

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (requestUrl.pathname.startsWith("/api/linear/")) {
    await handleLinearRequest(request, response, requestUrl);
    return;
  }

  const pathname = decodeURIComponent(requestUrl.pathname);
  const candidate = normalize(join(root, pathname === "/" ? "index.html" : pathname));
  const file = candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : join(root, "index.html");

  response.writeHead(200, {
    "Content-Type": types[extname(file)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(response);
}).listen(port, host, () => {
  const linearState = linear.status().configured ? "configured" : "not configured";
  console.log(`Priority Board is ready at http://localhost:${port}`);
  console.log(`Linear feed: ${linearState}`);
});

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
