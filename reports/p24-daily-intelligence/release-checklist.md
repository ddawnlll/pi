# P24 Release Checklist

**Date:** 2026-05-25
**Author:** Automated agent

---

## Pre-Release Checks

### 1. TypeScript Build
- [x] `packages/coding-agent` — `npx tsc --noEmit` clean
- [x] `packages/web-ui/dashboard` — `npx tsc --noEmit` clean
- [x] `packages/ai` — `npx tsc --noEmit` clean
- [x] `packages/tui` — pre-existing issues only (excluded from gate)

### 2. Tests
- [x] Pre-existing integration-queue tests: ALL PASS
- [x] Pre-existing dashboard hooks tests: ALL PASS
- [x] New P24 daily intelligence test: PASS
- [x] New DigestPage component test: PASS
- [x] All test files verified: LOADING / EMPTY / ERROR / SUCCESS states handled

### 3. CHANGELOGs
- [x] `packages/ai/CHANGELOG.md` — Updated under `[Unreleased]`
- [x] `packages/coding-agent/CHANGELOG.md` — Updated under `[Unreleased]`
- [x] `packages/web-ui/CHANGELOG.md` — Updated under `[Unreleased]`
- [x] No existing released sections modified

### 4. Documentation
- [x] `packages/ai/README.md` — Provider table current, env vars documented
- [x] `packages/coding-agent/README.md` — Provider setup instructions current
- [x] `packages/coding-agent/docs/providers.md` — Setup instructions, env vars, auth.json keys documented

### 5. Provider Coverage
- [x] All built-in providers registered in `register-builtins.ts`
- [x] Model generation script up-to-date (`generate-models.ts`)
- [x] Provider display names configured in `provider-display-names.ts`
- [x] Default models configured in `model-resolver.ts`

### 6. Safety & Security
- [x] No `.env*` files read or modified
- [x] No `**/*.pem`, `**/*.key`, `**/*.p12`, `**/*.pfx` files accessed
- [x] No `**/id_rsa` paths accessed
- [x] No `**/credentials/**` or `**/secrets/**` paths accessed
- [x] All API keys use environment variable pattern (`process.env.XXX_API_KEY`)
- [x] No hardcoded secrets in code

### 7. Git Hygiene
- [x] No `--watch` mode used in validation
- [x] No `git push` operations performed
- [x] No `git add -A` or `git add .` (staged only specific files)
- [x] No force push to main
- [x] All commits are atomic, one concern per commit

### 8. Reports
- [x] `reports/p24-daily-intelligence/dogfood-report.md` — Created
- [x] `reports/p24-daily-intelligence/trust-calibration.md` — Created
- [x] `reports/p24-daily-intelligence/release-checklist.md` — Created

---

## Release Gate Summary

| Gate | Status |
|------|--------|
| TypeScript Build | PASS |
| Tests | PASS |
| CHANGELOGs | PASS |
| Documentation | PASS |
| Provider Coverage | PASS |
| Safety & Security | PASS |
| Git Hygiene | PASS |
| Reports | PASS |

**Verdict: RELEASE READY** — All pre-release checks pass. P24 is ready for release.
