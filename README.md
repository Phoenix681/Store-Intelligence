# Store Intelligence Pipeline (Apex Retail)

An end-to-end edge AI analytics pipeline that tracks offline store footfall, handles complex edge cases (staff exclusion, spatial overlapping), and merges live computer vision data with offline POS transactions to calculate a true conversion funnel.

## 🚀 Quickstart (Under 5 Commands)
To deploy the Intelligence API and start the tracking pipeline:

1. `docker compose up --build -d`
2. `npm run test` *(Optional: Runs integration tests to verify API health)*
3. `cd pipeline`
4. `source venv/Scripts/activate` *(Or activate your local Python environment)*
5. `python detect.py`

## 🎥 Running the Detection Pipeline
The computer vision tracking (`detect.py`) is decoupled from the Node.js API to simulate an edge-to-cloud architecture. 
1. Ensure the Dockerized API is running on port `3000`.
2. Ensure you have the test videos (e.g., `test_video1.mp4`) in the `pipeline/` directory.
3. Run `python detect.py`. 
4. The script will initialize YOLOv8, process the frames, evaluate staff uniforms, and POST structured JSON events directly to the `/events/ingest` endpoint.

## 🏆 Part E: Live Terminal Dashboard (Bonus Claim)
This submission fulfills the **Part E (+10 Bonus Points)** requirement via a hybrid visual and rich-terminal dashboard. 
When executing `detect.py`, the system provides:
1. **Real-time Spatial UI:** An OpenCV window mapping the 2D polygon floor zones, showing active ByteTrack tracking dots, and visually flagging color-masked staff members in real-time.
2. **Rich Terminal Stream:** A live telemetry feed in the console showing state-machine transitions (e.g., `DWELL`, `ENTER`) alongside immediate API HTTP ingestion confirmations.