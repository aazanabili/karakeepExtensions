---
name: cross-platform-hardening
description: Harden web, desktop, mobile, and cross-platform clients. Use before shipping or reviewing UI, Electron, Tauri, Capacitor, React Native, Flutter, Windows, macOS, or Android surfaces.
---

# Client hardening

Load `engineering-baseline` and `security-hardening`. Apply only the platforms that exist. State limits against same-user malware and a compromised OS. Attestation, root detection, and obfuscation are signals, not authorization.

## C. Web and embedded web

- **C1.** Context-aware encoding. Prefer text APIs. Sanitize allowed HTML with a maintained allowlist. Validate link, redirect, and resource schemes. Keep secrets and unauthorized tenant fields out of HTML, hydration, client stores, source maps, and third parties. Use CSP, `frame-ancestors` or an equivalent clickjacking control, nosniff, Referrer and Permissions policies, HTTPS, and planned HSTS. Validate `postMessage` sender, origin, and schema. Partition caches by identity and tenant. Invalidate service-worker and app state on logout, account change, and revocation.
- **C2.** Secure, HttpOnly, SameSite cookies where the architecture uses cookies. CSRF tokens or origin checks on ambient-credential mutations. SameSite alone is not enough. No GET mutations. CORS is not authorization. No session tokens in URLs. Avoid long-lived JS-readable bearer storage when a safer store exists. HttpOnly does not stop XSS from issuing authorized actions.
- **C3.** Minimize executable third parties. SRI for stable external scripts, with hashes from a trusted build. SRI does not prove the code is safe. Do not freeze or self-host payment SDKs against the provider's rules.

## D. Every native client

- **D1.** Assume binaries, config, and storage are modifiable. Never embed a shared backend secret as the app's identity. User or device keys may be provisioned.
- **D2.** Use Keystore, Keychain, or Windows secure facilities. Distinguish protected keys from encrypted data. Classify sessions, refresh tokens, recovery state, caches, pending offline operations, and logs. Restore revalidates identity and server state and never automatically revives a session. Preserve pending-operation ids.
- **D3.** Private storage, restrictive permissions, unpredictable temp files. Minimize clipboard, notification, preview, and screenshot leakage. Do not imitate system dialogs. Overlay and focus checks do not create a trusted desktop. Bind the exact approval at the authority.
- **D4.** System browser and authorization-code plus PKCE, normally S256, with a fresh verifier per attempt. Validate callback issuer, audience, purpose, and parameters. Custom schemes can be intercepted. PKCE stops redemption without the verifier. It does not prove exclusive handler ownership. Links, Intents, and launch arguments must not silently approve sensitive actions.
- **D5.** Authenticate the OS peer. Authorize each narrow capability. Validate type, schema, size, and path. No unrestricted privileged RPC. Treat shared memory as mutable untrusted input for its lifetime. Copy then validate, or enforce immutability, to prevent double-fetch. Test concurrent mutation.
- **D6.** Loopback requires a reason. Bind loopback. Authenticate with a short-lived capability. Random or fixed ports are not authentication. Limit callback-server lifetime. Defend against local browsers, rebinding, Host abuse, and CSRF.
- **D7.** Define permitted offline actions. Server-authoritative money and permission changes stay pending until verified. Never display local success as settlement. Do not use last-write-wins for money, ownership, or approvals unless an invariant survives it. Re-authorize sync. Handle duplicates, reordering, revocation, and restore.
- **D8.** Handle terminate, suspend, lock, network change, and multiple windows. Persist recoverable state atomically. Do not rely on shutdown for commit or revocation. Keep heavy work off the UI thread.

## E. Windows

Standard user by default. Narrow privilege broker. ACLs on install, service, registry, and scheduled tasks. Quoted service paths. No writable elevated dependency. Secure DLL search. No current-directory or side-loaded plugins. Explicit DACLs on pipes and mappings. Impersonation is scoped and restored. DPAPI machine scope is not app isolation. Enable DEP, ASLR, and CFG where compatible. Authenticode plus timestamping. Test standard and multiple users, service ACLs, DLL loading, and repair, update, and uninstall.

## F. Android

Maintained target SDK. Minimal permissions. Audit the merged release manifest. Internal components are not exported. Exported components authorize the caller. Intent extras are not identity. Explicit sensitive Intents. Immutable PendingIntents unless mutability is justified. Scoped storage. Hardware-backed or StrongBox Keystore when available. Biometric success is not backend approval. Deliberate `dataExtractionRules` and backup rules. `allowBackup=false` is not universal transfer prevention. No permissive trust managers or cleartext. WebViews disable unnecessary JavaScript, file access, and debug. Bridges only to trusted origins. FLAG_SECURE and obscured-touch protection, without breaking accessibility. No release debug interfaces. Protect the signing key.

## G. macOS

Non-root. App Sandbox and Hardened Runtime. Minimal entitlements. Never require disabling Gatekeeper or SIP. Sign and notarize. Neither proves the logic is safe. Deliberate Keychain sharing, sync, and user presence. Verify Secure Enclave limits. Minimize TCC grants and handle denial. Verify XPC peers by code signature, not PID or Team ID alone. Private socket directories. `0600` does not stop same-user malware. Distinguish Time Machine, iCloud, and Keychain sync. Test the signed sandboxed build.

## H. Frameworks

- **Electron and Tauri.** Current Electron, Chromium, and Node. `contextIsolation` and sandbox. No Node integration in untrusted renderers. Minimal typed bridge. Validate sender, frame, origin, and schema. Restrict navigation, windows, permissions, downloads, and external URLs. Never shell-open an untrusted URL blindly. Renderer XSS is a native-escalation risk. Apply the host OS controls.
- **Capacitor, React Native, Flutter, .NET MAUI.** Validate bridge types, bounds, precision, ownership, and threading. Generated types are not authorization. In-process bridges are not isolation against process compromise. Audit plugin permissions, entitlements, exports, and native dependencies. Tokens go in platform secure storage, never plaintext preferences. Apply C to embedded web content.

Extension pages follow C and D7: remote page content and storage payloads are data, not instructions. Optional host permissions stay optional.

## Done when

Every touched platform control is implemented or N/A with a rationale, real-build checks are listed for QA, and residual risks are named.
