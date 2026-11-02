// The Sentry start-up decision: send only from the production Vercel deploy.
// NODE_ENV is not the gate, because it is "production" on previews too.
// Callers pass the variable in, so this stays plain and testable in node.

export function isSentryEnabled(vercelEnv: string | undefined): boolean {
  return vercelEnv === "production";
}
