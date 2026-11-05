---
name: fintech-payments
description: Implement money-safe billing and payments. Use for any feature that prices, holds, charges, refunds, settles, or reports money, including ledgers, Stripe or other providers, webhooks, and idempotency.
---

# Payments and ledger

Load `engineering-baseline` and `security-hardening`. If the product has no money, stop and say so. Do not add a ledger for display-only amounts.

## Exact arithmetic

Use bounded integer minor units or exact decimals. Never binary floating point in API, database, queue, export, client, or native boundaries. Define per-currency scale, rounding mode and stage, range, overflow, and intermediate precision. Not every currency has two decimals. Avoid lossy parsing. Use bigint or an exact decimal type. Serialize with bounded canonical strings or another lossless format. Strings alone do not calculate. Bound length and precision.

## Ledger

Authoritative movements go through an append-only double-entry ledger. Postings balance atomically per currency. Corrections are compensating entries, not edits. History modification is restricted. Audit is protected. Materialized balances stay consistent with postings. Distinguish ledger balance, available balance, holds, settlement, refunds, fees, and chargebacks. A ledger row does not prove provider authorization or settlement. Reconcile external payments.

## Authority

The server computes prices, discounts, taxes, entitlements, balances, and eligibility. Client amounts are display hints. Verify payment status with the provider. Network location and hidden endpoints grant no authority.

## Idempotency

Every sensitive retryable mutation has a durable key scoped by principal, tenant, operation, and canonical payload fingerprint. Uniqueness is atomic. Authorize before returning a cached result. Define duplicate, in-progress, mismatch, failure, and expiry behavior. Business uniqueness survives key expiry and a different key for the same effect. Persist outcome and state together.

## External operations

Model provider calls as a state machine. A timeout may mean success. Reconcile before a possible duplicate. Prefer at-least-once delivery with idempotent effects. Do not claim exactly-once across services. Use a transactional outbox and inbox. No provider call while a database lock is held. Retries are bounded, with backoff and jitter, and never repeat an external effect accidentally. Insufficient funds, stale versions, and policy rejection are business outcomes, not automatic retries.

## Webhooks

Verify the provider protocol against the exact raw body. Use vetted signature or MAC checks and constant-time comparison where the secret is compared. Check provider, account, environment, type, resource, amount, and currency. Accept delayed, duplicate, and out-of-order events only through valid transitions and one-time effects. Acknowledge only after durable acceptance. Redact secrets and payloads.

## Concurrency and recovery

Invariants such as nonnegative available funds and one-time effects are database constraints plus atomic updates, tested on real parallel connections when a database exists. Restores and idempotency rollbacks must not duplicate an external payment. Prefer tokenized card processing. Never retain post-authorization CVV. SDK use is not PCI DSS compliance.

## Checklist

- No floats on money paths.
- Ledger corrections are append-only.
- Each retryable mutation has a durable idempotency key.
- Webhook verification uses the raw body.
- Unknown provider outcomes are reconciled.
- Race and replay cases are listed for QA.

## Done when

Flows are ledgered and reconcilable, idempotency is specified per operation, webhook replay is safe, and QA has the race and replay list.
