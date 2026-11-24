# Security Review Checklist

This checklist describes the local-first MVP implementation and its verified tests. It is not a production security certification.

## Verified controls

- [x] Passwords are hashed with Argon2id; new/change/reset passwords require at least 10 characters.
- [x] Access JWTs are short-lived and kept in frontend memory; refresh tokens are stored hashed and rotated.
- [x] Reuse of a revoked refresh token revokes its refresh-token family.
- [x] Refresh and logout endpoints require double-submit CSRF validation and an allowed Origin.
- [x] Failed sign-ins use generic errors, password verification for unknown accounts, lockout, and per-IP/account throttling.
- [x] Backend role checks and ownership filters guard manager, IT team, and new-hire resources.
- [x] Single-use stream tickets expire quickly and only their hashes are persisted.
- [x] User profile and notification preferences are scoped to the authenticated identity.
- [x] Admin mutations and human/system decisions are written to the audit log.
- [x] Browser axe checks report no serious or critical findings on the audited workspaces.
- [x] No external vendor integrations or email delivery are enabled by default; local mock services use MCP.

## Limits to address before production

- Demo accounts and shared passwords are seeded only when `DEMO_MODE=true`; disable demo mode and create an administrator for any non-demo environment.
- Password changes revoke refresh sessions; already-issued access JWTs remain valid until their short expiry.
- The optional Gemini integration has not been tested with a live key or production quota.
- MCP servers and SQLite are local mock infrastructure; production deployment needs service isolation, secret management, backups, monitoring, and vendor-specific threat review.
- There is no independent penetration test, dependency vulnerability scan, or production performance profile in this MVP verification.
- `mypy backend/app --ignore-missing-imports` currently reports SQLModel/MCP typing issues and is not part of the passing quality gate.
