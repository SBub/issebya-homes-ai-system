// Manually-triggerable sync: re-derives guest_contacts from apps/finance's
// finance_bookings history (see src/lib/finance-sync.ts). Re-runnable —
// run again after every future CSV import into apps/finance. Since this
// also now runs automatically after every successful CSV import (apps/finance's
// import route calls POST /api/guest-contacts/sync, see
// src/app/api/guest-contacts/sync/route.ts), this script is mainly useful
// for an ad-hoc/manual re-run rather than the only interface.
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
