---
name: kernel-setup
description: Operating map for the project subagents. Use from build or plan before specialized, gated, or multi-role work, to choose who to launch and which skill they must load. Does not install files or freeze the repository.
---

# Subagent operating map

Launch a specialist with the subagent tool. Do not reimplement that role in the parent session. Do not create a `kernel/` tree, a lock file, or an evidence matrix unless the user asked for a gated architecture or a release review.

## Who to call

| Subagent | Call when | Must not |
|---|---|---|
| `architect-orchestrator` | New epic, architecture choice, contract split, or an explicit request to lock a design | Write feature code, tests, or security fixes |
| `core-backend-fintech` | APIs, schemas, migrations, auth, tenancy, workers, stores, money, webhooks | Own UI, tests, or release config |
| `cross-platform-ui` | Web, desktop, mobile, or extension UI, accessibility, RTL/LTR, client hardening | Redefine server contracts or ship signing |
| `mcp-seo-geo-agent` | MCP, WebMCP, tool schemas, prompt-injection defense, SEO, GEO | Invent an AI or public-search surface that was not requested |
| `qa-test-assurance` | Verification, regression, or a release gate | Edit production code, manifests, lockfiles, CI, or read secrets |
| `secops-auditor` | Security or clean-code review before merge or release | Fix defects or edit anything except the evidence matrix |
| `vps-cloudflare-sre` | Containers, edge, CI, signing, backups, disaster recovery | Write product feature code or release without QA PASS and zero unmet MUST controls |

`architect-orchestrator` may launch the other six. Those six do not launch further subagents. If a nested launch is refused, the parent launches the named role.

`plan` may launch them for analysis. Implementation writes belong in `build` unless the user explicitly asked `plan` to dispatch an editing role.

## Skills they load

| Work | Skill |
|---|---|
| Any code, debug, refactor, or review | `engineering-baseline` |
| Architecture dialogue or epic split | `architecture-spec-dialogue` |
| Schemas, DTOs, API or tool contracts | `contract-first-design` |
| Stores, tenancy, vectors, migrations | `data-layer-design` |
| Ledger, billing, webhooks, idempotency | `fintech-payments` |
| Applying A–I controls | `security-hardening` |
| Web, desktop, mobile, Electron, RN, Capacitor | `cross-platform-hardening` |
| MCP or WebMCP | `mcp-webmcp-tools` |
| Public search visibility | `seo-geo-surface` |
| Verification and `report.json` | `qa-gate` |
| Diff audit and evidence matrix | `secops-review` |
| Release and recovery | `release-sre` |

## Gates, only when requested

Two phases exist only after the user asks for a locked architecture.

- Phase 1: `ARCHITECTURE_LOCK.md` is absent or `STATUS: DRAFT`. No feature code, migrations, or deploys. Only `architect-orchestrator` may set `STATUS: LOCKED`, and only after explicit user approval.
- Phase 2: contract first, then scoped work packages, then `qa-test-assurance`, then `secops-auditor`, then at most 3 repair cycles per failure signature, then `vps-cloudflare-sre`.

An epic is complete only when QA status is `PASS` at `artifacts/qa-reports/<task-id>/<run-id>/report.json` and the evidence matrix has zero unmet MUST controls. File existence is not completion.

## Separation of powers

| Role | Production code | Tests | Reviews | Architecture |
|---|---|---|---|---|
| architect-orchestrator | no | no | gates | yes, with the user |
| core-backend-fintech | backend and data | no | no | no |
| cross-platform-ui | clients | no | no | no |
| mcp-seo-geo-agent | tool and search surfaces | no | no | no |
| qa-test-assurance | never | yes | no | no |
| secops-auditor | never, except the matrix | no | yes | no |
| vps-cloudflare-sre | infra and release config only | no | no | no |

The auditor rejects. Builders repair. The orchestrator dispatches and does not build features.

## Adaptation

Do not force a TypeScript monorepo, pnpm, PostgreSQL, or Cloudflare onto a project that does not have them. Roles and gates stay the same. Toolchain and store names follow the repository, or an explicit user decision. Mark inapplicable controls N/A with a rationale. Never omit a MUST silently.

## Done when

The parent has named the role, the scope, the acceptance criteria, and the skill that role must load. No extra gate files exist unless the user asked for them.
