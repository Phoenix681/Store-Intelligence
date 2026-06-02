# Store Intelligence Pipeline (Apex Retail)

An end-to-end edge AI analytics pipeline that tracks offline store footfall, handles complex edge cases (staff exclusion, spatial overlapping), and merges live computer vision data with offline POS transactions to calculate a true conversion funnel.

## 🚀 Quickstart (Under 5 Commands)
To deploy the Intelligence API and start the tracking pipeline:

1. `docker compose up --build -d`
2. `node import_csv.js` *(Loads offline POS transaction data into SQLite)*
3. `npm run test` *(Optional: Runs integration tests to verify API health)*
5. Activate environment: `source venv/bin/activate` (Mac/Linux) or `venv\Scripts\activate` (Windows).
4. `cd pipeline`
6. `python detect.py`

## 🎥 Running the Detection Pipeline
The computer vision tracking (`detect.py`) is decoupled from the Node.js API to simulate an edge-to-cloud architecture. 
1. Ensure the Dockerized API is running on port `3000`.
2. Ensure you have the test video in the `pipeline/` directory and **name it `test_video1.mp4`**. *(Note: The spatial polygons are currently calibrated for the CAM 1 perspective. If testing with CAMs 2-5, `calibrate.py` must be run first to remap the store zones).*
3. Navigate to the pipeline directory (`cd pipeline`) and run `python detect.py`.
4. The script will initialize YOLOv8, process the frames, evaluate staff uniforms, and POST structured JSON events directly to the `/events/ingest` endpoint.

## 🏆 Part E: Live Terminal Dashboard (Bonus Claim)
This submission fulfills the **Part E (+10 Bonus Points)** requirement via a hybrid visual and rich-terminal dashboard. 
When executing `detect.py`, the system provides:
1. **Real-time Spatial UI:** An OpenCV window mapping the 2D polygon floor zones, showing active ByteTrack tracking dots, and visually flagging color-masked staff members in real-time.
2. **Rich Terminal Stream:** A live telemetry feed in the console showing state-machine transitions (e.g., `DWELL`, `ENTER`) alongside immediate API HTTP ingestion confirmations.