# Telegram intake

Anyone can open the bot and report a flood; no app beyond Telegram.

| They send | Floodline replies | On the coordinators' map |
|---|---|---|
| a photo or a 10–30 s clip | "measuring…", then the overlay and a verdict per vehicle | a new report (`source: telegram`) |
| their location (one-tap button) | "your report is now at your location" | the report moves there |
| a voice note or text | "added to your report: …" | transcript added, triage re-run |

The bot replies in English. Set `TELEGRAM_LANGUAGE=auto` to follow each sender's Telegram language
instead (Vietnamese, Spanish, otherwise English); Vietnamese and Spanish users then default to Huế
and Valencia. A shared location always picks the nearest city.

**Safety and cost.** Webhook calls must carry `X-Telegram-Bot-Api-Secret-Token` equal to
`TELEGRAM_WEBHOOK_SECRET`. The bot is public, so photos are capped per hour and per day
(`TELEGRAM_HOURLY_LIMIT`, `TELEGRAM_DAILY_LIMIT`); `TELEGRAM_ALLOWED` can restrict it to chat ids.
The token is never logged. The channel analyses live, so the server needs `MODEL_API_KEY`.

**Setup.** Talk to @BotFather → `/newbot` → copy the token into `TELEGRAM_BOT_TOKEN`, set a random
`TELEGRAM_WEBHOOK_SECRET`, deploy, then call `setWebhook` with
`https://<host>/api/telegram/webhook` and the secret (`floodline telegram-webhook <url>`).
