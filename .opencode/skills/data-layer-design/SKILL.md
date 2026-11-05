---
name: data-layer-design
description: Choose and model relational, cache, object, and vector storage with tenancy, money, and migration safety. Use before schemas, a new store, embeddings, RAG, agent memory, or migrations.
---

# Data layer

Load `engineering-baseline`. Load `fintech-payments` if money moves. Load `security-hardening` for B2, B3, B8, and I4.

Every store needs a demonstrated need in an ADR. Do not add a store because it is popular. Do not add PostgreSQL, Redis, or a vector database to a project that has no such need.

## Default, when a server data layer is in scope

| Layer | Default | Authority |
|---|---|---|
| Relational | PostgreSQL 16+ with RLS and pgvector | Only source of truth for money, identity, contracts, and the ledger |
| Cache / queue | Redis 7+ | Never authoritative. Loss degrades explicitly. Rebuild from PostgreSQL |
| Vectors | pgvector in PostgreSQL | Same transaction and tenant mechanism as the truth |
| Objects | Cloudflare R2, S3, or MinIO | Blobs only. Not a database |

Record the signed choice. Alternatives stay in the ADR with the reason they lost.

## Relational rules

- Money is bounded integer minor units or exact decimals. Never float. Movements go through an append-only double-entry ledger.
- `tenant_id` on every tenant-owned table. Composite foreign keys include `tenant_id`. RLS is defense in depth, not the only check. Account for owner and admin bypass. Reset pooled connection context per transaction.
- Every writer obeys isolation: API, workers, scripts, admin tools, exports, cache keys, queue payloads, and logs.
- Invariants use CHECK, UNIQUE, FK, atomic conditional updates, and optimistic versions. Unprotected read-check-write is a defect. Short transactions. No external calls under row locks. Statement and lock timeouts. Explicit deadlock handling.
- Migrations are versioned expand-and-contract. Never ORM auto-sync. Never rewrite an applied migration. Never drop or reseed a shared database. Test fresh install, upgrade, and interrupted recovery.
- Do not shard preemptively. Scale targets and RPO/RTO belong in the A1 profile.

## Non-relational rules

Redis may hold tenant-scoped cache, sessions, rate limits, pub/sub, and queues behind a transactional outbox. Effective revocation is anchored in PostgreSQL. Cookie deletion is not revocation. No secrets in key names. Bound memory and eviction.

Object storage holds images, attachments, and backups. Signed URLs are scoped by object, action, and lifetime. Uploads stay outside executable paths. Media processing is sandboxed. Document deletion and retention. Do not promise physical erasure from replicas.

MongoDB only if schemaless writes exceed what JSONB can serve. ClickHouse only if OLAP exceeds materialized views. A third store needs an ADR. Vector-database SaaS is refused by default because tenant data would leave the trust boundary. An exception needs an ADR and explicit user approval.

## Vectors and AI memory

Canonical shape:

`embeddings(id, tenant_id, source_type, source_id, content_hash, model, model_version, dims, embedding, text, metadata, created_at, updated_at)`

- Store `vector(N)`, never JSON float text.
- Every row carries model, model version, and dimensions. A model change is a rolling migration: dual-write, backfill, re-read, cut over. Never a flag-day re-embed.
- `content_hash` skips unchanged text. `source_id` supports erasure: deleting a source deletes its vectors. Do not claim physical erasure from snapshots.
- Search is hybrid full-text plus ANN, merged with reciprocal rank fusion, and always filtered by `tenant_id`. Reject pure ANN in a multi-tenant context.
- Ingestion is extract, clean, bounded chunk, embed, and is idempotent and rebuildable from source.
- Retrieved text and agent memory are untrusted data, never instructions, and never tool authority. Sensitive mutations still need step-up. Tag long-term agent memory `source_type=agent_memory` with retention and size limits. No unbounded memory files.
- Qdrant, Weaviate, or Milvus self-hosted behind the same boundary is an escape hatch only after about 10M vectors, missed ANN latency targets, or an isolated workload, through one adapter. Consumers do not change.

## Operations

Separate app, migration, admin, and backup credentials. Back up PostgreSQL and object storage encrypted, off-site, and resistant to tamper and deletion. Exclude Redis. Restores must not revive revoked sessions, reuse nonces, or duplicate external payments. Observe slow queries, table and vector size, cache hit ratio, and queue depth with bounded cardinality.

QA proves constraints, RLS, races, and tenant-conflicting vector filters on real engines when those engines exist. Mocks cannot prove them.

## Done when

Each invariant has an enforcement point, store choices are in an ADR, migrations are resumable, and QA knows which real engines are required. Inapplicable stores are N/A, not silently added.
