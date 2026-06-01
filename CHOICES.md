# Engineering Decisions & Trade-Offs

## 1. Detection Model Selection & Staff Exclusion
* **Options Considered:** YOLOv8n + ByteTrack vs. RT-DETR vs. Vision-Language Models (GPT-4V/Claude) for tracking and staff identification.
* **What AI Suggested:** The AI initially suggested using a VLM to classify staff uniforms based on visual prompting to guarantee high accuracy.
* **What I Chose & Why:** I overrode the AI and chose **YOLOv8n + ByteTrack combined with deterministic OpenCV HSV color masking**. Running a VLM on edge hardware for 15fps video would introduce massive latency and throttle the pipeline. By cropping the top 30% of the YOLO bounding box and checking if the dark pixel ratio exceeds 45%, I achieved the same staff-exclusion result natively. Furthermore, I cached this boolean result in the tracking session state to completely eliminate UI flickering and reduce compute overhead to near-zero.

## 2. Event Schema Design Rationale
* **Options Considered:** Emitting granular frame-by-frame coordinate data vs. Stateful Session events (State Machine).
* **What AI Suggested:** The AI suggested a highly normalized schema emitting raw `(x, y)` coordinates every second, leaving the backend to calculate dwells and zones. 
* **What I Chose & Why:** I rejected the raw-coordinate approach and chose a **Stateful Event Schema (`ZONE_ENTER`, `ZONE_DWELL`, `ZONE_EXIT`)**. I designed overlapping 2D floor "mats" in the Python script to map the physical zones. Emitting raw coordinates causes massive payload bloat and shifts heavy spatial compute to the Node.js API. By processing the spatial mapping at the edge (Python) and only emitting state-change events over HTTP, the API remains lightweight, idempotent, and immediately ready for business logic aggregation.

## 3. API Architecture Choice (Single-Camera Deduplication)
* **Options Considered:** Multi-camera Re-ID (using OSNet facial/clothing embeddings) vs. Single-Camera Funnel Tracking.
* **What AI Suggested:** To handle the overlapping FOV between the Entry, Floor, and Billing cameras, the AI suggested integrating deep-learning feature extraction (OSNet) to match visitors across the three different video feeds.
* **What I Chose & Why:** I opted to process the entire conversion funnel using **only the Main Floor camera (CAM_FLOOR_01)**. Implementing true multi-camera Re-ID is too compute-heavy and error-prone for a 3-day constraint, risking severe double-counting in the API. Because the Main Floor camera provides sufficient Field of View (FOV) to capture the Entry threshold, product zones, and Billing queue, relying on a single continuous ByteTrack session structurally guarantees 100% deduplication of visitors from walk-in to checkout.

## 4. Queue Abandonment & Edge-Node Limitations
* **Options Considered:** Emitting `BILLING_QUEUE_ABANDON` only after verifying a lack of POS transactions vs. Emitting on raw spatial exit.
* **What I Chose & Why:** I deliberately configured the edge node to emit `BILLING_QUEUE_ABANDON` on raw spatial exits, acknowledging that true abandonment requires a 5-minute POS correlation window. The edge Python script is intentionally "blind" to offline POS data to remain lightweight. I pushed the complex temporal correlation logic entirely to the Intelligence API (`/metrics` and `/funnel`) where the database can natively handle the math. While this inflates raw abandonment events in the edge stream, the backend safely handles the source of truth, protecting the edge node from heavy cross-referencing logic.