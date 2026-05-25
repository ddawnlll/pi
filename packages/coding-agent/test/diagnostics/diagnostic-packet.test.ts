/**
 * Tests for Diagnostic Packet and Evidence Model - Workspace 25.E
 *
 * This test delegates to the authoritative test file for the core
 * implementation. All diagnostic packet tests are defined in
 * ../diagnostic-packet.test.ts and imported here via vitest's
 * support for importing test files.
 *
 * Acceptance criteria:
 * 1. Diagnostic packets carry evidence-backed diagnostics (no silent errors)
 * 2. Evidence model supports categories with structured data
 * 3. Budget enforcement limits evidence accumulation
 * 4. Cooldown prevents rapid re-emission
 * 5. Deduplication via content hashing
 * 6. Stop condition tracking
 * 7. Packet serialization and integrity verification
 * 8. Evidence collection from failure classification, scheduling, and agent results
 * 9. Packet compaction within budget
 * 10. All autonomous behavior has explicit budget, cooldown, dedupe, stop-condition handling
 */

// Import the authoritative test suite to verify it still works when
// referenced from the diagnostics module path
import "../diagnostic-packet.test.js";
