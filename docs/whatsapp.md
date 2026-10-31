# WhatsApp intake

The WhatsApp Cloud API adapter shares its intake logic with the
[Telegram bot](telegram.md) (`floodline/chat.py`). The public demo uses Telegram.

| They send | Floodline replies | On the coordinators' map |
|---|---|---|
| a photo or a 10–30 s clip | "measuring…", then the overlay and a verdict per vehicle, in their language | a new report (`source: whatsapp`) |
| their location | "your report is now at your location" | the report moves there |
| a voice note or text | "added to your report: …" | transcript added, triage re-run |

Language and default city come from the sender's country code (+84 Vietnamese/Huế, +34
Spanish/Valencia, otherwise English); a shared location picks the nearest city.

**Safety.** Every webhook POST must carry a valid `X-Hub-Signature-256` from the app secret. Only
numbers in `WHATSAPP_ALLOWED` are served, retries of a message already seen are dropped, and photos
are capped per hour (`WHATSAPP_HOURLY_LIMIT`, default 30). The channel analyses live
(`WHATSAPP_MODEL_MODE=record`), so it needs `MODEL_API_KEY`; the web demo can keep replaying.

**Setup.** Create a Business app on developers.facebook.com, add WhatsApp, use the test number,
add recipient numbers, create a System User token with `whatsapp_business_messaging`, and point the
webhook at `https://<host>/api/whatsapp/webhook` with your `WHATSAPP_VERIFY_TOKEN`, subscribed to
`messages`. Variables are listed in `.env.example`.
