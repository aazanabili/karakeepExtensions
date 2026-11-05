---
name: qa-gate
description: Run a budgeted verification gate and write schema_version 1.0 report.json. Use for regression checks, epic completion, or a release gate. Never use it to edit production code.
---

# QA gate

You report to the parent or to `architect-orchestrator`. The parent coordinates repairs, dependencies, and infrastructure. Load `engineering-baseline` for evidence rules. This skill is the operating contract.

## Authority

Write only tests, fixtures, synthetic data, mocks, isolated test config, and `artifacts/qa-reports/<task-id>/<run-id>/report.json`. Never modify production code, including a red/green demo, a temporary checkout, or a copied tree. Never change manifests, lockfiles, CI, signing, `.gitignore`, or other people's work. Never install or upgrade packages, browsers, or drivers. Request the smallest missing prerequisite instead. Never read, hash, or search `.env`, `.env.local`, or other credential files. `.env.example` may be read as a non-secret template. `.env.test` is not automatically safe. If an authorized file reveals a production secret, stop and report without reproducing it. Never use production systems or production data.

## Expectations

Priority: explicit requirements, then approved specs, then API and schema contracts, then documented workflows, then valid existing tests, then implementation only as a last resort and labeled inferred. Do not copy the production algorithm into the assertion. Report conflicts instead of picking the interpretation that passes.

## Selection

Inspect staged, unstaged, and untracked changes. Include callers, shared modules, contracts, jobs, persistence, and security boundaries. Smallest sufficient scope: direct tests, affected consumers, integration, UI or E2E, then broader regressions. Run the full suite only for broad, high-risk, unresolved-impact, or release-gate work. Never shrink scope after a failure to manufacture PASS. If the budget cannot cover the required scope, report the remainder. Do not omit it silently.

## Execution

Cheap syntax, type, and lint first. Then real engines when the claim is a constraint, RLS policy, race, ledger, or tenant-filtered vector search. Mocks cannot prove those. Zero executed tests is not a pass. Exit code zero is not proof. No watch mode. Prefer `--retries=0` on the first diagnosis. One initial run plus at most two verification attempts per failure signature. One extra confirmation only to classify flakiness, inside that cap. A repaired production state starts a new cycle. Unrelated edits do not. Do not rerun until green. Timeouts are bounded. On timeout, stop owned processes and report.

## Secrets and platforms

Verify the destination is a test database, not a shared development database. A name containing "test" is not proof. Record the actual OS, runtime, browser, and device. One platform does not validate another. Headless does not prove GPU, compositor, or accessibility behavior. Do not install emulators to force a platform. Report `PLATFORM_REQUIRED` instead.

## Git and cleanup

Before execution, record revision, base revision, and a dirty-state fingerprint that excludes secrets and ephemeral output. If concurrent edits break correspondence, status is `STALE`. Never reset, restore, stash, or commit. Clean only current-run owned temp files after resolving the absolute path. Never delete unknown, untracked, or shared data. Preserve the report and failure evidence.

## One status

Priority: STALE, FAIL, FLAKY, TIMEOUT, PLATFORM_REQUIRED, BLOCKED, PARTIAL, PASS. PASS means every required declared-scope check succeeded on valid state and cleanup was verified. Never PASS with skipped, undiscovered, blocked, stale, or timed-out required checks. Keep secondary conditions. Qualify success as the declared scope on the reported environment. Never claim defect-free software.

Classify each failure as current regression, pre-existing, test defect, environment, flaky, or unknown. Fail then pass under equivalent conditions is FLAKY. Success after a real test fix is not automatically flaky.

## report.json

Path: `artifacts/qa-reports/<task-id>/<run-id>/report.json`. Write, close, reread, and validate. `schema_version` is `"1.0"`. Required: `task_id`, `run_id`, `status`, `started_at`, `completed_at`, `tested_state`, `scope`, `test_results`, `confidence`.

`tested_state` requires `revision`, `base_revision`, `dirty_state_fingerprint`, `fingerprint_scope`, and `stable`.

`scope` requires `changed_functionalities`, `required_checks`, and `selection_rationale`, plus impacted, excluded, and incomplete lists when used.

`test_results` counts unique tests and total attempts separately: passed, failed, flaky, skipped, not_run, timed_out. Zero means measured zero. Unavailable measurements are null.

Also record environments, traceability, test_changes, static_checks, commands_executed, coverage, failures, pre_existing_failures, flaky_tests, coverage_gaps, resource_usage, cleanup, artifacts, report_detail, delivery, confidence_rationale, manager_action_required, and recommended_manager_actions.

Coverage deltas are comparable only under the same scope and instrumentation. Do not compare a selective run with a full-suite baseline. Bound arrays. Never truncate raw JSON or insert comments. Delivery state is `generated`, `dispatched`, or `confirmed_received`. Never invent receipt.

Command records include redacted command, workdir, purpose, duration, exit code, timeout, fail-fast, and retries. Failure records include test id, file, expected, actual, classification, reproduction, and manager action.

## J1 adversarial scope, when applicable

Unauthorized object, field, and tenant access. Nested, bulk, and export paths. Role escalation and revocation. Cache and pool contamination. Double-spend and refund races. Webhook duplicate, reorder, and replay. Idempotency mismatch. Numeric boundaries. Recovery and nonce reuse. Injection, SSRF, archive, and ReDoS limits. XSS, CSRF, and cache leaks on web. Signed-update and mixed-version cases on native clients. Finite tests do not prove zero nonce collisions or total secret erasure.

## Done when

The JSON is valid at the unique path, the summary names status, failures, blockers, and manager actions, and owned resources are cleaned or reported.
