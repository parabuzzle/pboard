import assert from "node:assert/strict";
import test from "node:test";

import { createLinearService, getLinearConfiguration, selectBoardIssues } from "./linear.mjs";

const started = { id: "started", name: "In Progress", type: "started", color: "#5e6ad2" };
const backlog = { id: "backlog", name: "Backlog", type: "backlog", color: "#999" };
const completed = { id: "done", name: "Done", type: "completed", color: "#5a5" };

test("selectBoardIssues keeps overdue, upcoming, and important started issues in useful order", () => {
  const issues = [
    issue("IGOR-4", { priority: 2, state: started }),
    issue("IGOR-2", { dueDate: "2026-08-18", priority: 3, state: backlog }),
    issue("IGOR-1", { dueDate: "2026-08-09", priority: 4, state: backlog }),
    issue("IGOR-3", { dueDate: "2026-10-01", priority: 1, state: backlog }),
    issue("IGOR-5", { dueDate: "2026-08-11", priority: 1, state: completed }),
  ];

  const selected = selectBoardIssues(issues, {
    days: 14,
    limit: 12,
    today: new Date("2026-08-10T12:00:00-04:00"),
  });

  assert.deepEqual(selected.map((item) => item.identifier), ["IGOR-1", "IGOR-2", "IGOR-4"]);
});

test("due-only selection excludes important issues without due dates", () => {
  const selected = selectBoardIssues([
    issue("IGOR-1", { dueDate: "2026-08-12", priority: 3, state: backlog }),
    issue("IGOR-2", { priority: 1, state: started }),
    issue("IGOR-3", { dueDate: "2026-09-20", priority: 1, state: started }),
  ], {
    days: 14,
    dueOnly: true,
    today: new Date("2026-08-10T12:00:00-04:00"),
  });

  assert.deepEqual(selected.map((item) => item.identifier), ["IGOR-1"]);
});

test("configuration keeps API keys server-side and prefers OAuth access tokens", () => {
  assert.deepEqual(getLinearConfiguration({}), { configured: false, kind: null, authorization: null });
  assert.equal(getLinearConfiguration({ LINEAR_API_KEY: "secret" }).kind, "api-key");
  assert.deepEqual(getLinearConfiguration({ LINEAR_API_KEY: "key", LINEAR_ACCESS_TOKEN: "token" }), {
    configured: true,
    kind: "oauth",
    authorization: "Bearer token",
  });
});

test("service reports an unconfigured server without making a request", async () => {
  let requests = 0;
  const service = createLinearService({
    environment: {},
    fetchImpl: async () => {
      requests += 1;
    },
  });

  assert.deepEqual(service.status(), { configured: false, authKind: null });
  await assert.rejects(service.options(), { code: "LINEAR_NOT_CONFIGURED", status: 503 });
  assert.equal(requests, 0);
});

test("configured service discovers options, filters issues, and caches upstream reads", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, authorization: init.headers.Authorization, body });

    if (body.query.includes("PriorityBoardOptions")) {
      return Response.json({
        data: {
          teams: { nodes: [{ id: "team", name: "IgorBox", key: "IGOR" }] },
          projects: {
            nodes: [
              { id: "active", name: "MCP Server", status: { type: "started" }, teams: { nodes: [{ id: "team" }] } },
              { id: "done", name: "Shipped", status: { type: "completed" }, teams: { nodes: [{ id: "team" }] } },
            ],
          },
        },
      });
    }

    return Response.json({
      data: {
        issues: {
          nodes: [
            issue("IGOR-8", { dueDate: "2026-08-12", state: backlog }),
            issue("IGOR-9", { dueDate: "2026-10-12", state: backlog }),
          ],
        },
      },
    });
  };

  const service = createLinearService({
    environment: { LINEAR_API_KEY: "server-secret" },
    fetchImpl,
    now: () => new Date("2026-08-10T12:00:00-04:00"),
  });

  const options = await service.options();
  await service.options();
  const result = await service.issues({ teamId: "team", projectId: "active", days: 14, limit: 12 });
  await service.issues({ teamId: "team", projectId: "active", days: 14, limit: 12 });

  assert.deepEqual(options.projects.map((project) => project.name), ["MCP Server"]);
  assert.deepEqual(result.issues.map((item) => item.identifier), ["IGOR-8"]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].authorization, "server-secret");
  assert.deepEqual(calls[1].body.variables.filter.project, { id: { eq: "active" } });
  assert.deepEqual(calls[1].body.variables.filter.or[0], { dueDate: { lte: "2026-08-24" } });
});

test("due-only service queries Linear without the active-priority branch", async () => {
  let variables;
  const service = createLinearService({
    environment: { LINEAR_API_KEY: "server-secret" },
    fetchImpl: async (_url, init) => {
      variables = JSON.parse(init.body).variables;
      return Response.json({ data: { issues: { nodes: [] } } });
    },
    now: () => new Date("2026-08-10T12:00:00-04:00"),
  });

  await service.issues({ teamId: "team", days: 7, dueOnly: true });
  assert.deepEqual(variables.filter.dueDate, { lte: "2026-08-17" });
  assert.equal("or" in variables.filter, false);
});

function issue(identifier, overrides = {}) {
  return {
    id: identifier.toLowerCase(),
    identifier,
    title: `Issue ${identifier}`,
    priority: 0,
    dueDate: "",
    url: `https://linear.app/issue/${identifier}`,
    updatedAt: "2026-08-10T12:00:00Z",
    assignee: null,
    state: backlog,
    team: { id: "team", name: "IgorBox", key: "IGOR" },
    project: null,
    ...overrides,
  };
}
