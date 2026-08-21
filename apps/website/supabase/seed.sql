-- Seed data for local development
-- Runs after migrations on `supabase db reset`

-- ─── Bookings (test data) ────────────────────────────────────────────────────

INSERT INTO public.bookings (room_type, check_in, check_out, nights, person_count, base_price, tourist_tax, total_amount, email, stripe_session_id, status)
VALUES
  ('room1', CURRENT_DATE + 7,  CURRENT_DATE + 10, 3, 2, 300.00, 6.00, 306.00, 'test@example.com',  'cs_test_seed_1', 'confirmed'),
  ('room2', CURRENT_DATE + 14, CURRENT_DATE + 17, 3, 2, 350.00, 6.00, 356.00, 'test2@example.com', 'cs_test_seed_2', 'pending');


-- ─── Documents (knowledge base) ─────────────────────────────────────────────

INSERT INTO public.documents (content, metadata) VALUES
  ('Room 1 is a private room on the top floor with an Atlantic view. Queen bed, ensuite bathroom, AC. Max 2 guests.',
   '{"type": "room_info", "section": "Room 1"}'),
  ('Check-out is at 11:00. Check-in from 15:00. Early check-in and late check-out on request, subject to availability.',
   '{"type": "policy", "section": "Check-in / Check-out"}'),
  ('Almoçageme is a small village in the Sintra-Cascais Natural Park, 1.7 km from Praia da Adraga and 40 minutes from Lisbon by car.',
   '{"type": "location", "section": "Getting here"}');


-- [BEGIN MEMORY] channels + reference_guides — static, manually-maintained seed data.
-- Edit the INSERT statements below directly and commit seed.sql.

-- ─── Channels ────────────────────────────────────────────────────────────────

INSERT INTO public.channels (id, platform, name, description, active, created_at, figma_board_ref) VALUES
('381fc1a9-f5f7-4cc2-af02-bde45ebd6c0a', 'whatsapp', 'hermanas', 'WhatsApp group of women who share resources, recommendations, and promote their own services to each other.

This is an offer of rest space specifically for women. Frame it as a service and restorative experience — not a rental. Lead with what the space offers: rest, nature, safety, a place to recover and come back to yourself. The audience understands and values this language; they are not looking for a listing, they are looking for something that serves them.

Never use: "rent", "rental", "room for rent", "available".

Language: English.

Tone: warm, sisterly, genuine. You are sharing something with women who get it. Not a sales pitch — an invitation.

Brand: issebya.homes · @issebya.homes on Instagram
Location: Almoçageme, Sintra-Cascais Natural Park, Portugal. Praia da Adraga: 1.7 km · Lisbon: 40 min
Essence: "coming back into a safe space" — rest, healing, nature, return to self
Season: March – November', TRUE, '2026-04-09T19:05:50.934228+00:00', NULL);
INSERT INTO public.channels (id, platform, name, description, active, created_at, figma_board_ref) VALUES
('90bddfb4-88b1-4930-8e44-d9a7d354c992', 'instagram', 'issebya.homes', 'Instagram account for issebya.homes.

Audience: people looking for a place to slow down — creatives, remote workers, nature-seekers, solo travellers.

Voice: a conversation with the audience. Not an announcement. Talk about the house as a lived-in place near the Atlantic — for rest, clarity, and focus. Sintra coast, Portugal.

Tone: quiet, considered, specific. Avoid promotional language. No exclamation marks. No clichés ("paradise", "getaway", "escape"). Speak in images and feeling.

Captions: open with a sensory or grounded detail. Build slowly. End with a gentle invite, not a hard CTA. Hashtags at the end, minimal.

Brand: issebya.homes · @issebya.homes
Location: Almoçageme, Sintra-Cascais Natural Park, Portugal. Praia da Adraga: 1.7 km · Lisbon: 40 min
Essence: rest, clarity, focus — a lived-in house near the Atlantic
Season: March – November', TRUE, '2026-04-09T19:05:50.934228+00:00', '282:102');
INSERT INTO public.channels (id, platform, name, description, active, created_at, figma_board_ref) VALUES
('d9a3a206-d0d9-4988-bc4f-ec2940c89280', 'whatsapp', 'short-term accommodation', 'WhatsApp group for short-term accommodation listings. Posts must follow the group''s required template exactly — any deviation from the format risks being ignored or removed by group admins.

REQUIRED FORMAT:

🏷 TITLE: use "Private Room" (not "Offering")
🔍 TYPE: Short Term
🏠 WHAT: Private room in a 3-level house with shared spaces
📍 WHERE: Almoçageme, Sintra-Cascais Natural Park
📅 WHEN/LENGTH: [start date] – [end date] in DD/MM/YYYY format
💸 HOW MUCH: €[price]/night (do not include tourist tax)
👥 WHO: Up to 2 guests


Tone: factual, clear, brief. No framing, no narrative. The format does the work.

Do not add: tourist tax, minimum nights phrasing, PICS header line.', TRUE, '2026-04-09T19:05:50.934228+00:00', NULL);

-- ─── Reference Guides ────────────────────────────────────────────────────────

INSERT INTO public.reference_guides (id, type, scope, summary, examples, logs, created_at, updated_at, channel_ids) VALUES
('ca3e3947-64e7-4156-8a4a-8a2e04f202e8', 'copy', 'caption', NULL, '[]'::jsonb, '[]'::jsonb, '2026-04-09T19:05:50.934228+00:00', '2026-04-09T19:05:50.934228+00:00', ARRAY['90bddfb4-88b1-4930-8e44-d9a7d354c992'::uuid]);
INSERT INTO public.reference_guides (id, type, scope, summary, examples, logs, created_at, updated_at, channel_ids) VALUES
('667a0626-19f6-4d33-988a-26043a8f3cf4', 'copy', 'caption', NULL, '[]'::jsonb, '[]'::jsonb, '2026-04-09T19:05:50.934228+00:00', '2026-04-09T19:05:50.934228+00:00', ARRAY['381fc1a9-f5f7-4cc2-af02-bde45ebd6c0a'::uuid]);
INSERT INTO public.reference_guides (id, type, scope, summary, examples, logs, created_at, updated_at, channel_ids) VALUES
('92610f31-4acf-4dba-8400-d9e782c017fb', 'copy', 'caption', NULL, '[]'::jsonb, '[]'::jsonb, '2026-04-09T19:05:50.934228+00:00', '2026-04-09T19:05:50.934228+00:00', ARRAY['d9a3a206-d0d9-4988-bc4f-ec2940c89280'::uuid]);
INSERT INTO public.reference_guides (id, type, scope, summary, examples, logs, created_at, updated_at, channel_ids) VALUES
('95bee7fa-b18f-461c-abfb-4dacccebdeac', 'copy', 'overlay_text', NULL, '[]'::jsonb, '[]'::jsonb, '2026-04-09T19:05:50.934228+00:00', '2026-04-09T19:05:50.934228+00:00', ARRAY['90bddfb4-88b1-4930-8e44-d9a7d354c992'::uuid]);
INSERT INTO public.reference_guides (id, type, scope, summary, examples, logs, created_at, updated_at, channel_ids) VALUES
('438a3de9-9d73-4fda-8e52-c6430983608b', 'copy', 'overlay_text', NULL, '[]'::jsonb, '[]'::jsonb, '2026-04-09T19:05:50.934228+00:00', '2026-04-09T19:05:50.934228+00:00', ARRAY['381fc1a9-f5f7-4cc2-af02-bde45ebd6c0a'::uuid]);
INSERT INTO public.reference_guides (id, type, scope, summary, examples, logs, created_at, updated_at, channel_ids) VALUES
('9f962da3-a300-46a3-a3e1-b2d056bfde21', 'visual', NULL, '## COLOUR TOKENS
Paper #F2F0EB — primary background
Ink #1C1A18 — primary text
Olive #8A8060 — secondary surface
Red #943729 — accent, minimal use only
Dust #C8C4BC — dividers, metadata

## TYPOGRAPHY
Caveat Bold — hero headlines, brand moments (120–180px)
Courier Prime Regular — feature text, ALL CAPS with tracking
Courier Prime Italic — guest quotes, intimate body copy
Work Sans Light/Regular — metadata, captions, handles (10–16px)

## DESIGNER PERSONA
Act as a lead designer with niche taste. Accessible and human. Never over-designed. Make deliberate creative choices — do not fill templates mechanically. Reason about template choice, photo vs text-only, typographic register before executing.

## SIZES
Instagram: 1080×1080 post/carousel · 1080×1920 reel/story
WhatsApp: 1080×1080 post

## LAYOUT PRINCIPLES
- Photos can be objects and backgrounds. Place with min 72–80px margin.
- White space is the design. Empty space is intentional — trust it.
- 2–3 type sizes maximum per post.
- Never overlay text on photos (except Template E carousel).

## DO NOT
- Decorative frames, borders, ornaments
- Exclamation marks
- Corporate language: "amenities", "facilities", "we offer"
- More than 3 typographic elements per frame
- Centre-align Courier Prime', '[]'::jsonb, '[]'::jsonb, '2026-04-09T19:05:50.934228+00:00', '2026-04-09T19:05:50.934228+00:00', ARRAY['90bddfb4-88b1-4930-8e44-d9a7d354c992'::uuid, '381fc1a9-f5f7-4cc2-af02-bde45ebd6c0a'::uuid]);

-- [END MEMORY]
