# pricing

Single source of truth for issebya.homes room pricing. Exports one constant,
`ROOM_PRICING`, a flat rate config with no per-room or seasonal
differentiation:

```ts
export const ROOM_PRICING = {
  basePrice: 75, // per night, in euros
  currency: "EUR",
  touristTax: 2, // per person per night, in euros
  touristTaxNights: 3, // number of nights the tourist tax applies to
} as const;
```

There's no build step: `package.json` points `main`/`types` straight at
`src/index.ts`, and consumers import the TypeScript source directly through
the workspace.

## Usage

```ts
import { ROOM_PRICING } from "pricing";
```

## Who consumes this

- **`apps/website`** - the booking engine. `src/lib/price-utils.ts` derives
  nights/base price/tourist tax/total from `ROOM_PRICING`, and the booking UI
  (`BookingPricing.tsx`, `BookingEngineExpanded.tsx`) reads it directly to
  display prices to guests.
- **`apps/guest-communication-agent`** - the WhatsApp agent's `getPricing`
  tool (`src/agent/tools/pricing.ts`) reads `basePrice` and `currency` to
  answer guest questions about cost.

Both apps read the same constant, so a price change here updates both
surfaces at once, no separate copy to keep in sync.
