import { describe, expect, it } from "vitest";

import {
  DEFAULT_OPTIONS,
  type Deployment,
  parseLsRemoteHeads,
  planProject,
  selectPrunable,
} from "../../../../../scripts/lib/vercel-prune";

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const LIVE = new Set(["develop", "master", "feat/live"]);

function daysAgo(n: number) {
  return NOW - n * 86_400_000;
}

let seq = 0;
function dep(overrides: Partial<Deployment> & { branch?: string | null } = {}): Deployment {
  const { branch = "feat/gone", ...rest } = overrides;
  seq++;
  return {
    uid: `dpl_${seq}`,
    state: "READY",
    target: null,
    created: daysAgo(8),
    meta: branch === null ? {} : { githubCommitRef: branch },
    ...rest,
  };
}

function selectedUids(deployments: Deployment[]) {
  return selectPrunable(deployments, LIVE, NOW, DEFAULT_OPTIONS).map((c) => c.uid);
}

describe("scripts/lib/vercel-prune selectPrunable", () => {
  it("never selects production, whatever its age or state", () => {
    const ready = dep({ target: "production", created: daysAgo(400) });
    const errored = dep({ target: "production", state: "ERROR", created: daysAgo(400) });
    expect(selectedUids([ready, errored])).toEqual([]);
  });

  it("keeps a READY preview younger than maxAgeDays on a deleted branch", () => {
    expect(selectedUids([dep({ created: daysAgo(6) })])).toEqual([]);
  });

  it("selects a READY preview older than maxAgeDays on a deleted branch", () => {
    const d = dep({ created: daysAgo(8) });
    const [candidate] = selectPrunable([d], LIVE, NOW, DEFAULT_OPTIONS);
    expect(candidate).toMatchObject({ uid: d.uid, branch: "feat/gone", reason: "stale-preview" });
  });

  it("keeps the newest READY preview of a live branch but selects its older ones", () => {
    const newest = dep({ branch: "feat/live", created: daysAgo(8) });
    const older = dep({ branch: "feat/live", created: daysAgo(10) });
    expect(selectedUids([older, newest])).toEqual([older.uid]);
  });

  it("selects the newest READY preview of a branch no longer on origin", () => {
    const newest = dep({ branch: "feat/gone", created: daysAgo(8) });
    const older = dep({ branch: "feat/gone", created: daysAgo(10) });
    expect(selectedUids([newest, older]).sort()).toEqual([newest.uid, older.uid].sort());
  });

  it("selects CANCELED and ERROR deployments older than failedMaxAgeDays, regardless of branch", () => {
    const canceledOld = dep({ state: "CANCELED", created: daysAgo(2) });
    const canceledYoung = dep({ state: "CANCELED", created: daysAgo(0.5) });
    const errorOld = dep({ state: "ERROR", created: daysAgo(2) });
    const errorYoung = dep({ state: "ERROR", created: daysAgo(0.5) });
    const canceledLive = dep({ state: "CANCELED", branch: "feat/live", created: daysAgo(2) });

    const candidates = selectPrunable(
      [canceledOld, canceledYoung, errorOld, errorYoung, canceledLive],
      LIVE,
      NOW,
      DEFAULT_OPTIONS,
    );
    expect(candidates.map((c) => c.uid)).toEqual([canceledOld.uid, errorOld.uid, canceledLive.uid]);
    expect(candidates.every((c) => c.reason === "failed")).toBe(true);
  });

  it("never selects in-flight states such as BUILDING", () => {
    expect(selectedUids([dep({ state: "BUILDING", created: daysAgo(30) })])).toEqual([]);
  });

  it("selects an old preview without a githubCommitRef, with a null branch", () => {
    const d = dep({ branch: null, created: daysAgo(8) });
    const [candidate] = selectPrunable([d], LIVE, NOW, DEFAULT_OPTIONS);
    expect(candidate).toMatchObject({ uid: d.uid, branch: null, reason: "stale-preview" });
  });
});

describe("scripts/lib/vercel-prune planProject", () => {
  it("reports a failed listing as an error, never as nothing to delete", () => {
    expect(planProject({ ok: false, error: "500 boom" }, LIVE, NOW, DEFAULT_OPTIONS)).toEqual({
      listed: 0,
      candidates: [],
      error: "500 boom",
    });
  });

  it("counts every listed deployment and selects from them", () => {
    const plan = planProject(
      { ok: true, deployments: [dep({ created: daysAgo(8) }), dep({ created: daysAgo(1) })] },
      LIVE,
      NOW,
      DEFAULT_OPTIONS,
    );
    expect(plan.listed).toBe(2);
    expect(plan.candidates).toHaveLength(1);
    expect(plan.error).toBeUndefined();
  });
});

describe("scripts/lib/vercel-prune parseLsRemoteHeads", () => {
  it("keeps slash-containing branch names and ignores blank lines", () => {
    const output = "abc\trefs/heads/feat/x-adw-1\ndef\trefs/heads/develop\n\n\n";
    expect(parseLsRemoteHeads(output)).toEqual(new Set(["feat/x-adw-1", "develop"]));
  });
});
