---
name: security-hardening
description: Apply universal, backend, and operations security controls to a concrete surface. Use when building or reviewing auth, APIs, data, money, workers, crypto, privacy, or release controls. Load cross-platform-hardening for clients and mcp-webmcp-tools for AI tools.
---

# Security controls

Load `engineering-baseline`. Combine only the sections the surface actually has. MUST is mandatory. Record each applicable control as enforcement point, implementation evidence, and verification evidence. An unmet MUST blocks release. A justified SHOULD exception records control, reason, impact, compensation, and follow-up. Never omit a hard control silently. Never invent compliance percentages. If a required control is unavailable, keep the sensitive function disabled or explicitly incomplete.

Applicability: A and I everywhere. B for backends, APIs, shared databases, and finance. C–H via `cross-platform-hardening`. J via `qa-gate` and `secops-review`.

## A. Universal

- **A1 Profile.** Document purpose, sensitive data, platforms and minimum versions, runtime, updates, tenancy, offline behavior, identities, trust boundaries, financial invariants, attacker capabilities, RPO/RTO, and standards. Separate business authorization, OS permission, and component authorization.
- **A2 Trust.** Distrust all external input, including authenticated requests, files, IPC, local databases, and restored state. Client ids, roles, tenants, prices, balances, timestamps, and approval flags are not authority. Fail closed on missing identity, tenant, policy, or required verification.
- **A3 Schemas.** Recursive allowlists. Explicit DTO mapping. Reject unexpected security-sensitive fields. Authorize nested ORM and GraphQL writes, including both upsert branches. Prevent validation-to-write races.
- **A4 Injection and files.** Parameterize SQL. No shell parsing when an argument array works. No eval or executable deserialization. Constrain parsers. Block prototype pollution keys. Prevent traversal, link races, and archive bombs. Do not trust extension or MIME alone. Keep uploads outside executable locations. Isolate risky parsers.
- **A5 Limits.** Bound request, decompression, JSON depth, GraphQL complexity, exports, jobs, CPU, memory, and egress before expensive work. Rate-limit auth without creating account-lockout DoS. Avoid catastrophic regex. Same-thread timers cannot interrupt a blocking match.
- **A6 Sessions.** Prefer established libraries. Argon2id, unique salts, CSPRNG secrets. Resist brute force, stuffing, and enumeration. MFA for privileged access. Step-up for sensitive operations. Rotate session ids after login and privilege change. Validate token signature, algorithm allowlist, issuer, audience, expiry, and purpose. ID tokens are not API access tokens. Define effective revocation. Independently validated tokens are not instantly revocable without a revocation check.
- **A7 Recovery.** Separate reset, MFA replacement, account recovery, identity change, step-up, and transaction approval. Email access does not bypass MFA or authorize payment. Recovery tokens are protected, short-lived, single-use, and purpose-bound. Success invalidates prior sessions and related credentials. Local cookie deletion is not revocation.
- **A8 Authorization.** Deny by default. Least privilege. Authorize action, object, field, tenant, and business state on reads, writes, search, export, download, bulk, and subscriptions. Prevent IDOR and BOLA. Role or ownership alone is insufficient when delegation exists. Bind approval to the exact operation, version, amount, currency, and destination. Changes invalidate approval. Enforce revocation during concurrent mutation.
- **A9 Crypto.** Vetted AEAD. Verify tags before use. Separate keys by purpose and environment. Constant-time secret comparisons. Unique nonces per key across writers, restarts, clones, snapshots, and restores. CSPRNG does not guarantee zero collisions. Rotate before the usage bound. Retries reuse existing ciphertext or a fresh valid nonce.
- **A10 Memory.** Prefer memory-safe APIs. Audit unsafe, FFI, and parser code. Minimize secret copies. Wiping one buffer does not erase other copies, swap, or crash dumps. Obfuscation is not authorization.
- **A11 Privacy.** Minimize collection and retention. Return only authorized fields. Redact secrets from logs, traces, metrics, errors, crashes, and support bundles. Expose correlation ids, not SQL, stacks, or secret config. Do not promise physical erasure. Cryptographic erasure requires destruction of every recoverable key copy.

## B. Backend

- **B1.** Every interface independently authenticates, authorizes, validates, and enforces business rules: REST, GraphQL, WebSocket, RPC, admin, storage, jobs, and old versions. Direct API access must not bypass UI. Authenticate service identities. Re-check long-lived connections.
- **B2.** Derive tenant from a verified relationship. Fail closed. Tenant-aware uniqueness and composite foreign keys. RLS with bypass accounted for. Reset pooled context. Isolate cache, search, storage, queues, exports, and admin tools. Cross-tenant admin is explicit, narrow, and audited.
- **B3.** Write invariants first. Enforce with constraints, atomic conditional updates, locks, versions, or serializable transactions. ACID does not make read-check-write safe. Cover missing rows, write skew, and aggregates. All writers obey the invariant. In-process mutexes do not coordinate instances. Retry only recognized transient failures, and the whole transaction when required.
- **B4.** Monotonic clocks for local duration only. Authoritative time for shared expiry. Do not decide money or authorization from a lagging replica. Read-your-writes after sensitive mutations via an authoritative read or a version barrier, not a sleep. Expose pending and unknown states.
- **B5–B7.** Exact money and the ledger are in `fintech-payments`. Workers get a fresh identity, tenant, and authorization context per attempt. Do not trust serialized roles. Distinguish executing an already-authorized command from re-deciding as the current user. Quarantine poison messages. Prevent context leakage across pooled workers.
- **B8.** Least-privileged runtime identities. Separate app, migration, admin, and backup credentials. Private databases. Never disable TLS verification in production. Trust forwarded headers only from configured proxies. Signed URLs are scoped. URL fetch uses allowlists, checks every redirect, and covers private, link-local, metadata, and DNS-rebinding ranges. Bound redirects and response size.

## I. Delivery

- **I1.** Authenticate package, publisher, product, channel, architecture, and version. Prevent rollback, freeze, replay, and mix-and-match. TLS is not a signature. Never disable verification. Recovery must not silently allow an unsafe downgrade. Handle partial install.
- **I2.** Lock dependency resolution. Review build scripts and provenance. Produce an inventory. Isolate untrusted PR inputs from production secrets. Scan secrets and known vulnerabilities. Separate environment identities.
- **I3.** Audit actor, tenant, action, resource, outcome, and correlation without sensitive payloads. Do not sample away security or financial events. Define containment, revocation, and key rotation. Tokenized cards. No post-authorization CVV.
- **I4.** Encrypted, access-controlled, tamper-resistant backups. Replication is not backup. Test restore. Restores must not resurrect revoked sessions, consumed tokens, obsolete approvals, or duplicate external payments. An epoch stored inside the restored snapshot is not rollback-resistant.
- **I5.** Invariants hold during mixed client, API, worker, and schema versions, not only afterward. Old writers must not bypass new constraints.
- **I6.** Simplest sufficient architecture. Measure p95 and p99 before optimizing. Never trade authorization, isolation, or exact arithmetic for speed.

## Done when

Applicable controls are mapped to enforcement points, unmet MUSTs are flagged, exceptions are recorded, and QA has the adversarial checks. Close reviews with the seven-point output in `secops-review`.
