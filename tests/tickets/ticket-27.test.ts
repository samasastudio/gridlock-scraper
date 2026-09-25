import assert from "node:assert/strict";
import test from "node:test";
import { parseMunicipalAgenda } from "../../src/parsers/municipal.js";

test("Ticket 27 - Criteria 1 & 2: Eliminates synthetic fallback to 'under_review' when .action-status is missing", () => {
  const htmlMissingStatus = `
    <div class="agenda-item">
      <div class="action-identifier">C14-2024-001</div>
      <div class="jurisdiction">Austin</div>
      <div class="action-title">Substation Rezoning</div>
      <!-- No .action-status element -->
    </div>
  `;

  // Without fallback, missing status fails Zod invariants and throws error
  assert.throws(
    () => {
      parseMunicipalAgenda(htmlMissingStatus);
    },
    /status/i,
    "Missing action-status must fail validation rather than defaulting to 'under_review'"
  );
});

test("Ticket 27 - Criteria 3: Rejects invalid or unmapped statuses", () => {
  const htmlInvalidStatus = `
    <div class="agenda-item">
      <div class="action-identifier">C14-2024-002</div>
      <div class="jurisdiction">Austin</div>
      <div class="action-title">Substation Rezoning</div>
      <div class="action-status">invalid_gibberish_status</div>
    </div>
  `;

  assert.throws(
    () => {
      parseMunicipalAgenda(htmlInvalidStatus);
    },
    /status/i,
    "Invalid status value must fail validation rather than defaulting to 'under_review'"
  );
});
