---
name: release-sre
description: Containerize, isolate origins, build reproducible CI, sign releases, and design rollback-resistant recovery. Use for Docker, Cloudflare, VPS, pipelines, signing, backups, or disaster recovery. Do not use it to write product features.
---

# Release and recovery

Load `engineering-baseline` and `security-hardening` sections B8 and I1–I4. Do not release a scope unless QA status is `PASS` and the evidence matrix has zero unmet MUST controls. If those artifacts do not exist, say BLOCKED. Do not invent a VPS, cluster, or Cloudflare zone the user did not ask for.

## Containers

Non-root. Read-only root filesystem where practical. Drop capabilities. Bound CPU, memory, and storage. No docker socket and no secret mounts. Minimal base. Explicit limits. Least-privileged runtime identity.

## Edge

If an origin is deployed, it is reachable only through the chosen edge. Prefer Cloudflare Tunnel or an allowlist of Cloudflare ranges plus Authenticated Origin Pulls. Close public origin ports. Trust `CF-Connecting-IP` and `X-Forwarded-For` only from verified proxy sockets. Defend Host confusion, request smuggling, and cache poisoning. Never cache an authenticated or tenant-specific response unless the cache key partitions identity and tenant. WAF rules match the threat model, not a generic maximum.

## Supply chain

Use the project's existing package manager and frozen lockfile. Do not introduce a second package manager. Isolate untrusted PR and build inputs from production secrets. Protect CI, registry, and deploy identities. Record provenance. Scan secrets, vulnerabilities, and insecure patterns. Pin third-party actions to full commit SHAs when GitHub Actions is used. Minimal workflow permissions.

## Signing and updates

Windows Authenticode with timestamping. macOS Hardened Runtime and notarization. Android signing keys in a keystore, not in the repo. Extension and native packages authenticate publisher, product, channel, architecture, and version. Updaters enforce signature and version monotonicity. No rollback, freeze, replay, or mix-and-match. Interrupted installs recover. Never disable signature verification. Recovery must not silently permit an unsafe downgrade. TLS alone is not a signature.

## Disaster recovery

Encrypted, access-controlled, tamper and deletion resistant off-site backups of authoritative stores and object storage. Rebuildable caches are not backups. Replication is not backup. Define RPO and RTO. A restore drill is required before calling recovery done. Restores rotate security epochs, invalidate revoked sessions, permissions, consumed tokens, and obsolete approvals, and reconcile external payments before retry. An epoch inside the restored snapshot is not rollback-resistant. Audit logs keep integrity, access control, and retention.

## Process safety

Inspect listeners before binding. Configurable or OS-assigned ports for tests. Track and clean owned processes, containers, and volumes. Never kill what you do not own. Never stop a shared service without authorization.

## Checklist

- Origin path is proven, not only configured, when a deploy exists.
- Builds reproduce from the lockfile. Secrets are absent from artifacts.
- Updaters verify signatures and monotonic versions on every shipped platform.
- Restore drill executed, or explicitly NOT RUN.
- QA PASS and matrix reviewed before ship.

## Done when

The pipeline, signing, edge, and recovery claims match executed checks, owned resources are cleaned, and the five-bullet report states what was not deployed.
