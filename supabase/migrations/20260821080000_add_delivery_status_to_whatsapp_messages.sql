-- Graceful-degradation branch, failure class 1: "reply generated but not
-- delivered". run-turn.ts's runGuestTurn already knows whether
-- sendWhatsAppMessage succeeded (sendResult.ok) but never used to persist
-- that outcome anywhere — this column is what it now writes to.
--
-- Nullable, and only ever set on role='assistant' rows: a guest's own
-- inbound message has no delivery status of its own (GCA never "delivers"
-- an inbound message anywhere) — that asymmetry is exactly why this isn't a
-- not-null column with some third neutral value instead.
alter table public.whatsapp_messages
  add column delivery_status text check (delivery_status in ('sent', 'failed'));
