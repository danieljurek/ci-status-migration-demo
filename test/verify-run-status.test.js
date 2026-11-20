const assert = require("node:assert/strict");
const test = require("node:test");
const {
  verifyRunStatus,
} = require("../.github/workflows/verify-run-status.js");

const SHA = "a".repeat(40);
const PR_SHA = "b".repeat(40);

function fixture(legacyConclusion, newConclusion, options = {}) {
  const statuses = [];
  const notices = [];
  const failures = [];
  const github = {
    rest: {
      checks: { listForRef: "checks" },
      actions: { listWorkflowRunsForRepo: "workflows" },
      repos: {
        createCommitStatus: async (request) => statuses.push(request),
      },
    },
    paginate: async (method, request) => {
      assert.equal(request.head_sha ?? request.ref, SHA);
      if (method === "checks") {
        if (options.missingLegacy) return [];
        return [{
          name: "legacy-check",
          head_sha: SHA,
          status: "completed",
          conclusion: legacyConclusion,
          completed_at: "2026-11-18T10:00:00Z",
          html_url: "https://example.test/legacy",
        }];
      }
      if (options.missingNew) return [];
      return [{
        name: "~demo-new-check",
        head_sha: SHA,
        status: "completed",
        conclusion: newConclusion,
        updated_at: "2026-11-18T10:01:00Z",
        html_url: "https://example.test/new",
      }];
    },
  };
  const context = {
    eventName: "workflow_run",
    payload: {
      action: "completed",
      workflow_run: {
        event: "pull_request",
        name: options.triggerWorkflowName ?? "~demo-new-check",
        head_sha: SHA,
        conclusion: newConclusion,
        html_url: "https://example.test/new",
        pull_requests: [{ head: { sha: PR_SHA } }],
      },
    },
    repo: { owner: "example", repo: "demo" },
    serverUrl: "https://github.com",
    runId: 123,
  };
  const core = {
    info: () => {},
    notice: (message) => notices.push(message),
    setFailed: (message) => failures.push(message),
  };
  return { github, context, core, statuses, notices, failures };
}

test("matching conclusions publish a successful PR status", async () => {
  const f = fixture("success", "success");
  const agrees = await verifyRunStatus({
    github: f.github,
    context: f.context,
    core: f.core,
    legacyCheckName: "legacy-check",
    newWorkflowName: "~demo-new-check",
  });
  assert.equal(agrees, true);
  assert.equal(f.statuses[0].sha, PR_SHA);
  assert.equal(f.statuses[0].state, "success");
  assert.equal(f.failures.length, 0);
});

test("different conclusions publish a failed PR status", async () => {
  const f = fixture("success", "failure");
  const agrees = await verifyRunStatus({
    github: f.github,
    context: f.context,
    core: f.core,
    legacyCheckName: "legacy-check",
    newWorkflowName: "~demo-new-check",
  });
  assert.equal(agrees, false);
  assert.equal(f.statuses[0].state, "failure");
  assert.match(f.failures[0], /Conclusions differ/);
});

test("a pending legacy check ends successfully without a comparison status", async () => {
  const f = fixture("success", "success", { missingLegacy: true });
  const result = await verifyRunStatus({
    github: f.github,
    context: f.context,
    core: f.core,
    legacyCheckName: "legacy-check",
    newWorkflowName: "~demo-new-check",
  });
  assert.equal(result, undefined);
  assert.equal(f.statuses.length, 0);
  assert.equal(f.failures.length, 0);
  assert.match(f.notices[0], /No completed check run/);
});

test("a pending new workflow ends successfully without a comparison status", async () => {
  const f = fixture("success", "success", {
    triggerWorkflowName: "~demo-legacy-check",
    missingNew: true,
  });
  const result = await verifyRunStatus({
    github: f.github,
    context: f.context,
    core: f.core,
    legacyCheckName: "legacy-check",
    newWorkflowName: "~demo-new-check",
  });
  assert.equal(result, undefined);
  assert.equal(f.statuses.length, 0);
  assert.equal(f.failures.length, 0);
  assert.match(f.notices[0], /No completed workflow run/);
});

test("a legacy workflow event fetches the completed new workflow", async () => {
  const f = fixture("success", "failure", { triggerWorkflowName: "~demo-legacy-check" });
  const result = await verifyRunStatus({
    github: f.github,
    context: f.context,
    core: f.core,
    legacyCheckName: "legacy-check",
    newWorkflowName: "~demo-new-check",
  });
  assert.equal(result, false);
  assert.equal(f.statuses[0].state, "failure");
});
