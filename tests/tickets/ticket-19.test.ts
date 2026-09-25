import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("Ticket 19 - Criteria 1: Multi-stage Dockerfile based on official Playwright base image", () => {
  const dockerfilePath = path.resolve(process.cwd(), "Dockerfile");
  assert.ok(fs.existsSync(dockerfilePath), "Dockerfile must exist at repository root");

  const dockerfile = fs.readFileSync(dockerfilePath, "utf8");
  assert.match(
    dockerfile,
    /FROM\s+mcr\.microsoft\.com\/playwright:v1\.63\.0-noble/,
    "Dockerfile must use mcr.microsoft.com/playwright:v1.63.0-noble base image"
  );
});

test("Ticket 19 - Criteria 2: Installs Node >= 22 dependencies via npm ci and builds", () => {
  const dockerfilePath = path.resolve(process.cwd(), "Dockerfile");
  if (!fs.existsSync(dockerfilePath)) {
    assert.fail("Dockerfile does not exist");
  }
  const dockerfile = fs.readFileSync(dockerfilePath, "utf8");
  assert.match(dockerfile, /npm ci/, "Dockerfile must run npm ci");
  assert.match(dockerfile, /npm run build/, "Dockerfile must run npm run build");
});

test("Ticket 19 - Criteria 3: Drops root privileges to run as unprivileged pwuser", () => {
  const dockerfilePath = path.resolve(process.cwd(), "Dockerfile");
  if (!fs.existsSync(dockerfilePath)) {
    assert.fail("Dockerfile does not exist");
  }
  const dockerfile = fs.readFileSync(dockerfilePath, "utf8");
  assert.match(dockerfile, /USER\s+pwuser/, "Dockerfile must specify USER pwuser");
});

test("Ticket 19 - Criteria 4: .dockerignore properly excludes local node_modules and data artifacts", () => {
  const dockerignorePath = path.resolve(process.cwd(), ".dockerignore");
  assert.ok(fs.existsSync(dockerignorePath), ".dockerignore must exist at repository root");
  const dockerignore = fs.readFileSync(dockerignorePath, "utf8");
  assert.match(dockerignore, /node_modules/, ".dockerignore must exclude node_modules");
});
