// Manually-triggerable sync: pulls phone numbers a human has typed into
// Notion's "Phone" property back into guest_contacts.phone (see
// src/lib/notion-phone-sync.ts). Re-runnable — run again any time new
// phones get added in Notion. No automatic trigger for this direction (yet)
// — unlike guest-contacts sync, nothing in this repo currently notices when
// a Notion page changes; this script is the whole interface for now.
import { syncPhonesFromNotion } from "../src/lib/notion-phone-sync.js";

async function main() {
  const summary = await syncPhonesFromNotion();
  console.log(`phones-from-notion sync complete: ${summary.updated} updated`);
  console.log(`Unmatched guest names (${summary.unmatched.length}):`);
  for (const guestName of summary.unmatched) {
    console.log(`  - ${guestName}`);
  }
}

main();
