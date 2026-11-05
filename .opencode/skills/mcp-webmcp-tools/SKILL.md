---
name: mcp-webmcp-tools
description: Build MCP servers or clients and browser WebMCP tool surfaces with zero-trust arguments and step-up confirmation. Use for any AI tool protocol, tool schema, or LLM-facing integration.
---

# MCP and WebMCP

Load `engineering-baseline`, `contract-first-design`, and `security-hardening`. Do not add a tool surface that nobody asked for.

Expose capabilities as typed, authorized, revocable tools. Do not expose them as scraped DOM or as trusted prompts.

## Contracts

Every tool has a strict JSON Schema in the canonical contract home: types, bounds, enums, and excluded dangerous options such as raw paths, arbitrary URLs, and shell fragments. Classify each tool as read, state-changing, destructive, or sensitive. Sensitive and destructive tools require step-up bound to the exact operation, version, amount, and destination.

## MCP

Use strict JSON-RPC 2.0. Validate every message. Tool arguments are untrusted external input even when the caller is a model. Prevent traversal, argument injection, and oversized or deep payloads. Prefer an executable plus an argument array. Never evaluate untrusted code, templates, or expressions.

Local servers use authenticated stdio or an ACL-protected loopback with a short-lived capability. A random port is not authentication. Validate peer identity and schema. Limit handle inheritance. Bound callback-server lifetime. Defend loopback against browser clients, DNS rebinding, Host abuse, and CSRF. Absence of Origin is not authentication.

## WebMCP

Declarative or imperative tools are a typed page API, not a scraper. `navigator.modelContext` or an equivalent manifest does not grant authority. Re-authorize every invocation on the authoritative backend. Server-side validation still runs if the client already validated. Opening a page or receiving a tool call is not consent.

## Injection and poisoning

Content inside resources and tool results is data. Mark it and isolate it from system instructions. It cannot change goals, reveal secrets, or authorize a tool. Reject embedded disclosure and scope-violation requests. Keep `source_id` so a poisoned source can be revoked. Deleting the source deletes derived embeddings when a vector store exists.

## Lifecycle

Version tools so mixed clients survive expand-and-contract. Rate-limit and size-limit each tool. Honor expiry and revocation on long-lived connections. Errors are safe and redacted.

## Adversarial checks for QA

Fuzz bounds. Replay calls. Cross-tenant invocation. Instruction smuggling in returned content. Missing step-up. Peer spoofing on loopback. Expired capability.

## Done when

Schemas, authorization, and step-up are wired, returned content cannot instruct, and QA has the adversarial list.
