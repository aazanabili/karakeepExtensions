---
name: secops-review
description: Read-only adversarial review and Control Evidence Matrix update. Use before merge or release, or when a diff touches auth, data, money, clients, AI tools, or supply chain. Never use it to fix defects.
---

# SecOps review

Load `engineering-baseline`, `security-hardening`, and `qa-gate` for the report contract. Load `cross-platform-hardening` or `mcp-webmcp-tools` when those surfaces are in the diff. You reject. You do not repair.

## Frame

Diff scope, platforms, and applicable control ids. Read QA `report.json` when it exists. Producer claims are not verification.

## Passes

1. Clean code. God objects, cycles, mutable global user or tenant context, swallowed errors, missing cleanup, incomplete wiring, floating-point money, blanket suppressions, and undocumented side effects.
2. Security. Fail closed. Injection and files. Authn and authz on every interface. Tenant isolation. Exact money and one-time effects. Secrets in source, tests, examples, artifacts, images, and history. Nonce reuse. Non-constant-time secret compares. Log redaction. FFI and secret lifetime where native code exists.
3. AI. Retrieved context cannot instruct or authorize. Tool arguments are validated. Step-up is bound to the exact operation. `source_id` supports revocation.
4. Dependencies. Function, license, provenance, transitive risk, lockfile churn, and competing package managers.
5. Clients and infra, only if touched. Do not demand Cloudflare controls from a project that has no edge.

## Matrix

Update `SECURITY_EVIDENCE_MATRIX.md` only. Columns: `ID | applicability/rationale | enforcement point | implementation evidence | verification evidence | Verified/Failed/Unverified/N/A | residual risk | owner`.

`Verified` requires executed verification. Documentation and unrun tests do not qualify. One platform standard does not replace another. No compliance percentage.

Keep one row per applicable control. Mark N/A with a rationale. Do not omit a MUST. Starter ids, expand to the real set: A2-01 untrusted input, B2-01 tenant isolation, B5-01 exact money, B6-01 idempotency, A9-01 nonce uniqueness, A11-01 redaction, C1-01 web headers, I1-01 update signatures, I4-01 tested restore. Full range is A1–A11, B1–B8, C1–C3, D1–D8, E, F, G, H, I1–I6, J1–J3.

Unmet MUST blocks release and is flagged to `architect-orchestrator`. Exceptions record control, reason, impact, compensation, and follow-up. SHOULD deviations are justified. AI cannot accept material risk for the accountable owner.

## Seven-point output

1. Scope, platforms, versions, applicable controls.
2. Assumptions, trusted authorities, unresolved dependencies.
3. Artifacts reviewed.
4. Invariants, enforcement points, and bypass prevention.
5. Concurrency, retry, crash, unknown-external, offline, and recovery behavior.
6. Executed versus unexecuted verification.
7. Deploy, keys, monitoring, compatibility, and residual risk.

Then the five-bullet report from `engineering-baseline`, stating no implementation changes.

## Done when

Findings are severity-ordered with file references, the matrix matches the diff, and the verdict is PASS or BLOCK with reasons.
