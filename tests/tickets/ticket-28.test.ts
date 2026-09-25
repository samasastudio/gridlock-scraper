import assert from "node:assert/strict";
import test from "node:test";
import { parseMunicipalAgenda } from "../../src/parsers/municipal.js";

test("Ticket 28 - Criteria 1 & 2: Dynamically classifies municipal action type from .action-type element", () => {
  const htmlAnnexation = `
    <div class="agenda-item">
      <div class="action-identifier">C14-2024-009</div>
      <div class="jurisdiction">Austin</div>
      <div class="action-title">Annexation of 500 Acres for Tech Park</div>
      <div class="action-type">annexation</div>
      <div class="action-status">approved</div>
    </div>
  `;

  const observations = parseMunicipalAgenda(htmlAnnexation);
  const actionObs = observations.find((o) => o.property.includes("action"));
  assert.ok(actionObs, "Must extract action observation");
  assert.equal((actionObs?.valueJson as any).actionType, "annexation", "Must extract dynamic actionType 'annexation' instead of hardcoded 'zoning'");
});

test("Ticket 28 - Criteria 3: Fails validation on unclassifiable or missing action types without fallback", () => {
  const htmlMissingType = `
    <div class="agenda-item">
      <div class="action-identifier">C14-2024-010</div>
      <div class="jurisdiction">Austin</div>
      <div class="action-title">Unknown Generic Council Discussion</div>
      <div class="action-status">approved</div>
    </div>
  `;

  assert.throws(
    () => {
      parseMunicipalAgenda(htmlMissingType);
    },
    /actionType|action_type/i,
    "Missing action-type must fail validation without falling back to 'zoning'"
  );
});
