// Manually-triggerable sync: re-derives guest_contacts from apps/finance's
// finance_bookings history (see src/lib/finance-sync.ts). Re-runnable —
// run again after every future CSV import into apps/finance. Not wired into
// that import flow automatically (yet); this script is the whole interface
// for now.
import { syncGuestContactsFromFinance } from "../src/lib/finance-sync.js";

async function main() {
  const summary = await syncGuestContactsFromFinance();
  console.log(
    `guest_contacts sync complete: ${summary.created} created, ${summary.updated} updated`,
  );
  console.log(`Guests processed (${summary.guests.length}):`);
  for (const guest of summary.guests) {
    console.log(`  - ${guest}`);
  }
}

main();
