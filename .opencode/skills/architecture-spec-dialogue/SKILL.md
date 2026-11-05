---
name: architecture-spec-dialogue
description: Run a Phase 1 architecture dialogue and, only after explicit user approval, write a LOCKED ARCHITECTURE_LOCK.md and work packages. Use when the user wants to design, lock, or split an epic. Do not use it to start feature code.
---

# Architecture dialogue

No production feature code, migrations, or deploys during this skill. The output is a decision the user can approve, then a lock file.

Load `engineering-baseline`. Load `data-layer-design` before storage decisions and `security-hardening` before the A1 profile.

## Agenda

Cover all. Order by leverage. Resolve routine choices yourself. Ask only questions whose answers change boundaries, money semantics, trust, or an irreversible choice. Each question includes a recommended default and its tradeoff.

1. Domain and invariants. Bounded contexts. Rules that must never break, such as nonnegative balance, unique allocation, and one-time financial effects.
2. Tenancy and identity. Single- or multi-tenant. Roles, admins, delegation. Where the tenant boundary lives: rows, caches, queues, storage, exports.
3. Money and entitlements. Currencies, scale, rounding, billing, refunds, chargebacks, and which flows need step-up approval. Skip if the product has no money, and record that.
4. A1 security profile. Purpose, sensitive workflows and data, platforms and minimum versions, runtime, distribution and updates, standalone or server-connected or multi-tenant or offline, identities, entry points, trust boundaries, integrations, authorities. Separate business authorization, OS permissions, and component authorization. Attacker capabilities. RPO and RTO. Applicable standards: ASVS, MASVS, PCI scope, or none. State conservative assumptions for missing non-material facts.
5. Canonical contracts. Entities, DTOs, API or message surface, error model, pagination, ordering, and tool contracts if an AI surface exists.
6. Data decisions. Use the decision table in `data-layer-design`. Record rejected alternatives.
7. Release shape. Target platforms, signing and update channels, environments.

## Lock file

Write `ARCHITECTURE_LOCK.md` only when the user wants the gate. It stays `STATUS: DRAFT` until explicit approval. Only `architect-orchestrator` changes that status.

Required sections:

1. Scope and domain invariants.
2. A1 security profile.
3. Canonical schemas and where they live. Do not invent `packages/shared-contracts` if the project already has a contract home.
4. Data and storage, including the signed decision table.
5. ADR table: decision, rejected alternatives, reason, status.
6. Approved structure. Use the existing repository layout unless the user approved a new one.
7. Lock log: `approved_by`, `approved_at` ISO-8601, and the approved Phase 2 scope.

Also deliver a one-screen summary the user can approve in one reply.

## Work package

After lock, split epics into atomic packages. One owner, one sandbox or worktree.

- Owner role, task id, base revision, budget.
- Exact in-scope paths and out-of-scope paths.
- Contracts consumed. Skills to load first.
- Testable acceptance criteria, not implementation steps.
- Required checks: build or lint, affected tests, security controls mapped but not marked Verified, no secrets, no unrelated changes, five-bullet report.
- Blocked by / blocks.

## Self-healing

Track failure signature, hypothesis, action, outcome, and next decision across QA and SecOps cycles. At most 3 repair cycles per signature. Then stop and report evidence and uncertainty. Do not reset the counter by renaming the task.

## Done when

Either the user has an approvable summary and a DRAFT lock, or `STATUS: LOCKED` records their explicit approval and the orchestrator can dispatch without open material questions. Never mark LOCKED without that approval.
