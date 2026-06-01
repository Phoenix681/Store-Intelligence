# Store Intelligence Pipeline: System Design

## 1. High-Level Architecture
The system is built as a lightweight, decoupled event-driven pipeline designed for edge-to-cloud retail analytics. It is separated into two main components:
1. **Edge Detection Node (Python/Computer Vision):** Processes raw RTSP/Video streams, tracks unique visitors, and emits structured JSON state-change events over HTTP.
2. **Intelligence API (Node.js/Express):** A containerized centralized backend that ingests high-frequency events, maintains idempotency, and aggregates them with offline POS data to calculate business metrics.

## 2. Data Flow
1. **Frame Extraction:** Video is decoded and downsampled (1024x576) to reduce compute overhead while maintaining spatial awareness.
2. **Detection & Tracking:** YOLOv8n combined with ByteTrack performs multi-object tracking (MOT), assigning persistent `track_id`s to visitors.
3. **Spatial Mapping:** Customer foot-coordinates (bottom-center of bounding boxes) are mapped against predefined 2D floor polygons using `cv2.pointPolygonTest`.
4. **State Machine:** A session dictionary tracks `current_zone` and `zone_entry_time`. Transitions trigger `ZONE_ENTER`, `ZONE_DWELL` (5s threshold), or `ZONE_EXIT` events.
5. **Ingestion:** Events are POSTed to the Express `/events/ingest` API endpoint.
6. **Persistence:** Events are saved to a local SQLite database (acting as our time-series/OLAP stand-in).
7. **Aggregation:** The `/funnel` endpoint merges CV footfall data with offline POS transaction data (`pos_transactions.csv`) using a unified `store_id` to calculate the final conversion rate.

## 3. Database Schema (SQLite)
* **`events` table:** `event_id` (PK, UUID), `store_id`, `camera_id`, `visitor_id`, `event_type`, `zone_id`, `dwell_ms`, `timestamp`.
* **`pos_transactions` table:** `invoice_number` (PK), `store_id`, `order_date`.

## 4. AI-Assisted Decisions
Throughout this hackathon, AI tools (specifically Gemini) were heavily leveraged to accelerate development and evaluate architectural trade-offs. 
1. **Docker/Alpine Build Errors:** When attempting to containerize `better-sqlite3`, the AI suggested switching to a heavier Node/Python image. I agreed with this approach because installing native `g++` and `make` tools inside Alpine was causing standard library conflicts, and a slightly larger image size was a worthy trade-off for guaranteed deployment stability (Acceptance Gate priority).
2. **Staff Exclusion Logic:** I prompted the AI to evaluate whether a Vision-Language Model (VLM) would be best for detecting staff uniforms. The AI correctly highlighted the edge-compute latency this would introduce. Instead, we collaboratively designed a deterministic OpenCV HSV color-masking strategy. I overrode the AI's initial frame-by-frame color check and implemented a cached-state logic to save compute cycles and eliminate UI flickering.
3. **Database Selection:** The AI suggested using PostgreSQL for scalability. I explicitly rejected this and chose SQLite. For a containerized edge-node processing a single store's video clips, SQLite provides sufficient ACID compliance without the heavy orchestration overhead of a dedicated Postgres container.