import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(root, ".github", "workflows", "deploy.yml");

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("hosted production release is a read-only validation that fails closed", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /^name: Validate production release \(hosted promotion disabled\)$/mu);
  assert.match(workflow, /permissions:\s+actions: read\s+checks: read\s+contents: read/u);
  assert.doesNotMatch(workflow, /contents: write/u);
  assert.doesNotMatch(workflow, /environment:\s*(?:\n\s+name:\s*)?production/u);
  assert.doesNotMatch(workflow, /CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/u);
  assert.doesNotMatch(workflow, /secrets\./u);
  assert.match(workflow, /persist-credentials: false/u);

  assert.doesNotMatch(workflow, /wrangler versions (?:upload|deploy)/u);
  assert.doesNotMatch(workflow, /git push/u);
  const wranglerDeployLines = workflow
    .split("\n")
    .filter((line) => line.includes("wrangler deploy"));
  assert.equal(wranglerDeployLines.length, 2);
  for (const line of wranglerDeployLines) assert.match(line, /--dry-run/u);

  assert.match(workflow, /Smoke current default production traffic without an override/u);
  assert.doesNotMatch(workflow, /MELAIVA_SMOKE_WORKER_VERSION_OVERRIDE/u);
  assert.match(workflow, /HOSTED_PRODUCTION_PROMOTION_DISABLED/u);
  assert.match(workflow, /Do not treat this run as deployment evidence\./u);
  assert.match(workflow, /\n\s+exit 1\s*$/u);
});

test("no workflow or package shortcut can bypass the local production release gates", async () => {
  const [ciWorkflow, monitorWorkflow, workerPackage, workerReadme] = await Promise.all([
    read(".github/workflows/ci.yml"),
    read(".github/workflows/monitor-production.yml"),
    read("workers/app/package.json"),
    read("workers/app/README.md"),
  ]);
  const allWorkflows = [await read(".github/workflows/deploy.yml"), ciWorkflow, monitorWorkflow].join("\n");
  const scripts = JSON.parse(workerPackage).scripts;

  assert.equal(scripts.deploy, undefined);
  assert.doesNotMatch(workerReadme, /npm run deploy/u);
  assert.doesNotMatch(allWorkflows, /api\.cloudflare\.com[^\n]*\/deployments/u);
  assert.doesNotMatch(allWorkflows, /git (?:push|update-ref)/u);

  const hostedWranglerMutations = allWorkflows
    .split("\n")
    .filter((line) => /wrangler (?:deploy(?:\s|$)|versions (?:upload|deploy)(?:\s|$))/u.test(line))
    .filter((line) => !line.includes("--dry-run"));
  assert.equal(hostedWranglerMutations.length, 1);
  assert.match(hostedWranglerMutations[0], /wrangler deploy --env staging/u);
});

test("release documentation names the local-only path and re-enable conditions", async () => {
  const [readme, architecture, checklist] = await Promise.all([
    read("README.md"),
    read("docs/ARCHITECTURE.md"),
    read("docs/GO_LIVE_CHECKLIST.md"),
  ]);

  for (const document of [readme, architecture, checklist]) {
    assert.match(document, /hosted production promotion is disabled/iu);
    assert.match(document, /authenticated local release/iu);
  }
  assert.match(readme, /system-tools-only finalizer and downstream reconciler/iu);
  assert.match(architecture, /no checkout, package install, or third-party executable/iu);
  assert.match(checklist, /default production traffic/iu);
});
