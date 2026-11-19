const assert = require("node:assert/strict");
const test = require("node:test");
const {
  compareConclusions,
  verifyRunStatus,
  waitForBoth,
} = require("../.github/workflows/verify-run-status.js");

const SHA = "a".repeat(40);
const PR_SHA = "b".repeat(40);

function fixture(legacyConclusion, newConclusion, initiallyMissing = false) {
  let calls = 0;
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
      calls++;
      if (initiallyMissing && calls <= 2) return [];
      if (method === "checks") {
        return [{
          name: "legacy-check",
          head_sha: SHA,
          status: "completed",
          conclusion: legacyConclusion,
          completed_at: "2026-11-18T10:00:00Z",
          html_url: "https://example.test/legacy",
        }];
      }
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
        head_sha: SHA,
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

test("the comparison waits for both completed results", async () => {
  const f = fixture("failure", "failure", true);
  const result = await waitForBoth(
    f.github,
    f.context.repo,
    "legacy-check",
    "~demo-new-check",
    SHA,
    { attempts: 2, wait: async () => {} },
  );
  assert.equal(compareConclusions(result.legacy, result.modern), true);
});

test("a missing result cannot be reported as agreement", async () => {
  const f = fixture("success", "success", true);
  await assert.rejects(
    waitForBoth(f.github, f.context.repo, "legacy-check", "~demo-new-check", SHA, {
      attempts: 1,
      wait: async () => {},
    }),
    /Timed out/,
  );
});
