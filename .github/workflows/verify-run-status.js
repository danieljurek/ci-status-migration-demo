// Adapted from Azure/azure-rest-api-specs at e4165be7a953958691125d9c2ec766ac955a9d87.
// The original watcher compared a legacy check run with an onboarded workflow run.
// This file keeps its lookup and comparison logic together so the demo can be copied.

const PER_PAGE_MAX = 100;
const WAIT_MS = 10_000;
const MAX_ATTEMPTS = 36;

function latestByDate(items, field) {
  return [...items].sort(
    (a, b) => new Date(b[field]).getTime() - new Date(a[field]).getTime(),
  )[0];
}

async function getLegacyCheck(github, repo, name, sha) {
  const runs = await github.paginate(github.rest.checks.listForRef, {
    ...repo,
    ref: sha,
    check_name: name,
    status: "completed",
    per_page: PER_PAGE_MAX,
  });
  return latestByDate(
    runs.filter((run) => run.name === name && run.head_sha === sha),
    "completed_at",
  );
}

async function getNewWorkflow(github, repo, name, sha) {
  const runs = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, {
    ...repo,
    head_sha: sha,
    status: "completed",
    per_page: PER_PAGE_MAX,
  });
  return latestByDate(
    runs.filter((run) => run.name === name && run.head_sha === sha),
    "updated_at",
  );
}

async function waitForBoth(github, repo, legacyCheckName, newWorkflowName, sha, options = {}) {
  const attempts = options.attempts ?? MAX_ATTEMPTS;
  const wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const [legacy, modern] = await Promise.all([
      getLegacyCheck(github, repo, legacyCheckName, sha),
      getNewWorkflow(github, repo, newWorkflowName, sha),
    ]);
    if (legacy && modern) return { legacy, modern };
    if (attempt < attempts) await wait(WAIT_MS);
  }
  throw new Error(
    `Timed out waiting for completed results: ${legacyCheckName} and ${newWorkflowName} at ${sha}`,
  );
}

function compareConclusions(legacy, modern) {
  return legacy.conclusion === modern.conclusion;
}

async function verifyRunStatus({ github, context, core, legacyCheckName, newWorkflowName }, options) {
  if (context.eventName !== "workflow_run" || context.payload.action !== "completed") {
    throw new Error("Expected a completed workflow_run event");
  }
  if (context.payload.workflow_run.event !== "pull_request") {
    throw new Error("Expected a workflow started by a pull_request event");
  }

  const repo = context.repo;
  const sha = context.payload.workflow_run.head_sha;
  const { legacy, modern } = await waitForBoth(
    github,
    repo,
    legacyCheckName,
    newWorkflowName,
    sha,
    options,
  );
  const agrees = compareConclusions(legacy, modern);
  const description = `Legacy: ${legacy.conclusion}; new: ${modern.conclusion}`;
  const sourcePr = context.payload.workflow_run.pull_requests?.[0];
  const statusSha = sourcePr?.head?.sha ?? sha;

  core.info(`${legacy.name}: ${legacy.conclusion} (${legacy.html_url})`);
  core.info(`${modern.name}: ${modern.conclusion} (${modern.html_url})`);
  await github.rest.repos.createCommitStatus({
    ...repo,
    sha: statusSha,
    state: agrees ? "success" : "failure",
    context: "migration-consistency/demo",
    description,
    target_url: `${context.serverUrl}/${repo.owner}/${repo.repo}/actions/runs/${context.runId}`,
  });

  if (agrees) {
    core.notice(`Conclusions match: ${description}`);
  } else {
    core.setFailed(`Conclusions differ: ${description}`);
  }
  return agrees;
}

module.exports = {
  compareConclusions,
  getLegacyCheck,
  getNewWorkflow,
  verifyRunStatus,
  waitForBoth,
};
