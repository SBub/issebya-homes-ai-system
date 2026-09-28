import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, "../../../../../scripts/vercel-ignore.sh");

const ADW_REF = "feat/issue-1-adw-abc12345-x";
const SKIP = 0;
const BUILD = 1;

/** Runs git in `cwd` with an inline identity, independent of the machine's git config. */
function git(cwd: string, ...args: string[]) {
  const result = spawnSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
    { cwd },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

describe("scripts/vercel-ignore.sh", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vercel-ignore-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Builds the env from scratch so a VERCEL_* variable in the developer's shell can't leak in. */
  function run(env: Record<string, string>) {
    return spawnSync("bash", [script], {
      cwd: dir,
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ...env },
    }).status;
  }

  /** Makes `dir` a git repo whose HEAD commit has the given message paragraphs. */
  function commit(...messages: string[]) {
    git(dir, "init", "-q");
    git(dir, "commit", "--allow-empty", "-q", ...messages.flatMap((m) => ["-m", m]));
  }

  it("exists at the repo root", () => {
    expect(existsSync(script)).toBe(true);
  });

  it("skips a plain commit on an ADW branch", () => {
    commit("feat: x");
    expect(run({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: ADW_REF })).toBe(SKIP);
  });

  it("builds a commit marked with the Deploy-Preview trailer on an ADW branch", () => {
    commit("docs: x", "Deploy-Preview: yes");
    expect(run({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: ADW_REF })).toBe(BUILD);
  });

  it("builds a plain commit on a non-ADW branch", () => {
    commit("feat: x");
    expect(run({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "develop" })).toBe(BUILD);
  });

  it("builds when the ref is empty (dashboard redeploy or CLI deploy)", () => {
    commit("feat: x");
    expect(run({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "" })).toBe(BUILD);
  });

  it("always builds production, even on an ADW branch", () => {
    commit("feat: x");
    expect(run({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: ADW_REF })).toBe(BUILD);
  });

  it("skips when the trailer text is not at the start of a line", () => {
    commit("docs: mention Deploy-Preview: yes in text");
    expect(run({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: ADW_REF })).toBe(SKIP);
  });

  it("falls back to VERCEL_GIT_COMMIT_MESSAGE outside a git repo", () => {
    const env = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: ADW_REF };
    expect(run({ ...env, VERCEL_GIT_COMMIT_MESSAGE: "docs: x\n\nDeploy-Preview: yes" })).toBe(
      BUILD,
    );
    expect(run({ ...env, VERCEL_GIT_COMMIT_MESSAGE: "feat: x" })).toBe(SKIP);
  });
});
