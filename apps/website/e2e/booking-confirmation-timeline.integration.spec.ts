import { randomInt, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { addDays, format, startOfDay } from "date-fns";
import {
  STEP_LABELS,
  TIMEOUT_COPY,
} from "@/app/(main)/booking/confirmation/ui/ConfirmationTimeline";
import { createAdminClient } from "@/lib/shared/supabase";

// Far in the future, and at a random offset, so the seeded confirmed row can
// neither collide with other specs' room1 windows nor with a concurrent run
// of this spec from another worktree on the shared database.
function farFutureStay() {
  const checkIn = addDays(startOfDay(new Date()), 400 + randomInt(0, 300));
  return {
    check_in: format(checkIn, "yyyy-MM-dd"),
    check_out: format(addDays(checkIn, 2), "yyyy-MM-dd"),
  };
}

type Seeded = { sessionId: string; email: string; bookingId: string; guestContactId: string };

// The row is already `confirmed`, so /api/bookings/direct never calls Stripe.
async function seedBooking(timestamps: {
  guest_email_sent_at: string | null;
  owner_email_sent_at: string | null;
}): Promise<Seeded> {
  const supabase = createAdminClient();
  const email = `e2e-timeline-${randomUUID()}@example.com`;

  const { data: guestContact, error: guestContactError } = await supabase
    .from("guest_contacts")
    .insert({
      // guest_contacts has UNIQUE phone and email; random values keep
      // repeated runs from colliding.
      phone: `+000${randomUUID().replace(/\D/g, "").slice(0, 10)}`,
      email,
      guest_name: "E2E Timeline Fixture",
      enabled: false,
    })
    .select("id")
    .single();

  if (guestContactError || !guestContact) {
    throw new Error(`Failed to seed guest_contacts fixture: ${guestContactError?.message}`);
  }

  const sessionId = `cs_test_e2e_timeline_${randomUUID()}`;
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .insert({
      room_type: "room1",
      ...farFutureStay(),
      nights: 2,
      person_count: 1,
      base_price: 100,
      tourist_tax: 10,
      total_amount: 110,
      guest_contact_id: guestContact.id,
      source: "direct",
      stripe_session_id: sessionId,
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      ...timestamps,
    })
    .select("id")
    .single();

  if (bookingError || !booking) {
    await supabase.from("guest_contacts").delete().eq("id", guestContact.id);
    throw new Error(`Failed to seed booking fixture: ${bookingError?.message}`);
  }

  return { sessionId, email, bookingId: booking.id, guestContactId: guestContact.id };
}

async function cleanUp({ bookingId, guestContactId }: Seeded) {
  const supabase = createAdminClient();
  await supabase.from("bookings").delete().eq("id", bookingId);
  await supabase.from("guest_contacts").delete().eq("id", guestContactId);
}

test.describe("Booking confirmation timeline", () => {
  test("timeline updates live as the webhook's steps land", async ({ page }) => {
    const seeded = await seedBooking({ guest_email_sent_at: null, owner_email_sent_at: null });
    const supabase = createAdminClient();

    try {
      await page.goto(`/booking/confirmation?session=${seeded.sessionId}`);

      const timeline = page.getByTestId("confirmation-timeline");
      await expect(timeline.getByText(STEP_LABELS.payment_received)).toBeVisible();
      await expect(timeline.getByText(STEP_LABELS.confirmed)).toBeVisible();
      await expect(timeline.getByText(STEP_LABELS.guest_email_sent)).toHaveCount(0);

      // What the Stripe webhook writes after each send, with no page reload.
      await supabase
        .from("bookings")
        .update({ guest_email_sent_at: new Date().toISOString() })
        .eq("id", seeded.bookingId);
      await expect(
        timeline.getByText(`${STEP_LABELS.guest_email_sent} to ${seeded.email}`),
      ).toBeVisible();

      await supabase
        .from("bookings")
        .update({ owner_email_sent_at: new Date().toISOString() })
        .eq("id", seeded.bookingId);
      await expect(timeline.getByText(STEP_LABELS.owner_email_sent)).toBeVisible();
      await expect(page.getByText(TIMEOUT_COPY)).toHaveCount(0);
    } finally {
      await cleanUp(seeded);
    }
  });

  test("a finished booking renders statically and opens no stream", async ({ page }) => {
    const now = new Date().toISOString();
    const seeded = await seedBooking({ guest_email_sent_at: now, owner_email_sent_at: now });
    const streamRequests: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/api/bookings/") && url.includes("/events")) streamRequests.push(url);
    });

    try {
      await page.goto(`/booking/confirmation?session=${seeded.sessionId}`);

      const timeline = page.getByTestId("confirmation-timeline");
      await expect(timeline.getByRole("listitem")).toHaveText([
        STEP_LABELS.payment_received,
        STEP_LABELS.confirmed,
        `${STEP_LABELS.guest_email_sent} to ${seeded.email}`,
        STEP_LABELS.owner_email_sent,
      ]);
      await page.waitForLoadState("networkidle");
      expect(streamRequests).toEqual([]);
    } finally {
      await cleanUp(seeded);
    }
  });

  test("an unknown token returns 404", async ({ request }) => {
    const response = await request.get(`/api/bookings/${"0".repeat(64)}/events`);
    expect(response.status()).toBe(404);
  });
});
