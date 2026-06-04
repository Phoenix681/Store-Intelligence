# Store Intelligence Pipeline — Apex Retail

An end-to-end Edge AI and Analytics platform that transforms raw CCTV footage into live retail intelligence. The system tracks customer journeys across multiple stores, correlates physical behaviour with offline POS transaction data, and surfaces operational anomalies in real time via a React dashboard.

---

## Architecture at a Glance

```
CCTV Video → [Python Edge Node] → POST /events/ingest → [Node.js API + SQLite] → [React Dashboard]
                YOLOv8 + ByteTrack      structured JSON        analytics engine       live at :5173
```

---

## Quick Start (3 terminals, ~5 commands)

### Prerequisites
- Docker & Docker Compose
- Python 3.10+ with pip
- Node.js 18+

### Terminal 1 — Boot the API (auto-seeds POS data)

```bash
git clone <https://github.com/Phoenix681/Store-Intelligence> && cd Store-Intelligence
docker compose up --build -d
```

The Docker container automatically runs `node import_csv.js` before starting the API, seeding `pos_transactions.csv` into SQLite. The API is live at `http://localhost:3000`.

### Terminal 2 — Start the Live React Dashboard

```bash
cd dashboard
npm install
npm run dev
```

Open `http://localhost:5173` to see the live dashboard. Metrics auto-update every 3 seconds.

### Terminal 3 — Run the Edge Detection Pipeline

```bash
cd pipeline
pip install ultralytics opencv-python requests
python detect.py --store ST1008 --camera CAM6 --source data/store_2/billing_area.mp4
```

Watch the dashboard update in real time as the tracker processes the video and POSTs events to the API.

---

## Running Tests

```bash
npm run test
```

Runs all three test files sequentially: API integration, ingest idempotency, and empty-store edge cases.

To run individually:

```bash
node tests/api.test.js        # health, metrics, funnel, empty-store edge case
node tests/test_ingest.js     # idempotency + partial success (207)
node tests/edge_cases.test.js # zero-traffic graceful degradation
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/events/ingest` | Idempotent batch ingestion (up to 500 events) |
| `GET` | `/stores/:id/metrics` | Unique visitors, conversion rate, queue depth, abandonment rate, avg dwell |
| `GET` | `/stores/:id/funnel` | Session-based funnel with drop-off % at each stage |
| `GET` | `/stores/:id/heatmap` | Zone visit frequency normalised 0–100 with `data_confidence` flag |
| `GET` | `/stores/:id/anomalies` | Queue spike, conversion drop, dead zone, high dwell — with severity + `suggested_action` |
| `GET` | `/health` | Per-store last event timestamp, `STALE_FEED` warning if >10 min lag |

---

## Adding a New Store or Camera

Edit `config.json` to add zone polygons for any store/camera combination:

```json
{
  "ST9999": {
    "CAM1": {
      "type": "aisle",
      "zones": {
        "HAIRCARE_01": {
          "name": "Haircare Aisle",
          "polygon": [[50, 100], [400, 100], [400, 500], [50, 500]],
          "type": "SHELF",
          "is_revenue_zone": "Yes"
        }
      }
    }
  }
}
```

Then run: `python detect.py --store ST9999 --camera CAM1 --source your_video.mp4`

---

## Live Dashboard (Part E)

The React dashboard (`/dashboard`) polls the API every 3 seconds and displays:
- Live walk-in count and conversion rate
- Real-time queue depth and abandonment rate
- Customer journey funnel with drop-off percentages
- Active anomaly alerts with colour-coded severity (CRITICAL / WARN / INFO)
- A reset button to wipe live camera data for demo purposes
