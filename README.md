# CI status migration demo

This repository demonstrates the watcher used while moving a critical CI check from one implementation to another. See the original [blog post](https://blog.danieljurek.com/posts/migrating-forward-with-confidence/).

## I want to use it!

Copy these files into your repo:

1. [Reusable workflow](.github/workflows/reusable-verify-run-status.yaml)
2. [Single-file comparison logic](.github/workflows/verify-run-status.js)
3. [Caller workflow](.github/workflows/~demo-watch-migration.yaml) — rename it and set the two workflow names and check run name for your migration.

## How the watcher works

<details>
<summary>Information useful for an AI agent to read</summary>

The comparison follows the [Azure REST API Specs watcher at `e4165be`](https://github.com/Azure/azure-rest-api-specs/blob/e4165be7a953958691125d9c2ec766ac955a9d87/.github/workflows/src/verify-run-status.js) and its [early LintDiff onboarding](https://github.com/Azure/azure-rest-api-specs/blob/49be66f61538/.github/workflows/watch-lintdiff.yaml). In Azure, a completed external check suite or the new workflow could start the watcher. Here both sample checks are GitHub Actions workflows, so a completed `workflow_run` for either one starts it. This avoids relying on `check_run` events from Actions jobs and makes the demo finish even when the new check completes first.

The legacy sample workflow creates a check run named `Legacy check` and pauses for two minutes to simulate legacy system latency. The new sample workflow and its check are named `[TEST-IGNORE] New check`. The watcher listens for either workflow to complete, then looks for both completed results at that commit. If one is not complete, it logs a notice and ends successfully without publishing a comparison status. The other completion event starts another watcher run. When both results exist, the watcher compares `conclusion` values exactly and publishes the result to the PR head commit.

The `workflow_run.workflows` entry escapes the brackets in `[TEST-IGNORE]` for GitHub's trigger parser. The reusable workflow input uses the ordinary, unescaped name returned by the GitHub API.

The watcher executes code from the default branch under `workflow_run`, which has a write token for publishing the PR status. It does not check out code from the pull request. The sample checks themselves use read-only tokens.

Use `nvm use` to select Node 24 locally, then run the tests with `npm test`. The `~demo-unit-tests` workflow runs the same tests on Node 24 for pushes to `main` and for pull requests. The sample checks also select Node 24 explicitly; the checkout and github-script actions are pinned to Node 24 releases.
</details>