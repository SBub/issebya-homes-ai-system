# Patch: Fix the sandbox `checkAvailability` date regex mangled by template-literal escaping

## Metadata

adw_id: `d7d0c40c`
review_change_request: `Issue #1: Step 8's sandbox mirror is emitted with a broken regex, so run_code's checkAvailability now refuses every date instead of only bad ones. In apps/guest-communication-agent/src/agent/tools/sandbox.ts:166 the new isCalendarDate shim is written inside an untagged template literal as /^\d{4}-\d{2}-\d{2}$/. In a template literal \d is a NonEscapeCharacter, so it collapses to a bare d and the script actually shipped into the remote VM contains /^d{4}-d{2}-d{2}$/, which matches only the string dddd-dd-dd. Confirmed empirically: isCalendarDate("2026-10-11") returns false, so tools.checkAvailability returns { available: false, reason: "invalid_date", ... } for every call and never reaches the GET /api/availability?room= fetch. Resolution: escape the regex for the template literal (or build it without backslashes), and add a test to apps/guest-communication-agent/tests/agent/tools/sandbox.test.ts that asserts the generated shim's behaviour, not just its text, by exporting buildScript and evaluating the emitted checkAvailability with fetch stubbed and the clock pinned to 2026-09-21. Severity: blocker`

## Issue Summary

**Original Spec:** `specs/issue-87-adw-d7d0c40c-sdlc_planner-reject-past-dates-booking.md`

**Issue:** Step 8 mirrored `stay-range.ts`'s date guard into the Vercel Sandbox
script that `sandbox.ts`'s `buildScript` generates. That script is assembled in
an **untagged template literal**, where `\d` is a `NonEscapeCharacter` and
collapses to a bare `d`. The `isCalendarDate` shim at
`apps/guest-communication-agent/src/agent/tools/sandbox.ts:166` is therefore
shipped into the remote VM as `/^d{4}-d{2}-d{2}$/`, which matches only the
literal string `dddd-dd-dd`. Verified by evaluating the emitted source: every
real date fails the test, so `tools.checkAvailability` returns
`{ available: false, reason: "invalid_date", ... }` for **every** call and never
reaches the `GET /api/availability?room=` fetch.

This makes `run_code` — the tool the `date-resolution-vague-*` eval rows expect
the model to reach for — strictly worse than before this branch, where valid
dates worked. `run-code.ts`'s `sandboxApi.checkAvailability` closure does **not**
save it: it is only used to gate `requested.has("checkAvailability")` inside
`buildScript`, never executed in the VM. Nothing caught it — `sandbox.test.ts`'s
two tests both concern the `sandbox.stop` teardown span, so no test ever
inspects or runs the generated script, and typecheck/lint/prettier cannot see
inside a string literal.

**Solution:** Two targeted changes, both inside
`apps/guest-communication-agent`:

1. Write the shim's pattern with **no backslashes at all** —
   `/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/` — so the template literal has nothing to
   mangle and the emitted script keeps real character classes. (The `\\d`
   double-backslash form works too but re-arms the same trap for the next
   editor; the `[0-9]` form is escape-proof by construction.)
2. Export `buildScript` from `sandbox.ts` and add a test that **evaluates** the
   generated `checkAvailability` with `fetch` stubbed and the clock pinned to
   2026-09-21, asserting it mirrors `computeCheckAvailability` on four inputs.
   That test fails against today's code and pins the sync `sandbox.ts`'s own
   top-of-file comment asks for.

## Files to Modify

Use these files to implement the patch:

- `apps/guest-communication-agent/src/agent/tools/sandbox.ts` — fix the shim's
  regex; export `buildScript`.
- `apps/guest-communication-agent/tests/agent/tools/sandbox.test.ts` — add a
  behavioural test for the generated `checkAvailability` shim.

No other file changes. Do **not** touch `stay-range.ts`, `availability.ts`,
`booking.ts` or `run-code.ts` — their guards are correct; only the sandbox
mirror of the guard is broken.

## Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Fix the mangled regex in the generated shim

- In `apps/guest-communication-agent/src/agent/tools/sandbox.ts`, inside
  `buildScript`'s `checkAvailability` template literal, replace the line
  `      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;`
  with
  `      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;`
- `[0-9]` is exactly equivalent to `\d` for this pattern and contains no
  backslash, so the untagged template literal cannot alter it.
- Scan the rest of `buildScript`'s template literals for any other backslash
  escape that is not already doubled. The only current one is `getPricing`'s
  `\\"` in its `throw new Error(...)` string, which is already correct — leave
  it alone.

### Step 2: Record the landmine at its canonical spot

- Add one terse comment directly above the changed line explaining why the
  character class is spelled `[0-9]`, e.g.:
  `// LANDMINE: this script is built in an untagged template literal, where \d`
  `// is a NonEscapeCharacter and silently collapses to a bare "d". Spelled as`
  `// a [0-9] class so there is no backslash to lose.`
- Per `apps/guest-communication-agent/AGENTS.md`: state the fact plainly, no
  narrative/changelog shape ("previously this was...", "as of DATE..."). Three
  lines is the ceiling here.

### Step 3: Export `buildScript` so the generated script is testable

- Change `async function buildScript(` to `export async function buildScript(`
  in `apps/guest-communication-agent/src/agent/tools/sandbox.ts`.
- Nothing else changes: `runInSandbox` keeps calling it the same way.
- knip is satisfied because `knip.json` lists `tests/**/*.test.ts` as an entry
  for this workspace, so the new test's import counts as a real consumer of the
  export.

### Step 4: Add a behavioural test for the generated shim

- In `apps/guest-communication-agent/tests/agent/tools/sandbox.test.ts`, add
  `buildScript` to the existing
  `const { runInSandbox } = await import("@/agent/tools/sandbox.js");`
  destructure, and import `computeCheckAvailability` from
  `@/agent/tools/availability.js`.
- Add one new `describe` block, leaving both existing `sandbox.stop` tests
  untouched. It needs a helper that actually runs the emitted script:
  - Call `await buildScript(\`return await tools.checkAvailability(${JSON.stringify(args)});\`, { checkAvailability: () => { throw new Error("in-process closure must not run"); } })`.
The throwing stub doubles as an assertion that the VM-side shim runs, not
`run-code.ts`'s closure — `buildScript`only reads the key name for`checkAvailability`, it never invokes it (only `getPricing` is invoked).
  - Execute it with `new Function(script)()`, having spied
    `process.stdout.write` with `vi.spyOn(process.stdout, "write").mockImplementation(() => true)`.
    The generated program is self-contained ("use strict", its own `logs`/
    `console`/`tools`, one async IIFE) and writes a single
    `__RUNCODE_RESULT__<json>` line.
  - `await vi.waitFor(() => expect(writeSpy).toHaveBeenCalled())`, then take the
    call argument starting with `__RUNCODE_RESULT__`, `JSON.parse` the remainder
    and return its `result` (asserting `ok === true` first, so a thrown shim
    error surfaces as a readable failure).
- Pin the clock with `vi.useFakeTimers({ toFake: ["Date"] })` +
  `vi.setSystemTime(new Date("2026-09-21T12:00:00Z"))` in `beforeEach`, and
  `vi.useRealTimers()` in `afterEach`. Fake **only** `Date` — faking timers
  wholesale would stall `vi.waitFor` and the async IIFE's scheduling.
- Stub the network with `vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ bookings: [] }) })))`,
  and `vi.unstubAllGlobals()` in `afterEach`. Both the shim and
  `computeCheckAvailability` read `NEXT_PUBLIC_SITE_URL`, which `vitest.config.ts`
  already sets to `http://localhost:3000`.
- Assert four cases, each comparing the shim's result **and**
  `await computeCheckAvailability(args)` for the same input, so the test pins
  the mirror rather than restating it:
  1. `{ room: "room1", checkIn: "2026-10-11", checkOut: "2026-10-13" }` → the
     fetch is reached (assert the stub was called once with
     `http://localhost:3000/api/availability?room=room1`) and the result is
     `{ available: true, room: "room1", checkIn: "2026-10-11", checkOut: "2026-10-13" }`.
     This is the assertion that fails today with
     `{ available: false, reason: "invalid_date", ... }`.
  2. `checkIn: "2025-10-11", checkOut: "2025-10-13"` → `reason: "past_date"`,
     and the fetch stub was **not** called.
  3. `checkIn: "2026-10-11", checkOut: "2026-10-11"` → `reason: "invalid_range"`.
  4. `checkIn: "11-10-2026", checkOut: "13-10-2026"` → `reason: "invalid_date"`.
- Cases 2-4 must also carry `today: "2026-09-21"` in the refuse shape, which the
  deep-equality against `computeCheckAvailability` covers for free.

### Step 5: Prove the test catches the bug, then fix-forward

- Run the test suite once with Step 4's test present but Step 1 reverted (or
  simply confirm from the run order that case 1 fails on the unfixed line): case
  1 must FAIL with `reason: "invalid_date"`, proving it exercises the defect.
- Re-apply Step 1 and run the suite again — all four cases and both pre-existing
  `sandbox.stop` tests must pass.

## Validation

Execute every command to validate the patch is complete with zero regressions.

1. `yarn turbo run test --filter=./apps/guest-communication-agent` — the whole
   GCA suite passes, including the four new generated-shim cases and every
   pre-existing availability, stay-range, booking, run-agent-turn, sandbox and
   resolve-route test. Per Step 5, this is also the command that must FAIL on
   case 1 before Step 1 is applied.
2. `yarn turbo run lint --filter=./apps/guest-communication-agent` — lint passes
   for the workspace (note the new test uses `new Function`, so confirm no lint
   rule objects; if one does, scope a narrow disable to that single line rather
   than widening the config).
3. `yarn turbo run typecheck --filter=./apps/guest-communication-agent` — types
   are sound with `buildScript` now exported.
4. `yarn knip` — the new `buildScript` export is not reported unused, and no
   unused file or dependency was introduced.
5. `yarn prettier --check .` then
   `yarn turbo run build --filter=./apps/guest-communication-agent` —
   formatting matches the repo config so the commit hook will not reject it, and
   the production build still succeeds.

## Patch Scope

**Lines of code to change:** ~4 lines in `sandbox.ts` (one regex, one 3-line
landmine comment, one `export` keyword) plus ~90 lines of new test in
`sandbox.test.ts`.

**Risk level:** low — the source change is one character class inside a
generated-script string with no type or API surface impact; the rest is new test
coverage. The only new export is consumed by that test.

**Testing required:** The new `sandbox.test.ts` block must fail on the unfixed
regex and pass after the fix, and must assert the shim's _behaviour_ (evaluated
output) rather than the text of the generated script — text assertions are what
would let the identical escaping bug recur. All five other validation commands
from the original spec already pass on this branch and must keep passing.
