// Adapted from Azure/azure-rest-api-specs at e4165be7a953958691125d9c2ec766ac955a9d87.
// The original watcher compared a legacy check run with an onboarded workflow run.
// This file keeps its lookup and comparison logic together so the demo can be copied.

const PER_PAGE_MAX = 100;

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

function compareConclusions(legacy, modern) {
  return legacy.conclusion === modern.conclusion;
}

async function verifyRunStatus({ github, context, core, legacyCheckName, newWorkflowName }) {
  if (context.eventName !== "workflow_run" || context.payload.action !== "completed") {
    throw new Error("Expected a completed workflow_run event");
  }
  if (context.payload.workflow_run.event !== "pull_request") {
    throw new Error("Expected a workflow started by a pull_request event");
  }

  const repo = context.repo;
  const sha = context.payload.workflow_run.head_sha;
  const legacy = await getLegacyCheck(github, repo, legacyCheckName, sha);
  if (!legacy) {
    core.notice(
      `No completed check run with name: ${legacyCheckName}. Not enough information to judge success or failure. Ending with success status.`,
    );
    return;
  }

  const modern = context.payload.workflow_run.name === newWorkflowName
    ? context.payload.workflow_run
    : await getNewWorkflow(github, repo, newWorkflowName, sha);
  if (!modern) {
    core.notice(
      `No completed workflow run with name: ${newWorkflowName}. Not enough information to judge success or failure. Ending with success status.`,
    );
    return;
  }

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
};
