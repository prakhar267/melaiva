import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerDirectory = path.join(root, "workers", "app");
const reconcileScript = path.join(root, "scripts", "reconcile-production-deployment.sh");
const workflowPath = path.join(root, ".github", "workflows", "deploy.yml");

const ids = {
  baseline: "00000000-0000-4000-8000-000000000001",
  unrelated: "00000000-0000-4000-8000-000000000002",
  owned: "00000000-0000-4000-8000-000000000003",
  recovery: "00000000-0000-4000-8000-000000000004",
  oldVersion: "10000000-0000-4000-8000-000000000001",
  newVersion: "10000000-0000-4000-8000-000000000002",
  otherVersion: "10000000-0000-4000-8000-000000000003",
};

const runId = "4242";
const runAttempt = "3";
const releaseSha = "a".repeat(40);
const oldVersions = [{ version_id: ids.oldVersion, percentage: 100 }];
const candidateVersions = [{ version_id: ids.newVersion, percentage: 100 }];
const unrelatedVersions = [{ version_id: ids.otherVersion, percentage: 100 }];

function deployment(id, versions, message = "external deployment", order = 0) {
  return {
    id,
    created_on: new Date(Date.UTC(2026, 0, 1, 0, 0, order)).toISOString(),
    versions,
    annotations: { "workers/message": message },
  };
}

function ownedMessage(phase, expected, extra = "") {
  return `melaiva-release phase=${phase}${extra} expected=${expected} sha=${releaseSha} run=${runId} attempt=${runAttempt}`;
}

const mockNpx = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const statePath = process.env.MELAIVA_RECONCILE_MOCK_STATE;
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);

function persist() {
  fs.writeFileSync(statePath, JSON.stringify(state));
}

function appendDeployment(value) {
  state.order += 1;
  state.history.push({
    ...value,
    created_on: new Date(Date.UTC(2026, 0, 1, 0, 0, state.order)).toISOString(),
  });
}

if (args[0] === "wrangler" && args[1] === "deployments" && args[2] === "list") {
  const remaining = [];
  for (const pending of state.pending || []) {
    if (pending.remainingLists === 0) appendDeployment(pending.deployment);
    else remaining.push({ ...pending, remainingLists: pending.remainingLists - 1 });
  }
  state.pending = remaining;
  persist();
  fs.writeSync(1, JSON.stringify(state.history));
  process.exit(0);
}

if (args[0] === "wrangler" && args[1] === "versions" && args[2] === "deploy") {
  for (const value of state.beforeNextDeploy || []) appendDeployment(value);
  state.beforeNextDeploy = [];
  const messageIndex = args.indexOf("--message");
  const message = args[messageIndex + 1];
  const versions = args
    .filter((value) => /^[0-9a-f-]{36}@[0-9]+$/u.test(value))
    .map((value) => {
      const [version_id, percentage] = value.split("@");
      return { version_id, percentage: Number(percentage) };
    });
  state.deployCount += 1;
  const id = "20000000-0000-4000-8000-" + String(state.deployCount).padStart(12, "0");
  appendDeployment({ id, versions, annotations: { "workers/message": message } });
  state.deployCalls.push({ id, versions, message });
  for (const value of state.afterNextDeploy || []) appendDeployment(value);
  state.afterNextDeploy = [];
  persist();
  process.exit(0);
}

process.stderr.write("Unexpected npx invocation: " + args.join(" ") + "\n");
process.exit(2);
`;

async function runReconcile(fixture) {
  const directory = await mkdtemp(path.join(tmpdir(), "melaiva-reconcile-"));
  const statePath = path.join(directory, "state.json");
  const outputPath = path.join(directory, "output.txt");
  const npxPath = path.join(directory, "npx");
  const sleepPath = path.join(directory, "sleep");
  const state = {
    history: fixture.history,
    pending: fixture.pending || [],
    beforeNextDeploy: fixture.beforeNextDeploy || [],
    afterNextDeploy: fixture.afterNextDeploy || [],
    deployCalls: [],
    deployCount: 0,
    order: Math.max(...fixture.history.map((item) => Number(item.created_on.slice(17, 19))), 0),
  };

  try {
    await writeFile(statePath, JSON.stringify(state));
    await writeFile(npxPath, mockNpx);
    await writeFile(sleepPath, "#!/bin/sh\nexit 0\n");
    await chmod(npxPath, 0o755);
    await chmod(sleepPath, 0o755);
    const result = spawnSync("bash", [reconcileScript], {
      cwd: workerDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        GITHUB_OUTPUT: outputPath,
        GITHUB_RUN_ATTEMPT: runAttempt,
        GITHUB_RUN_ID: runId,
        MELAIVA_RECONCILE_INITIAL_SETTLE_SECONDS: fixture.initialSettleSeconds || "0",
        MELAIVA_RECONCILE_MOCK_STATE: statePath,
        MELAIVA_RECONCILE_STABILITY_INTERVAL_SECONDS: "1",
        MELAIVA_RECONCILE_STABILITY_OBSERVATIONS: "2",
        NEW_VERSION_ID: ids.newVersion,
        OLD_DEPLOYMENT_ID: ids.baseline,
        OLD_VERSION_ID: ids.oldVersion,
        OLD_VERSIONS_JSON: JSON.stringify(oldVersions),
        RELEASE_SHA: releaseSha,
      },
      timeout: 10_000,
    });
    const finalState = JSON.parse(await readFile(statePath, "utf8"));
    const outputs = result.status === 0 ? await readFile(outputPath, "utf8") : "";
    return { ...result, finalState, outputs };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("corrects wrong preserve versions using the persisted displaced target", async () => {
  const baseline = deployment(ids.baseline, oldVersions, "baseline", 1);
  const unrelated = deployment(ids.unrelated, unrelatedVersions, "external U", 2);
  const owned = deployment(ids.owned, candidateVersions, ownedMessage("cutover", ids.baseline), 3);
  const wrongRecovery = deployment(
    ids.recovery,
    candidateVersions,
    ownedMessage("reconcile", ids.owned, ` mode=preserve target=${ids.unrelated}`),
    4,
  );
  const result = await runReconcile({ history: [baseline, unrelated, owned, wrongRecovery] });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.outputs, /state=preserved/u);
  assert.deepEqual(result.finalState.deployCalls.at(-1).versions, unrelatedVersions);
  assert.match(result.finalState.deployCalls.at(-1).message, new RegExp(`target=${ids.unrelated}`, "u"));
});

test("restores U when U lands between the reconcile read and write", async () => {
  const baseline = deployment(ids.baseline, oldVersions, "baseline", 1);
  const owned = deployment(ids.owned, candidateVersions, ownedMessage("cutover", ids.baseline), 2);
  const unrelated = deployment(ids.unrelated, unrelatedVersions, "external U", 3);
  const result = await runReconcile({ history: [baseline, owned], beforeNextDeploy: [unrelated] });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.outputs, /state=preserved/u);
  assert.equal(result.finalState.deployCalls.length, 2);
  assert.deepEqual(result.finalState.deployCalls.at(-1).versions, unrelatedVersions);
});

test("preserves U when U lands after the reconcile write", async () => {
  const baseline = deployment(ids.baseline, oldVersions, "baseline", 1);
  const owned = deployment(ids.owned, candidateVersions, ownedMessage("cutover", ids.baseline), 2);
  const unrelated = deployment(ids.unrelated, unrelatedVersions, "external U", 3);
  const result = await runReconcile({ history: [baseline, owned], afterNextDeploy: [unrelated] });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.outputs, /state=unrelated/u);
  assert.equal(result.finalState.history.at(-1).id, ids.unrelated);
});

test("an unrelated deployment of the exact candidate remains candidate-semantic", async () => {
  const candidate = deployment(ids.unrelated, candidateVersions, "external same candidate", 1);
  const result = await runReconcile({ history: [candidate] });
  const workflow = await readFile(workflowPath, "utf8");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.outputs, /state=unrelated/u);
  assert.equal(result.finalState.deployCalls.length, 0);
  assert.match(workflow, /if candidate_is_active "\$\{before_worker_versions\}"; then\s+desired_release_sha="\$\{RELEASE_SHA\}"/u);
});

test("baseline stabilization notices and rolls back a late-visible cutover", async () => {
  const baseline = deployment(ids.baseline, oldVersions, "baseline", 1);
  const lateCutover = deployment(ids.owned, candidateVersions, ownedMessage("cutover", ids.baseline), 2);
  const result = await runReconcile({
    history: [baseline],
    initialSettleSeconds: "60",
    pending: [{ remainingLists: 1, deployment: lateCutover }],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.outputs, /state=baseline/u);
  assert.equal(result.finalState.deployCalls.length, 1);
  assert.deepEqual(result.finalState.deployCalls[0].versions, oldVersions);
});
