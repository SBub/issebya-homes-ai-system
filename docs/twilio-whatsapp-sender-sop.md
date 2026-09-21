# Twilio WhatsApp sender: how the real business number was set up

SOP for the production WhatsApp sender behind `apps/guest-communication-agent` (GCA). Written to be followed quickly, not read as prose. Done 2026-09-21; the steps and gotchas below are what it actually took.

## What exists

- Real sender: `whatsapp:+351968011894`, a Meta WhatsApp Business Account (WABA) number registered through Twilio (Twilio is the BSP).
- Twilio Messaging Service `issebya.homes` holds the sender and the inbound webhook URL. Change the webhook there, not on the phone number.
- Prod webhook URL: `https://issebya-homes-ai-system-guest-commu.vercel.app/api/webhook/whatsapp` (the Vercel production domain). The exact string matters: GCA verifies `X-Twilio-Signature` against `TWILIO_WEBHOOK_URL`, so the env var and the Messaging Service must match byte for byte.
- The Twilio WhatsApp Sandbox (`whatsapp:+14155238886`) stays for dev. It reaches only phones that sent the Sandbox join code.

## Per-environment vars (GCA)

| Var                    | dev (`.env.development`)                               | prod (Vercel Production)                                                      |
| ---------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `TWILIO_WHATSAPP_FROM` | `whatsapp:+14155238886` (Sandbox)                      | `whatsapp:+351968011894`                                                      |
| `TWILIO_WEBHOOK_URL`   | `https://<reserved ngrok domain>/api/webhook/whatsapp` | `https://issebya-homes-ai-system-guest-commu.vercel.app/api/webhook/whatsapp` |
| `TWILIO_ACCOUNT_SID`   | same in both (account-wide)                            | same in both                                                                  |
| `TWILIO_AUTH_TOKEN`    | same in both (account-wide)                            | same in both                                                                  |

Dev routes through the ngrok webhook gateway, see `docs/ngrok-webhook-gateway-sop.md`. Bulk-setting the prod values: `docs/vercel-env-vars-sop.md`.

## The setup, in order

1. **Meta Business verification** (Meta Business Manager > Security Center). Sole trader, so verification is against the person, not a company registry entry. What passed:
   - Documents must match the legal name and the address exactly as printed, including the postal code, so use the address as it appears on the Finanças (tax authority) declaration, not a reformatted version.
   - Prepaid phone bills are not accepted as address proof. Use the Finanças declaration or a bank/utility statement.
   - A mismatch in any field is a silent reject with a generic reason; fix the field and resubmit rather than guessing.
2. **Twilio Embedded Signup** (Twilio Console > Messaging > Senders > WhatsApp senders > New sender). Pick "My own phone number" and enter the business number. Twilio creates or links the WABA and sends the verification code to that phone.
3. **Wait for the final registration.** After signup the number shows **"Pending"** in WhatsApp Manager and stays there until the BSP (Twilio) runs the final registration API call on its side. Nothing in the Meta or Twilio UI triggers it. It needed a Twilio support ticket to get done.
   - Symptom while stuck: outbound sends fail with **Error 21212 "Invalid From Number"** even though the sender is listed in the console.
4. **Attach the sender to the Messaging Service** `issebya.homes` and set its inbound webhook to the prod URL above (POST).
5. **Set the prod env vars** on Vercel (table above), redeploy, then send a real message to the number and confirm the reply arrives and the Twilio debugger shows no 11200/21212 errors.

## Gotchas worth remembering

- Verification and registration are two separate gates. A verified business with a "Pending" number still cannot send.
- Sandbox and real sender share one Twilio account, so `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` never change between envs; only `TWILIO_WHATSAPP_FROM` and `TWILIO_WEBHOOK_URL` do.
- Marketing templates for cold-open campaigns are a separate Meta approval, see `docs/whatsapp-campaign-templates.md`.
