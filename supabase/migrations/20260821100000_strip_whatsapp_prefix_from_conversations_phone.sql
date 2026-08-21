-- whatsapp_conversations.phone_number is domain data, not a Twilio transport
-- detail — it should be stored bare, same as guest_memory.phone_number.
-- This table was the one outlier storing it "whatsapp:"-prefixed; backfills
-- every existing row to the bare form so lookups/inserts can stop checking
-- both forms.
update public.whatsapp_conversations
set phone_number = regexp_replace(phone_number, '^whatsapp:', '', 'i')
where phone_number ilike 'whatsapp:%';
