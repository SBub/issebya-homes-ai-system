import { Inngest } from "inngest";

// GCA's durable-execution boundary. Replaces @dbos-inc/dbos-sdk (see this
// app's git history for the migration) — every real side effect in a guest
// turn (model calls, tool calls, the missing_info suspend/resume) is now
// checkpointed via this client's step tools (step.run/step.waitForEvent),
// not DBOS.runStep/recv/send.
//
// INNGEST_DEV=1 is set in package.json's `dev` script — v4 defaults to Cloud
// mode, which makes the /api/inngest serve endpoint 500 locally without a
// signing key. No INNGEST_EVENT_KEY/INNGEST_SIGNING_KEY needed for local dev
// (Dev Server doesn't validate them); those are prod-only and out of scope
// for this migration pass.
export const inngest = new Inngest({ id: "guest-communication-agent" });
