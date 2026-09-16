# Conditional Documentation

An index of this repository's reference documentation, keyed by **when to read it**.

Agents consult this file before planning or implementing and read only the entries
whose conditions match the task in hand. Reading everything wastes context; reading
nothing repeats mistakes that were already solved and written down here.

`/document` appends an entry to this file whenever it creates new documentation.

## How to use

1. Identify the workspace your change belongs to.
2. Read that workspace's `AGENTS.md` — always, no conditions.
3. Scan the conditions below and read only what matches.
4. Paths are relative to the repository root.

Out of scope for this index: operational runbooks in `docs/*-sop.md` (human
procedures, not code documentation) and anything gitignored.

---

## Always

- `AGENTS.md`
  - Conditions:
    - Before any change, without exception
    - Covers: yarn-only, conventional commits, no `Co-Authored-By`, lefthook, the four-file doc convention

- `README.md`
  - Conditions:
    - When you need the cross-app picture: which app owns what, and how a guest request flows between them

---

## apps/website

- `apps/website/AGENTS.md` — always, for any change under `apps/website/`
- `apps/website/ENGINEERING.md`
  - Conditions:
    - When changing availability, booking persistence, or the iCal merge
    - When you need to know why a page renders the way it does before changing it

- `apps/website/app_docs/nextjs-patterns-guide.md`
  - Conditions:
    - When adding or changing a route, layout, Server Component, or Server Action
    - When deciding between server and client rendering

- `apps/website/app_docs/data-fetching-client.md`
  - Conditions:
    - When reading data in a Server Component or mutating it in a Server Action
    - When tempted to fetch from a Client Component

- `apps/website/app_docs/component-patterns-guide.md`
  - Conditions:
    - When creating a component, or when the same JSX appears more than once

- `apps/website/app_docs/client-form-guide.md`
  - Conditions:
    - When building or changing any form
    - When using `useActionState`

- `apps/website/app_docs/form-re-render-strategy.md`
  - Conditions:
    - When a form re-renders more than expected, loses input, or feels slow
    - Read alongside `apps/website/app_docs/client-form-guide.md` before changing form state

- `apps/website/app_docs/zod-validation-guide.md`
  - Conditions:
    - When validating input on either side of the wire
    - When adding a schema or changing an existing one

- `apps/website/app_docs/import-patterns-guide.md`
  - Conditions:
    - When adding imports — destructured, not namespace, for tree-shaking

- `apps/website/app_docs/dynamic-url-construction.md`
  - Conditions:
    - When building a URL in an API route or a redirect
    - IMPORTANT: read before hardcoding any base URL

- `apps/website/app_docs/environment-setup.md`
  - Conditions:
    - When adding, renaming, or reading an environment variable

- `apps/website/app_docs/branding-guidelines.md`
  - Conditions:
    - When writing guest-facing copy, or touching brand name, colours, or tone

- `apps/website/app_docs/screenshot-mockup-guidelines.md`
  - Conditions:
    - When an issue arrives with a screenshot or mockup attached

- `apps/website/app_docs/database/database-interaction-rules.md`
  - Conditions:
    - When reading from or writing to the database
    - When adding a table, column, or query
    - IMPORTANT: read before writing any migration

- `apps/website/app_docs/database/production-migrations.md`
  - Conditions:
    - When a schema change has to reach production

- `apps/website/app_docs/testing/unit_test_spec_format.md`
  - Conditions:
    - When writing or specifying a unit test

- `apps/website/app_docs/testing/component_test_spec_format.md`
  - Conditions:
    - When writing or specifying a component test

- `apps/website/app_docs/testing/e2e_example.md`
  - Conditions:
    - When adding a Playwright spec under `apps/website/e2e/`
    - Note: `apps/website/app_docs/testing/e2e_runner.md` describes an agent-driven MCP browser flow that this repo does not currently use — prefer the code-based Playwright specs

- `apps/website/app_docs/feature-83f21219-airbnb-link-replaces-review-carousel.md`
  - Conditions:
    - When touching the booking page's `ROOM_CONTENT` map or per-room outbound links
    - When adding another simple outbound `"use client"` link component with a PostHog click capture (follow `AirbnbLink.tsx`/`WhatsAppLink.tsx`, not a new pattern)
    - When tempted to reintroduce hardcoded review/testimonial content on the website

---

## apps/guest-communication-agent

- `apps/guest-communication-agent/AGENTS.md` — always, for any change under that app
- `apps/guest-communication-agent/README.md`
  - Conditions:
    - When you need the stack and what the agent is responsible for

- `apps/guest-communication-agent/ENGINEERING.md`
  - Conditions:
    - When changing the agent loop, a tool, memory, or retrieval
    - When touching a human-in-the-loop gate or an Inngest function
    - IMPORTANT: read before changing anything that can suspend a run

---

## apps/telegram-router

- `apps/telegram-router/AGENTS.md`
  - Conditions:
    - Always, for any change under that app
    - Covers the two correlation mechanisms, the two auth mechanisms, the always-200 rule, and why there is no dedup check
    - IMPORTANT: this app deliberately has no ENGINEERING file. It is a thin dispatcher of eight source files; the README covers the routes and the source carries file-level walkthroughs in its JSDoc

- `apps/telegram-router/README.md`
  - Conditions:
    - When changing either route, or when you need the correlation-id scheme

---

## packages/pricing

- `packages/pricing/AGENTS.md` — always, for any change under that package
- `packages/pricing/README.md`
  - Conditions:
    - When anything reads or changes a price, a tourist tax, or a fee
    - This package is one exported constant; read the README rather than guessing at the shape

---

## Cross-cutting constraints

- `scripts/dev-webhook-gateway.ts` (read the file header)
  - Conditions:
    - IMPORTANT: before changing any app's port, or adding an inbound webhook
    - One reserved ngrok hostname fronts the gateway on 3010 and routes by path prefix to 3005 and 3003. Ports 3000, 3003 and 3005 are a contract with Twilio and Telegram and must not move

- `supabase/config.toml`
  - Conditions:
    - When changing local database configuration
    - The repository runs a single shared local database. Never plan a reset
