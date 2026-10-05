# TrackMeNow Cell API — Google Cloud Run

This service is intentionally isolated from the public TrackMeNow frontend.

## Runtime

- Google Cloud Run
- Node.js 20
- OpenCelliD cell-position API
- OpenCelliD key is read only from `OPENCELLID_API_KEY`
- Browser origin is restricted to the TrackMeNow GitHub Pages origin

## Endpoints

- `GET /health`
- `GET /api/cell?mcc=...&mnc=...&lac=...&cellid=...&radio=...`

## Secret

Create `OPENCELLID_API_KEY` in Google Secret Manager and expose it to the Cloud Run service as an environment variable. Never put the key in `index.html`, `trackmenow.js`, GitHub Pages, or any client-side bundle.

## Frontend connection

After deployment, set TrackMeNow's `TM_CELL_API_BASE` to the Cloud Run service URL. Do not change the frontend until the Cloud Run health endpoint and a real cell lookup have been verified.

## Global roadmap

This service is the first backend boundary for TrackMeNow. Future Cloud Run services can handle:

1. authenticated live GPS sessions
2. WebSocket/realtime movement
3. public cell database queries
4. aircraft / rail / bus / ship adapters
5. weather
6. location history and analytics

The existing GitHub Pages frontend remains the TrackMeNow product and branding.
