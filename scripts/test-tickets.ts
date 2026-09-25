import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SCRAPER_TICKETS, type TicketDefinition } from "./harness/tickets.js";

const args = process.argv.slice(2);

function formatId(raw: string): string {
  const clean = raw.replace(/^ticket-?/i, "").trim();
  return clean.padStart(2, "0");
}

function runSingleTicket(ticket: TicketDefinition, verbose = true): { passed: boolean; output: string } {
  const testPath = path.resolve(process.cwd(), ticket.testFile);

  if (!fs.existsSync(testPath)) {
    if (verbose) {
      console.log(`\n========================================================================`);
      console.log(`[VALIDATION GATE] ${ticket.title}`);
      console.log(`========================================================================`);
      console.log(`Objective: ${ticket.objective}`);
      console.log(`Status: Test file not yet created (${ticket.testFile})`);
      console.log(`------------------------------------------------------------------------`);
      console.log(`Acceptance Criteria:`);
      for (const ac of ticket.acceptanceCriteria) {
        console.log(`  [ ] ${ac}`);
      }
      console.log(`------------------------------------------------------------------------`);
      console.log(`GATE RESULT: FAIL (Exit Code: 1)`);
      console.log(`Criteria Met: 0/${ticket.acceptanceCriteria.length}`);
      console.log(`========================================================================\n`);
    }
    return { passed: false, output: `Test file ${ticket.testFile} not found` };
  }

  const result = spawnSync("npx", ["tsx", "--test", ticket.testFile], {
    cwd: process.cwd(),
    encoding: "utf-8",
    shell: true,
  });

  const passed = result.status === 0;
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const fullOutput = stdout + "\n" + stderr;

  if (verbose) {
    console.log(`\n========================================================================`);
    console.log(`[VALIDATION GATE] ${ticket.title}`);
    console.log(`========================================================================`);
    console.log(`Objective: ${ticket.objective}`);
    console.log(`Scope Files: ${ticket.scopeFiles.join(", ")}`);
    console.log(`Test File: ${ticket.testFile}`);
    console.log(`------------------------------------------------------------------------`);
    console.log(`Acceptance Criteria Checklist:`);
    for (const ac of ticket.acceptanceCriteria) {
      // Check if test output passed this criterion
      const mark = passed ? "[x]" : "[ ]";
      console.log(`  ${mark} ${ac}`);
    }
    console.log(`------------------------------------------------------------------------`);
    if (passed) {
      console.log(`GATE RESULT: PASS (Exit Code: 0)`);
      console.log(`All ${ticket.acceptanceCriteria.length} criteria satisfied.`);
    } else {
      console.log(`GATE RESULT: FAIL (Exit Code: 1)`);
      console.log(`Unmet criteria detected. Subprocess test output:`);
      console.log(stderr || stdout);
    }
    console.log(`========================================================================\n`);
  }

  return { passed, output: fullOutput };
}

function runAudit(): void {
  console.log(`\n====================================================================================================`);
  console.log(`                         GRIDLOCK-SCRAPER BACKLOG VALIDATION AUDIT                                  `);
  console.log(`====================================================================================================`);
  console.log(
    ` ${"Ticket".padEnd(8)} | ${"Title".padEnd(52)} | ${"Target".padEnd(11)} | ${"Gate Result".padEnd(11)}`
  );
  console.log(`-${"-".repeat(8)}-|-${"-".repeat(52)}-|-${"-".repeat(11)}-|-${"-".repeat(11)}`);

  let passingCount = 0;

  for (const ticket of SCRAPER_TICKETS) {
    const { passed } = runSingleTicket(ticket, false);
    if (passed) passingCount++;

    const gate = passed ? "PASS [x]" : "FAIL [ ]";
    const truncatedTitle = ticket.title.length > 52 ? ticket.title.substring(0, 49) + "..." : ticket.title;
    console.log(
      ` ${ticket.id.padEnd(8)} | ${truncatedTitle.padEnd(52)} | ${ticket.expectedStatus.padEnd(11)} | ${gate.padEnd(11)}`
    );
  }

  console.log(`====================================================================================================`);
  console.log(`Readiness: ${passingCount} / ${SCRAPER_TICKETS.length} Scraper Backlog Tickets Verified Passing.`);
  console.log(`====================================================================================================\n`);
}

function main(): void {
  if (args.includes("--audit")) {
    runAudit();
    process.exit(0);
  }

  if (args.includes("--all")) {
    let allPassed = true;
    for (const ticket of SCRAPER_TICKETS) {
      const { passed } = runSingleTicket(ticket, true);
      if (!passed) allPassed = false;
    }
    process.exit(allPassed ? 0 : 1);
  }

  const ticketArg = args.find((a) => !a.startsWith("--")) || args[0];
  if (!ticketArg) {
    console.log("Usage:");
    console.log("  npm run test:ticket <id>       Run validation gate for a specific ticket (e.g. 01, 23)");
    console.log("  npm run test:tickets           Run all ticket acceptance gates");
    console.log("  npm run test:tickets:audit     Print backlog compliance audit matrix");
    process.exit(1);
  }

  const targetId = formatId(ticketArg);
  const ticket = SCRAPER_TICKETS.find((t) => t.id === targetId);

  if (!ticket) {
    console.error(`Error: Unknown ticket ID "${ticketArg}". Available IDs: ${SCRAPER_TICKETS.map((t) => t.id).join(", ")}`);
    process.exit(1);
  }

  const { passed } = runSingleTicket(ticket, true);
  process.exit(passed ? 0 : 1);
}

main();
