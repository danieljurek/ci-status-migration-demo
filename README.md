# CI status migration demo

This repository demonstrates the watcher used while moving a CI check from one implementation to another. It runs a legacy check and a new workflow for each pull request, compares their completed conclusions, and posts `migration-consistency/demo` on the PR. A failed consistency status means the two implementations disagree; it does not mean either check is the intended source of truth.

The comparison follows the [Azure REST API Specs watcher at `e4165be`](https://github.com/Azure/azure-rest-api-specs/blob/e4165be7a953958691125d9c2ec766ac955a9d87/.github/workflows/src/verify-run-status.js) and its [early LintDiff onboarding](https://github.com/Azure/azure-rest-api-specs/blob/49be66f61538/.github/workflows/watch-lintdiff.yaml). In Azure, a completed external check suite or the new workflow could start the watcher. Here both sample checks are GitHub Actions workflows, so a completed `workflow_run` for either one starts it. This avoids relying on `check_run` events from Actions jobs and makes the demo finish even when the new check completes first.

The demo adds a PR commit status to make the comparison visible on the example pull requests. The original watcher reported through its own workflow job and did not create that status.

## Files to copy

1. [Reusable workflow](.github/workflows/reusable-verify-run-status.yaml)
2. [Single-file comparison logic](.github/workflows/verify-run-status.js)
3. [Caller workflow](.github/workflows/~demo-watch-migration.yaml) — rename it and set the two workflow names and check run name for your migration.

The files starting with `~demo-` are examples. Delete the two sample check workflows and `demo/results.json` when adapting the watcher to real checks. The caller file also starts with `~demo-` so its sample names are easy to spot before copying it; its workflow is named `~Watch-new-check`.

## Demonstrations

The two pull requests are intentionally left open so their Checks tabs and `migration-consistency/demo` statuses remain visible.

| Pull request | Legacy check | New workflow | Consistency status |
| --- | --- | --- | --- |
| [Agreement: both succeed](https://github.com/danieljurek/ci-status-migration-demo/pull/1) | success | success | success |
| [Disagreement: new check fails](https://github.com/danieljurek/ci-status-migration-demo/pull/2) | success | failure | failure |

The closed [pending-result verification PR](https://github.com/danieljurek/ci-status-migration-demo/pull/3) delayed the new check. Its [first watcher run](https://github.com/danieljurek/ci-status-migration-demo/actions/runs/44835319449) ended successfully with a notice and no comparison status while that check was running. Its [second watcher run](https://github.com/danieljurek/ci-status-migration-demo/actions/runs/44835515207) posted success after both checks completed.

## How the watcher works

The legacy sample workflow creates a check run named `Legacy check`. The new sample workflow and its check are named `[TEST-IGNORE] New check`. The watcher listens for either workflow to complete, then looks for both completed results at that commit. If one is not complete, it logs a notice and ends successfully without publishing a comparison status. The other completion event starts another watcher run. When both results exist, the watcher compares `conclusion` values exactly and publishes the result to the PR head commit.

The watcher executes code from the default branch under `workflow_run`, which has a write token for publishing the PR status. It does not check out code from the pull request. The sample checks themselves use read-only tokens.

Run the local tests with `node --test`.
