# Guest Communication Agent (GCA)

A WhatsApp agent for issebya.homes, a real short-term rental business. It talks
to guests directly: pricing, availability, property Q&A, and booking-link
handoff, with a human owner kept in the loop (via `apps/telegram-router`) for
anything that touches money or needs a judgment call the model shouldn't make
alone. Live in production since 2026-07-21, via the Twilio WhatsApp Sandbox.

Stack: Next.js (API routes) + TypeScript, Vercel AI SDK for the model loop,
OpenRouter as the model gateway, Inngest for durable execution,
Supabase/Postgres + pgvector for storage and retrieval, Braintrust for
evals/prompt management/tracing, Vercel Sandbox for isolated code execution,
Twilio for WhatsApp transport, Telegram for owner notifications and approvals.

See `ENGINEERING.md` for the full technical walkthrough: the tool-calling
loop, the durability model, where and why humans intercept the agent, how
generated code is sandboxed, and how the whole thing is evaluated before it
ships.

## Setup and running

See the repo root `README.md` for install, environment variables, and how to
run this app alongside the rest of the monorepo.
