# System Design & Architecture

## 1. High-Level Architecture

The platform is built around a decoupled edge-to-cloud pattern. Video processing happens locally at the store; only lightweight structured JSON telemetry crosses the network — not video frames.

```
┌──────────────────────────────────┐       ┌─────────────────────────────────────┐
│  EDGE NODE (Python)              │       │  CLOUD API (Node.js / Docker)        │
│                                  │       │                                      │
│  YOLOv8n + ByteTrack             │ HTTP  │  POST /events/ingest                 │
│  ──────────────────              │──────▶│  ── validates, deduplicates          │
│  Frame → Detection → Tracking    │  JSON │  ── routes to events / queue_events  │
│  → Zone mapping (pointPolygon)   │       │                                      │
│  → Staff exclusion (HSV mask)    │       │  SQLite (multi-table)                │
│  → State machine transitions     │       │  ── events                           │
│  → Emits structured JSON events  │       │  ── queue_events                     │
│                                  │       │  ── pos_transactions                 │
└──────────────────────────────────┘       │                                      │
                                           │  Analytics endpoints                 │
                                           │  /metrics /funnel /heatmap           │
                                           │  /anomalies /health                  │
                                           └──────────────┬──────────────────────┘
                                                          │ polls every 3s
                                           ┌──────────────▼──────────────────────┐
                                           │  React Dashboard (:5173)             │
                                           │  Live funnel, anomaly alerts,        │
                                           │  conversion rate, queue depth        │
                                           └─────────────────────────────────────┘
```

## 2. Detection Pipeline (Edge Node)

### 2.1 Configuration-Driven Zone Mapping
Zone polygons are stored in `config.json` keyed by `store_id → camera_id`. The pipeline loads them at startup using CLI arguments (`--store`, `--camera`, `--source`), making it genuinely multi-store aware without code changes.

### 2.2 Detection and Tracking
- **Model:** YOLOv8n — chosen for real-time performance on commodity hardware at 15fps
- **Tracker:** ByteTrack — persistent `track_id` assignment across frames
- **Foot-point mapping:** Bottom-centre of each bounding box is used as the ground contact point for zone polygon testing via `cv2.pointPolygonTest`

### 2.3 Staff Exclusion
The edge node identifies staff by cropping the torso region (35–65% of bounding box height) and checking for pink HSV values matching Purplle staff uniforms. The boolean result is cached in session state to eliminate per-frame recomputation and UI flickering. Staff events are flagged `is_staff: true` and excluded from all customer metrics at the API layer.

### 2.4 State Machine
Each `track_id` maintains a session dictionary:
- `ACTIVE` → tracking in frame
- `EXITED` → left frame; triggers `exit` event
- Re-appearance of an `EXITED` ID → emits `reentry` instead of `entry`

Zone transitions emit `zone_entered` / `zone_exited`. Billing zone behaviour is handled separately — the edge node tracks `queue_join_ts` and `queue_position_at_join`, and classifies the exit as `queue_abandoned` (wait < 15s) or `queue_completed` (wait ≥ 15s).

## 3. Database Schema (Multi-Table Design)

The schema is normalised into three tables to enable efficient POS correlation and avoid mixed-type queries on a single events table.

### `events` — General Movement Telemetry
```sql
event_id TEXT PRIMARY KEY,
event_type TEXT,           -- entry, zone_entered, zone_exited, reentry, exit
store_id TEXT,
camera_id TEXT,
track_id INTEGER,
zone_id TEXT,
zone_name TEXT,
zone_type TEXT,
is_revenue_zone TEXT,
event_timestamp TEXT,
gender TEXT,               -- demographic inference (seeded by track_id)
age INTEGER,
age_bucket TEXT,
is_staff BOOLEAN,
confidence REAL
```

### `queue_events` — Dedicated Billing Funnel Table
Separated from general events to enable efficient POS time-window joins without scanning the full events table.
```sql
queue_event_id TEXT PRIMARY KEY,
event_type TEXT,           -- queue_completed | queue_abandoned
track_id INTEGER,
store_id TEXT,
zone_id TEXT,
queue_join_ts TEXT,        -- when visitor entered billing zone
queue_served_ts TEXT,      -- when transaction occurred (if completed)
queue_exit_ts TEXT,
wait_seconds INTEGER,
queue_position_at_join INTEGER,
abandoned BOOLEAN
```

### `pos_transactions` — Offline Sales Data
```sql
order_id INTEGER PRIMARY KEY,
order_date TEXT,           -- normalised to YYYY-MM-DD for SQLite time math
order_time TEXT,
store_id TEXT,
product_id INTEGER,
brand_name TEXT,
total_amount REAL
```

## 4. POS Correlation

Conversion is computed by joining `pos_transactions` to `queue_events` on three conditions:
1. `store_id` matches
2. `queue_events.abandoned = 0`
3. The transaction timestamp falls within 300 seconds of `queue_join_ts`

```sql
strftime('%s', p.order_date || ' ' || p.order_time) - strftime('%s', q.queue_join_ts)
BETWEEN 0 AND 300
```

This approach requires no customer identity — it uses spatial + temporal proximity as the proxy for purchase attribution.

## 5. Intelligence API

### Idempotency
`INSERT OR IGNORE` on UUID primary keys in both `events` and `queue_events`. A payload sent twice inserts exactly once. Verified by `tests/test_ingest.js`.

### Partial Success
The ingest endpoint iterates events inside a single SQLite transaction with per-event try/catch. Malformed events increment `failed` without rolling back the entire batch. HTTP 207 is returned when any failures occur; 200 on full success.

### Graceful Degradation
All five analytics endpoints catch database errors and return HTTP 503 with a structured JSON body — no raw stack traces. Empty stores (no events) return safe zero values rather than null or crashes.

## 6. AI-Assisted Decisions

### 6.1 Multi-Table vs Single Events Table
I asked Claude to evaluate whether a single wide `events` table or a normalised multi-table schema would perform better for POS time-window correlation queries. The AI recommended the multi-table approach, noting that joining billing-specific data against a full events table causes unnecessary full-table scans. I agreed and implemented separate `queue_events` and `pos_transactions` tables with dedicated indexes (`idx_queue_store`).

### 6.2 Queue Abandonment Threshold
The original approach emitted `BILLING_QUEUE_ABANDON` on any spatial exit from the billing zone. I consulted an LLM on a better heuristic. It suggested using a minimum dwell threshold — if a customer exits the billing zone in under 15 seconds, it is statistically more likely to be a mis-step than a genuine queue attempt. I implemented `abandoned = wait_seconds < 15` at the edge node, making the abandonment classification data-driven rather than spatially-triggered.

### 6.3 VLM for Zone Classification (Rejected)
I evaluated using GPT-4V to classify store zones dynamically from video frames. The AI itself flagged this as problematic: 4–6 second latency per frame and per-call API cost make it unsuitable for a 15fps pipeline. I overrode this approach and implemented static polygon configuration via `config.json` with `cv2.pointPolygonTest`, which achieves sub-millisecond zone checks.