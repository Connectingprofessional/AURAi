# TrackMeNow Worker (Cloudflare + D1)

`worker.js` replaces the existing `wispy-bush-9aee` Worker and keeps what it did (`/health`, `/api/cell` for OpenCelliD)
while adding the consent-based device API (`/api/devices/...`) that the GitHub Pages site and the Android app call.

Privacy rules built in: a phone number alone never reveals a location; the number must be registered by its own device
with explicit consent; the owner reads a one-time 6-digit pairing code (valid 15 minutes) off that device; only the
viewer token issued by that code can read that device's location; tokens/codes are stored hashed; rate limits on
register/pair/lookup/telemetry; telemetry auto-deleted after `RETENTION_DAYS` (7); owner can revoke (deletes data).
Not included: SMS/OTP proof that the registering person owns the number (needs an SMS provider such as Twilio).

## Deploy (about 10 minutes, from any computer with Node)

```bash
cd cloudflare
npm install -g wrangler            # or use: npx wrangler ...
npx wrangler login                 # opens the browser, log in to the Cloudflare account that owns wispy-bush-9aee
npx wrangler d1 create trackmenow  # prints a database_id
```
1. Paste that `database_id` into `wrangler.toml`.
2. Create the tables: `npx wrangler d1 execute trackmenow --remote --file=device-api-schema.sql`
3. Add the OpenCelliD key as a secret: `npx wrangler secret put OPENCELLID_API_KEY` (paste the key when asked)
4. Deploy: `npx wrangler deploy`

Check: open `https://wispy-bush-9aee.recreationeeraj.workers.dev/health` -> `{"ok":true,"cell":true,"devices":true,...}`.

`ALLOWED_ORIGINS` in `wrangler.toml` lists the sites allowed to call the API from a browser (your GitHub Pages
address is already there). The Android app is not a browser, so CORS does not affect it.

## Android app contract
1. `POST /api/devices/register` `{ "phone": "+91...", "label": "My phone", "consent": true }` -> `deviceId`, `deviceToken`, `pairingCode`
2. `POST /api/devices/{deviceId}/telemetry` with `Authorization: Bearer <deviceToken>` and `{ "lat", "lon", "accuracy", "speed", "heading", "timestamp", "radio" }`
3. Owner reads the pairing code on the phone and types it into **ACCESS** on the website; the site then keeps a viewer token for that browser session.
4. `POST /api/devices/{deviceId}/regenerate-pairing` `{ "consent": true }` (device token) issues a fresh code and signs out any viewer.
5. `POST /api/devices/{deviceId}/revoke` (device token) removes the device and its history.
