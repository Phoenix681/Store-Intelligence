# 🤔 Engineering Choices & AI Rationale

This document outlines the strategic architectural decisions, engineering trade-offs, and AI collaborations that shaped the Apex Retail Intelligence platform.

## 1. Event Schema Rationale: Edge Triggers vs. Polling
* **Initial Approach:** The original specification suggested emitting a `ZONE_DWELL` event every 30 seconds to track engagement. 
* **Final Choice:** After running architecture simulations with AI (Gemini/Claude), I realized streaming continuous polling events creates massive data redundancy and makes dwell-time aggregation computationally expensive in SQLite. 
* **Implementation:** I opted for an **edge-triggered schema** (`zone_entered` and `zone_exited`). The SQLite backend dynamically calculates dwell time via a temporal self-join (`e2.event_timestamp - e1.event_timestamp`). This drastically reduced network payload size from the edge nodes and resulted in a much cleaner, deterministic anomaly detection engine.

## 2. Handling Re-entry and Deduplication
To prevent "double-counting" customers who exit and re-enter the camera frame, the Python edge tracker maintains an internal state machine. 
* If an `"EXITED"` track ID reappears, it emits a dedicated `reentry` event rather than a new `entry` event. 
* On the backend, the `/funnel` and `/metrics` SQL queries aggregate sessions using `COUNT(DISTINCT track_id)`, ensuring the funnel strictly reflects unique customer sessions regardless of physical movement fragmentation.

## 3. POS Correlation Time-Window
Instead of relying on unstable visual re-identification (ReID) to link a physical person to a printed receipt, the backend merges physical behavior with offline sales using a **temporal join**. 
The SQL query successfully matches a `pos_transaction` to a `queue_events` record if:
1. The `store_id` matches.
2. The `abandoned` flag is false.
3. The transaction timestamp occurs strictly within **300 seconds (5 minutes)** of the `queue_join_ts`.

## 4. VLM Evaluation (GPT-4V) for Zone Classification
During prototyping, I evaluated using a Vision-Language Model (VLM) like GPT-4V to dynamically classify store zones. 
* *(e.g., Prompt: "Given this image of a retail store, return a JSON map of the coordinates for the checkout counter and the skincare aisle").*
* **Why it was rejected:** While highly accurate, the VLM introduced ~4-6 seconds of latency per frame and massive API cost overhead. For real-time edge processing, drawing hardcoded static polygons over the camera feed (via `config.json`) and using OpenCV's `pointPolygonTest` proved to be infinitely faster and more reliable for a production environment.

## 5. AI Engineering Limitation: Tracking Fragmentation (ID Switching)
During testing, I observed that the ByteTrack algorithm occasionally experiences "ID switching" (fragmentation) when customers occlude one another at the billing counter. Because the lightweight YOLOv8n model assigns a new `track_id` when it reacquires a person, it can artificially inflate the cumulative "Joined Queue" funnel metrics over long periods. 
* **Production Solution:** To solve this in a full-scale enterprise environment, I would replace the tracking algorithm with a robust ReID model like BoT-SORT, or implement a spatial-temporal smoothing function in the Node.js backend to silently merge tracks that appear in the exact same spatial coordinates within a 2-second window.

---

## 🤖 AI Prompting Evidence (Evaluation Requirement)
*Throughout development, LLMs (Gemini/Claude) were used strictly as pair programmers for boilerplate testing, architecture validation, and SQL optimization.*

**Example Prompt used for `tests/api.test.js`:**
> **# PROMPT:** *"Write a comprehensive zero-dependency Node.js integration test using the native 'http' and 'assert' modules. It must test multiple endpoints (/health, /metrics, /funnel), verify 200 status codes, check the correct store ID, and include an edge-case test for a non-existent empty store to prove graceful degradation."*

> **# CHANGES MADE:** I manually updated the store ID to `ST1008` to perfectly align with the offline POS dataset. I also refactored the native HTTP request into a reusable async wrapper to cleanly test multiple endpoints sequentially without relying on heavy third-party test runners like Jest.