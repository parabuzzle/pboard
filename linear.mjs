const LINEAR_ENDPOINT = "https://api.linear.app/graphql";
const CLOSED_STATE_TYPES = new Set(["completed", "canceled"]);

const OPTIONS_QUERY = `
  query PriorityBoardOptions {
    teams(first: 100) {
      nodes {
        id
        name
        key
      }
    }
    projects(first: 100) {
      nodes {
        id
        name
        status {
          type
        }
        teams {
          nodes {
            id
            name
            key
          }
        }
      }
    }
  }
`;

const ISSUES_QUERY = `
  query PriorityBoardIssues($first: Int!, $filter: IssueFilter!) {
    issues(first: $first, filter: $filter, orderBy: updatedAt) {
      nodes {
        id
        identifier
        title
        priority
        dueDate
        url
        updatedAt
        assignee {
          id
          name
          displayName
        }
        state {
          id
          name
          type
          color
        }
        team {
          id
          name
          key
        }
        project {
          id
          name
        }
      }
    }
  }
`;

export class LinearServiceError extends Error {
  constructor(message, { status = 502, code = "LINEAR_REQUEST_FAILED" } = {}) {
    super(message);
    this.name = "LinearServiceError";
    this.status = status;
    this.code = code;
  }
}

export function getLinearConfiguration(environment = process.env) {
  const apiKey = environment.LINEAR_API_KEY?.trim();
  const accessToken = environment.LINEAR_ACCESS_TOKEN?.trim();

  if (accessToken) {
    return { configured: true, kind: "oauth", authorization: `Bearer ${accessToken}` };
  }
  if (apiKey) {
    return { configured: true, kind: "api-key", authorization: apiKey };
  }
  return { configured: false, kind: null, authorization: null };
}

export function selectBoardIssues(issues, { days = 14, limit = 12, dueOnly = false, today = new Date() } = {}) {
  const start = localISODate(today);
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + clampInteger(days, 1, 90, 14));
  const end = localISODate(endDate);

  return issues
    .filter((issue) => !CLOSED_STATE_TYPES.has(issue.state?.type))
    .filter((issue) => {
      const dueSoon = isISODate(issue.dueDate) && issue.dueDate <= end;
      if (dueOnly) return dueSoon;
      const importantAndStarted = [1, 2].includes(issue.priority) && issue.state?.type === "started";
      return dueSoon || importantAndStarted;
    })
    .sort((left, right) => compareIssues(left, right, start))
    .slice(0, clampInteger(limit, 1, 25, 12))
    .map(normalizeIssue);
}

export function createLinearService({ environment = process.env, fetchImpl = fetch, now = () => new Date() } = {}) {
  const configuration = getLinearConfiguration(environment);
  const cache = new Map();

  async function request(query, variables) {
    if (!configuration.configured) {
      throw new LinearServiceError("Linear is not configured on this server.", {
        status: 503,
        code: "LINEAR_NOT_CONFIGURED",
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await fetchImpl(LINEAR_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: configuration.authorization,
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
    } catch (error) {
      const message = error.name === "AbortError"
        ? "Linear took too long to respond."
        : "The server could not reach Linear.";
      throw new LinearServiceError(message);
    } finally {
      clearTimeout(timeout);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new LinearServiceError("Linear returned an unreadable response.");
    }

    if (!response.ok || payload.errors?.length) {
      const message = payload.errors?.[0]?.message || `Linear returned HTTP ${response.status}.`;
      const status = response.status === 401 || response.status === 403 ? 401 : 502;
      throw new LinearServiceError(message, {
        status,
        code: status === 401 ? "LINEAR_AUTH_FAILED" : "LINEAR_REQUEST_FAILED",
      });
    }
    return payload.data;
  }

  async function cached(key, duration, loader, force = false) {
    const existing = cache.get(key);
    if (!force && existing && existing.expiresAt > Date.now()) return existing.value;
    const value = await loader();
    cache.set(key, { value, expiresAt: Date.now() + duration });
    return value;
  }

  return {
    status() {
      return { configured: configuration.configured, authKind: configuration.kind };
    },

    options({ force = false } = {}) {
      return cached("options", 10 * 60 * 1000, async () => {
        const data = await request(OPTIONS_QUERY, {});
        const teams = (data.teams?.nodes ?? [])
          .map((team) => ({ id: team.id, name: team.name, key: team.key }))
          .sort((left, right) => left.name.localeCompare(right.name));
        const projects = (data.projects?.nodes ?? [])
          .filter((project) => !CLOSED_STATE_TYPES.has(project.status?.type))
          .map((project) => ({
            id: project.id,
            name: project.name,
            teamIds: (project.teams?.nodes ?? []).map((team) => team.id),
          }))
          .sort((left, right) => left.name.localeCompare(right.name));
        return { teams, projects };
      }, force);
    },

    issues({ teamId, projectId = "", days = 14, limit = 12, dueOnly = false, force = false }) {
      if (!teamId || teamId.length > 100) {
        throw new LinearServiceError("A valid Linear team is required.", {
          status: 400,
          code: "INVALID_TEAM",
        });
      }
      const safeDays = clampInteger(days, 1, 90, 14);
      const safeLimit = clampInteger(limit, 1, 25, 12);
      const selectionDate = now();
      const dueThrough = new Date(selectionDate);
      dueThrough.setDate(dueThrough.getDate() + safeDays);
      const filter = {
        team: { id: { eq: teamId } },
        state: { type: { nin: ["completed", "canceled"] } },
      };
      if (dueOnly) {
        filter.dueDate = { lte: localISODate(dueThrough) };
      } else {
        filter.or = [
          { dueDate: { lte: localISODate(dueThrough) } },
          {
            priority: { lte: 2, neq: 0 },
            state: { type: { eq: "started" } },
          },
        ];
      }
      if (projectId && projectId.length <= 100) filter.project = { id: { eq: projectId } };

      const key = `issues:${teamId}:${projectId}:${safeDays}:${safeLimit}:${dueOnly ? "due" : "focused"}`;
      return cached(key, 5 * 60 * 1000, async () => {
        const data = await request(ISSUES_QUERY, { first: 250, filter });
        return {
          issues: selectBoardIssues(data.issues?.nodes ?? [], {
            days: safeDays,
            limit: safeLimit,
            dueOnly,
            today: selectionDate,
          }),
          syncedAt: new Date().toISOString(),
        };
      }, force);
    },
  };
}

function normalizeIssue(issue) {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    priority: Number(issue.priority) || 0,
    dueDate: isISODate(issue.dueDate) ? issue.dueDate : "",
    url: issue.url,
    updatedAt: issue.updatedAt,
    assignee: issue.assignee
      ? { id: issue.assignee.id, name: issue.assignee.displayName || issue.assignee.name }
      : null,
    state: issue.state
      ? { id: issue.state.id, name: issue.state.name, type: issue.state.type, color: issue.state.color }
      : null,
    team: issue.team
      ? { id: issue.team.id, name: issue.team.name, key: issue.team.key }
      : null,
    project: issue.project ? { id: issue.project.id, name: issue.project.name } : null,
  };
}

function compareIssues(left, right, today) {
  const leftBucket = issueBucket(left, today);
  const rightBucket = issueBucket(right, today);
  if (leftBucket !== rightBucket) return leftBucket - rightBucket;

  const leftDue = isISODate(left.dueDate) ? left.dueDate : "9999-12-31";
  const rightDue = isISODate(right.dueDate) ? right.dueDate : "9999-12-31";
  if (leftDue !== rightDue) return leftDue.localeCompare(rightDue);

  const leftPriority = left.priority > 0 ? left.priority : 99;
  const rightPriority = right.priority > 0 ? right.priority : 99;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  return String(left.identifier).localeCompare(String(right.identifier));
}

function issueBucket(issue, today) {
  if (isISODate(issue.dueDate) && issue.dueDate < today) return 0;
  if (isISODate(issue.dueDate)) return 1;
  return 2;
}

function localISODate(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function isISODate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, minimum), maximum);
}
