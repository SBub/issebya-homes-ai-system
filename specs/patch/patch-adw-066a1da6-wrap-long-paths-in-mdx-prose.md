# Patch: Wrap long unbroken tokens in MDX prose so doc pages do not scroll horizontally on mobile

## Metadata

adw_id: `066a1da6`
review_change_request: `Issue #1: Mobile (375x667, and also 390x844): the doc pages scroll horizontally. On /p/server-prefetch-hydration, document.documentElement.scrollWidth is 400 against a clientWidth of 375 (400 vs 390 at 390px). On /p/infinite-scrolling it is 383 vs 375. Hiding elements one at a time traced the cause to the 'Excerpt from apps/website/src/app/(main)/shop/ui/ShopProducts.tsx, trimmed.' paragraph and its siblings. The long repo path has no break opportunity, so the text runs past its <p>. The code blocks are fine: each <pre> scrolls inside its own box. Spec step 13 says to 'Confirm no horizontal page scroll at 390 px', so that criterion fails. Resolution: On this branch, let long unbroken tokens wrap in MDX prose. In apps/patterns/src/mdx-components.tsx, add break-words (or [overflow-wrap:anywhere]) to the p mapping, and ideally to li and inline code as well, since paths also appear in list items. Rebuild and confirm that document.documentElement.scrollWidth equals clientWidth at 375 and 390 px on all three /p/<slug> pages. Severity: blocker`

## Issue Summary

**Original Spec:** `specs/issue-189-adw-066a1da6-sdlc_planner-patterns-library-app.md`
**Issue:** On `/p/<slug>` pages at 375 px and 390 px the page scrolls horizontally (scrollWidth 400 or 383 against clientWidth 375/390). Every code excerpt is preceded by a prose line `Excerpt from <repo path>, trimmed.` (required by `apps/patterns/AGENTS.md`). A repo path such as `apps/website/src/app/(main)/shop/ui/ShopProducts.tsx` has no break opportunity, so it overflows its `<p>` and widens the document. Paths also appear in list items and inline `code`. This fails spec step 13 ("Confirm no horizontal page scroll at 390 px").
**Solution:** Allow long unbroken tokens to wrap in MDX prose. In `apps/patterns/src/mdx-components.tsx`, add the Tailwind arbitrary property `[overflow-wrap:anywhere]` to the `p`, `li` and inline `code` mappings. Use `anywhere`, not `break-words` (`overflow-wrap: break-word`): `anywhere` also lowers the element's min-content width, so a path inside an inline `<code>` or a flex/grid ancestor cannot still force the track wider. Leave the rehype-pretty-code block branch (`data-language`) untouched, since its `<pre>` already scrolls inside its own box and wrapping would break code layout.

## Files to Modify

Use these files to implement the patch:

- `apps/patterns/src/mdx-components.tsx`

## Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Let paragraphs wrap long tokens

- In the `p` mapping, change the className from `text-sm leading-relaxed mb-4` to `text-sm leading-relaxed mb-4 [overflow-wrap:anywhere]`.

### Step 2: Let list items wrap long tokens

- Change the `li` mapping from `<li>{children}</li>` to `<li className="[overflow-wrap:anywhere]">{children}</li>`. Put it on `li` (not `ul`/`ol`) so it applies to both list kinds from one place.

### Step 3: Let inline code wrap long tokens

- In the `code` mapping's inline branch only (the one without `data-language`), change the className to `rounded-sm bg-white/70 px-1 py-0.5 text-[0.85em] [overflow-wrap:anywhere]`.
- Do not touch the `"data-language" in props` branch: highlighted code blocks must keep scrolling inside their `<pre>`.
- Do not change the file's header comment or any other mapping. No content (`.mdx`) changes: the `Excerpt from <path>, trimmed.` line format is an app rule and stays as is.

### Step 4: Verify in a real browser at 375 and 390 px

- Build the app, then start it on a free port (not 3003/3005; default 3004 or `PORT=<free>`): `yarn turbo run build --filter=./apps/patterns` then `PORT=3004 yarn workspace patterns start` in the background.
- With Playwright MCP, for each viewport 375x667 and 390x844, open `/p/infinite-scrolling`, `/p/server-prefetch-hydration` and `/p/suspense-without-flash`, and evaluate `({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth })`. Every result must have `s === c`.
- Screenshot one page at 390 px to confirm the `Excerpt from ...` line wraps and the code blocks still scroll horizontally inside their own `<pre>`.
- Stop the server afterwards.

## Validation

Execute every command to validate the patch is complete with zero regressions.

- `yarn prettier --check apps/patterns` - Formatting matches the repo config (prettier-plugin-tailwindcss may reorder classes; if so run `yarn prettier --write apps/patterns/src/mdx-components.tsx`)
- `yarn turbo run lint typecheck test --filter=./apps/patterns` - Lint, types and unit tests pass for the workspace
- `yarn turbo run build --filter=./apps/patterns` - Production build succeeds and `/` and `/p/[slug]` are still prerendered
- `yarn knip` - No unused files, exports or dependencies introduced
- Browser check from Step 4: `document.documentElement.scrollWidth === document.documentElement.clientWidth` at 375 px and 390 px on all three `/p/<slug>` pages

## Patch Scope

**Lines of code to change:** ~3
**Risk level:** low
**Testing required:** Existing patterns lint/typecheck/test/build gates, plus a Playwright viewport check of scrollWidth vs clientWidth at 375 and 390 px on all three doc pages.
