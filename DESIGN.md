# 🏗️ System Design & Architecture

## System Architecture Overview
The Apex Retail Intelligence platform is designed around a distributed edge-to-cloud pattern to minimize bandwidth and maximize privacy.

1. **Edge Node (Python/OpenCV/YOLOv8):** Runs locally at the store. It processes video frames, extracts bounding boxes, identifies staff, and emits lightweight JSON telemetry (NOT video).
2. **Ingestion API (Node.js/Express):** A stateless REST API that validates incoming events, returning 207 Multi-Status for partial payload successes.
3. **Database (SQLite):** An asynchronous, multi-table relational database that calculates complex metrics (dwell times, POS joins) on the fly.
4. **Dashboard (React):** A real-time client polling the analytics endpoints to visualize the funnel.

## Database Schema (Multi-Store Optimized)
To avoid massive table scans and optimize queue logic, the schema is normalized into distinct tables.

### 1. `events` (General Telemetry)
Tracks general store movement and demographics.
* `event_id` (PK, UUID)
* `store_id`, `camera_id`, `track_id` (Tracking context)
* `event_type` (`entry`, `zone_entered`, `zone_exited`, `reentry`, `exit`)
* `zone_id`, `zone_name`, `is_revenue_zone`
* `is_staff` (Boolean)
* `confidence` (YOLO detection confidence)

### 2. `queue_events` (Dedicated Funnel Logic)
Optimized for the POS correlation time-window.
* `queue_event_id` (PK)
* `track_id`, `store_id`, `zone_id`
* `queue_join_ts`, `queue_exit_ts`
* `wait_seconds`, `queue_position_at_join`
* `abandoned` (Boolean flag for funnel drop-offs)

### 3. `pos_transactions` (Offline Sales Data)
* `order_id` (PK)
* `order_date`, `order_time` (Standardized to YYYY-MM-DD for SQL time math)
* `total_amount`, `store_id`

## Security & Resilience
* **Graceful Degradation:** Endpoints like `/metrics` handle missing POS tables or empty databases (0 traffic) without crashing, returning safe `0` values.
* **Idempotency:** The ingestion endpoint uses `INSERT OR IGNORE` with UUIDs to prevent double-counting if network lag causes the edge node to retry sending an event.