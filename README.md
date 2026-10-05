# TrackMeNow

Real-time consent-based GPS tracking and **MapLibre GL Global Intelligence** map (Argos Atlas–style reference UI).

## What you get
- Full-screen **MapLibre GL** map (WebGL): satellite / dark / terrain, flat ↔ 3D globe, tilt & rotate
- Live aircraft (OpenSky ADS-B), ships (AIS when configured), public transport (GTFS-RT), cameras & infrastructure (OSM/Overpass)
- Browser GPS (`navigator.geolocation`), accuracy circle, heading/speed, movement trail
- Place / coordinate / object search
- WebSocket rooms + session / history API
- PostgreSQL / PostGIS–ready schema
- Explicit separation: **LIVE GPS** · **LIVE RADIO** (native only) · **PUBLIC CELL DATABASE**

## Architecture
| Layer | Path | Role |
|--------|------|------|
| UI | `index.html` + `trackmenow.js` + MapLibre vendor | Single Global Intelligence frontend |
| API | `server/index.js` + `server/global-sources.js` | Express + WebSocket + live feeds |
| DB | `database/schema.sql` | Optional PostGIS persistence |
| Static host | GitHub Pages | Map UI only (no Node API) |
| Full stack | `npm start` | UI + API on same origin |

The old **Leaflet** `frontend/` tree and **Render** deploy config have been removed. The client uses **same-origin** API URLs (no hardcoded Render host).

## Run locally
```bash
cp .env.example .env   # optional keys
npm install
npm start
```
Open http://localhost:8787

## Environment (optional)
See `.env.example`. Important keys:
- `DATABASE_URL` — enable PostGIS session history
- `GTFS_REALTIME_URLS` — comma-separated VehiclePositions feeds
- `AISSTREAM_API_KEY` / `AIS_API_URL` — ships
- `OPENCELLID_API_KEY` — public cells
- `CAMERA_GEOJSON_URLS` — public camera GeoJSON
- `APPLIXIR_API_KEY` — optional rewarded ads

## GitHub Pages
Workflow `.github/workflows/pages.yml` publishes the **static MapLibre UI** from the repo root.
Live feed panels need the Node API (run `npm start` or host `server/` elsewhere). Without the API, basemap, GPS and search still work; movement layers show source errors until an API is available.

## Data honesty
- A browser cannot read modem radio fields (MCC/MNC, Cell ID, RSRP…). Those need a native companion.
- Satellite basemap is **not** live video.
- Aircraft, ships and other movers only appear from legitimate public feeds — never fabricated.

## License / attribution
MapLibre GL, OpenStreetMap, Natural Earth, OpenSky, USGS, and other sources remain under their respective licences.


## Transport layers on GitHub only (Air, Ships, Transit, Mobile)

The Earth bottom bar has **Air**, **Ships**, **Transit** and **Mobile** buttons. Nothing runs outside GitHub:

- `.github/workflows/live-data.yml` runs every ~10 minutes, runs `scripts/fetch-live.mjs` and force-pushes
  `flights.json`, `ships.json`, `transit.json`, `meta.json` to the **`live-data`** branch.
- `.github/workflows/cell-data.yml` runs weekly, runs `scripts/fetch-cells.mjs` (downloads the OpenCelliD database and
  reduces it to a 0.25 degree tower-density grid) and force-pushes `cells.json` to the **`cell-data`** branch.
- The page reads those files from `raw.githubusercontent.com` and moves each object forward from its speed and heading
  between snapshots. Click an object for its card (**Zoom to**, **Follow**), or type a callsign / ship name / MMSI /
  ICAO24 / vehicle label in the search box.

Keys live in **GitHub Secrets** (repo -> *Settings* -> *Secrets and variables* -> *Actions* -> *New repository secret*).
Never put them in the repo, in `index.html` or in any browser file.

| Service | Secret name | What it powers |
|---|---|---|
| [aisstream.io](https://aisstream.io/account) | `AISSTREAM_API_KEY` | ships |
| [opencellid.org](https://opencellid.org) | `OPENCELLID_API_KEY` | mobile tower density |
| [mobilitydatabase.org](https://mobilitydatabase.org/account/api-access) | `MOBILITY_DB_REFRESH_TOKEN` | open GTFS-Realtime vehicle feeds (buses, trams, trains) |

Aircraft need no key (OpenSky, with ADSB.lol as fallback). After adding the secrets run each workflow once from the
*Actions* tab (*Run workflow*); `meta.json` on the data branches says what worked. Until then the page shows
"no data published yet" for that layer.

## Optional Node server API keys

The legacy Node server (`server/`) reads the same three names from **environment variables** (copy `.env.example`
to `.env` locally; `GET /api/global/status` shows what is configured). The GitHub Pages site does not need it.
