# OCTA BMS — Authentication Threat Model

Assets: user credentials, TOTP seeds, recovery codes, session cookies, business data of
each company (finance, HR, contracts), administrative control (roles, policy).
Actors: external attacker (internet), malicious/curious employee, compromised
company-admin, attacker with a DB backup copy, attacker with XSS in the SPA.

Status legend: **M** mitigated in code + tested · **P** partially mitigated / depends on
deployment · **O** open (accepted or follow-up).

| # | Threat | Controls | Status |
|---|---|---|---|
| T1 | Credential stuffing / password spraying | Argon2id; per-IP, per-account-hash and per-(IP,account) fixed-window limits in shared Postgres store; generic error; common-password screen at set time; MFA second factor | M (limits tuned conservatively; distributed botnets still get N tries/account/hour — MFA is the real control) |
| T2 | User enumeration (login, reset, invite) | Identical response bodies/status for unknown vs wrong password; Argon2 verify against a dummy hash for unknown users; reset/forgot always 202; MFA enrolment state disclosed only *after* password verification | M |
| T3 | Victim account lockout DoS | No hard lock; account-level throttle is time-bounded and separate from (IP, account) budget, so a victim on a different network is limited only by the large per-account budget | P (an attacker can still exhaust the per-account budget for one window) |
| T4 | MFA bypass with password only | Password success yields only an `mfa_challenges` row + separate `bms_preauth` cookie; guard rejects challenge cookie on every non-allowlisted route; session cookie only set after TOTP/recovery success; `enforced` policy downgrades legacy non-MFA sessions | M |
| T5 | OTP replay / parallel races | Per-authenticator `lastUsedStep` advanced by a conditional `UPDATE … WHERE lastUsedStep < step` (atomic); challenge consumed by conditional update; both in one transaction | M (tested with concurrent requests) |
| T6 | OTP brute force | 6 digits ±1 step; 5 attempts per challenge; per-user TOTP limiter; challenge TTL 5 min | M |
| T7 | Stolen session cookie | `HttpOnly; Secure; SameSite=Strict; __Host-`; opaque 256-bit, SHA-256 at rest; idle 60 min / absolute 12 h; user can list/revoke; revoke on password reset/change, disable, MFA reset | P (no device binding; XSS can still *use* the cookie while page is open) |
| T8 | Session fixation | New token on login, MFA completion, step-up, password change; pre-existing cookies never promoted | M |
| T9 | CSRF / login CSRF | Origin/Referer must match allowlist for all unsafe methods; synchronizer token (`X-CSRF-Token`) bound to the session/challenge row; anonymous POSTs require `application/json` + Origin; SameSite=Strict | M |
| T10 | XSS | React escaping; strict CSP at nginx (`script-src 'self'`); no tokens in JS-readable storage; recovery codes / QR only in component state | P (CSP must be deployed by the operator's edge as well) |
| T11 | Leaked DB / backup | Seeds AES-256-GCM with key outside DB + AAD (user, authenticator); recovery codes HMAC-SHA256 with HKDF pepper from that key; session/reset/invite tokens SHA-256 of 256-bit randoms; Argon2id passwords | M (key compromise + DB = seeds exposed → rotate & re-enrol) |
| T12 | Cross-organization access (IDOR) | Company context only from validated membership; user admin lists scoped to company; role grants limited to own company & own permissions | P (documents are not company-scoped — F-13 follow-up) |
| T13 | Vertical escalation by staff | Role assignment cannot grant permissions the actor lacks, global scope or `isSystemAdmin`; self-grant blocked; step-up required | M |
| T14 | Admin account takeover | MFA for admins enforced first; step-up for grants/policy; `enforced` mode requires ≥ 2 MFA-enrolled super-admins; super-admins cannot be modified by non-super-admins | M |
| T15 | Recovery process compromise | Recovery codes single-use; admin recovery requires a request + approval by a *different* admin (two different super-admins if target is super-admin), audit, user notification, revokes all sessions/factors and forces re-enrolment; never email-only | M (identity verification of the requester is a human process — runbook) |
| T16 | Expired/replayed invitations & reset links | 256-bit tokens, hashed, TTL (invite 72 h, reset 30 min), single-use conditional update, newer token supersedes older | M |
| T17 | Secret leakage via logs | pino redaction of cookies, auth headers, `password`, `code`, `token`, `recoveryCode`, `secret`, `otpauthUri`; security events store sanitized context only | M (tested) |
| T18 | Multi-instance races / stale revocation | Sessions, rate limits, challenges, OTP steps all in Postgres with atomic statements; every request validates the session row (no cache) | M (RBAC permission cache remains 60 s per process — documented) |
| T19 | Clock skew | Server time only; ±1 step window; NTP is a deployment prerequisite | P |
| T20 | TOTP phishing (real-time relay) | Passkeys (origin/RP-ID bound) for administrators; policy can refuse TOTP for admins. Staff on TOTP: short challenge TTL and notifications only | P (admins: M once `requirePasskeyForAdmins` is on; staff: O) |
| T21 | Insider admin reading seeds/codes | No API returns seeds after enrollment or recovery codes after display; admins only see counts/status | M |
| T22 | Passkey ceremony replay / cross-account use | single-use challenge bound to session or pre-auth challenge, consumed before verify; credential must belong to the user; UV required; counter tracked | M |
| T23 | Admin locks themselves out by requiring passkeys | requirement only when every admin (≥2) has one; last admin passkey/factor cannot be removed; recovery codes + dual-control reset + break-glass still work | M |
