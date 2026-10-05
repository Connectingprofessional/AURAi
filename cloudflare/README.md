# TrackMeNow device API deployment

The existing wispy-bush-9aee Worker already serves /health and /api/cell for OpenCelliD. The consented-device endpoints in server/index.js are the reference API contract for the Android companion.

For the public GitHub Pages site, those device endpoints need to be added to the existing Worker (or deployed as a separate Worker) before the Android app can send telemetry to it. Keep the OpenCelliD secret server-side.

Recommended free Cloudflare persistence is D1. Before production, add verified phone ownership (SMS/OTP), rate limiting, hashed credentials, retention controls, and audit logging.
