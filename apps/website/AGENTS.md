<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

## Development guidelines

- TypeScript only, functional components with hooks
- Server components by default, `'use client'` only when the browser must handle state (calendar, gallery swipe, form inputs)
- Next.js `<Image>` for all images
- Zod validation at all API boundaries
- No Radix UI, not installed

<!-- END:nextjs-agent-rules -->
