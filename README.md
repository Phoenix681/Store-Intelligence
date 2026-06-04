# Store Intelligence Pipeline (Apex Retail) 

An end-to-end Edge AI and Analytics pipeline that transforms raw CCTV video feeds into real-time retail intelligence. Built for multi-store scalability, this system tracks customer journeys, correlates physical behavior with POS transaction data, and detects operational anomalies in real-time.

## ✨ Key Features
* **Live Edge Tracking:** Utilizes YOLOv8 + ByteTrack to monitor customer movement, emitting lightweight JSON state changes (`zone_entered`, `queue_completed`).
* **Staff Filtering:** Custom OpenCV HSV masking to identify and exclude staff (pink uniforms) from analytics funnels.
* **Offline POS Integration:** Dynamically correlates physical billing queue joins with offline `.csv` POS transactions using a strict 5-minute time-window join.
* **Real-time Anomaly Engine:** Automatically detects queue spikes, dead zones, extreme dwell times, and conversion rate drops against a 7-day moving average.
* **Live React Dashboard:** A real-time command center polling the API every 3 seconds to visualize the customer funnel.

## 🚀 Quick Start Guide

### Prerequisites
* Docker & Docker Compose
* Python 3.10+
* Node.js (for the React Dashboard)

### 1. Boot the Backend (API & Database)
The system is fully containerized. Booting the Docker container will automatically ingest the POS data and spin up the Express API.
\`\`\`bash
docker compose up --build -d
\`\`\`
*(The API will be available at `http://localhost:3000`)*

### 2. Start the Live Dashboard
Open a new terminal window to start the React frontend:
\`\`\`bash
cd dashboard
npm run dev
\`\`\`
*(View the dashboard at `http://localhost:5173`)*

### 3. Run the Edge Tracking Node
Open a third terminal and run the video through the Python tracker. Ensure you use `ST1008` to match the POS data.
\`\`\`bash
python pipeline/detect.py --store ST1008 --camera CAM6 --source pipeline/data/store_2/billing_area.mp4
\`\`\`

Watch the dashboard update in real-time as the tracker processes the video!

## 🧪 Running Tests
To verify API idempotency, edge cases (Empty Store), and schema compliance:
\`\`\`bash
npm run test
# OR
node tests/api.test.js
node tests/test_ingest.js
\`\`\`