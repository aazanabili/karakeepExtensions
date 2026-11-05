---
name: contract-first-design
description: Design or evolve the single canonical schema, DTO, API, and tool-contract set before consumers implement it. Use before new endpoints, schema changes, shared types, or MCP/WebMCP tool schemas.
---

# Contract-first design

Load `engineering-baseline`. Load `mcp-webmcp-tools` when a tool surface exists. Load `fintech-payments` when a field is money.

No consumer defines its own schema. Web, desktop, mobile, workers, and AI tools import the canonical set. Shared schemas do not replace independent server enforcement.

## Steps

1. Find the existing contract home. Use it. Do not create `packages/shared-contracts` unless the user approved that layout.
2. Model with recursive allowlisted runtime schemas. Validate type, encoding, length, range, depth, collection size, and business meaning. Normalize once. Reject duplicate JSON keys, ambiguous content types, and unexpected security-sensitive fields. Distinguish missing, null, empty, zero, false, invalid, unavailable, and failed.
3. Map DTOs explicitly. Never pass a request into an ORM entity, a config object, or an authorization context. Server-assign or server-verify roles, tenant and owner ids, approvals, prices, balances, ledger fields, audit metadata, and internal ids. Authorize both branches of upsert and every nested connect, create, disconnect, and bulk write. An existing relation id is not proof of access.
4. Define each operation: auth requirement, error class (validation, business rejection, transient fault, defect, cancellation), pagination, deterministic ordering, precision, units, identifier format, and null semantics. Retryable mutations declare idempotency scope.
5. Tool contracts, if any: strict JSON Schema, argument bounds, excluded dangerous options, authorization, and step-up classification.
6. Generate OpenAPI, GraphQL, or client types from the canonical source. Do not maintain a divergent copy.
7. Evolve with expand-and-contract. Add optional fields, dual-write, backfill, move readers, then remove. Never change a field's meaning in place. Never let old and new writers violate an invariant during overlap. Preserve compatibility across client, API, worker, and schema versions. Block or stage unsafe old writers instead of hoping they disappear.

## Checklist

- External input is validated. Client assertions are untrusted.
- Tenant scope is expressible on every query and mutation.
- Money fields cannot be floats.
- Breaking changes are either absent or written as expand-and-contract steps.
- Consumers that must move are listed for dispatch.

## Done when

Schemas compile, consumers can import them, generated artifacts were regenerated from the canonical source, and the change note names affected consumers.
