import cv2
import numpy as np
from ultralytics import YOLO
import time
import uuid
import requests

# The endpoint of your running Express API
API_URL = "http://localhost:3000/events/ingest"

def format_zone(coords):
    return np.array(coords, np.int32).reshape((-1, 1, 2))

# 1. Define Camera Zones (Mapped from floor plan to 2D pixel coordinates)
STORE_ZONES = {
    "DERMADOC": format_zone([[553, 404], [602, 446], [674, 409], [638, 370]]),
    "MINIMALIST": format_zone([[641, 364], [696, 407], [747, 368], [725, 335]]),
    "AQUALOGICA": format_zone([[730, 330], [761, 352], [820, 314], [797, 306]]),
    "GOOD_VIBES": format_zone([[547, 413], [570, 449], [446, 486], [410, 441]]),
    "THE_FACE_SHOP": format_zone([[253, 489], [276, 535], [411, 491], [395, 451]]),
    "FARM_STAY": format_zone([[242, 492], [262, 559], [115, 567], [99, 538]]),
    "BILLING_QUEUE": format_zone([[1010, 367], [987, 395], [856, 323], [887, 298]]),
    "MAKEUP": format_zone([[730, 360], [816, 313], [992, 418], [909, 493]]),
    "NAIL_UNIT": format_zone([[276, 530],[550, 436],[686, 572],[282, 571]]),
    "FRAGRANCE": format_zone([[906, 501], [735, 375], [606, 454], [742, 575]]),
    "JC": format_zone([[839, 276], [873, 266], [890, 272], [851, 289]]),
    "FOXTALE": format_zone([[810, 291], [826, 298], [843, 290], [829, 281]])
}

# 2. State management
visitor_sessions = {}

def create_event_payload(visitor_id, event_type, zone_id=None, dwell_time=0):
    """Helper to format our JSON payload matching the API schema"""
    return {
        "event_id": str(uuid.uuid4()),
        "store_id": "ST1008",
        "camera_id": "CAM_FLOOR_01",
        "visitor_id": f"VIS_{int(visitor_id)}",
        "event_type": event_type,
        "timestamp": "2026-04-10T" + time.strftime('%H:%M:%SZ', time.gmtime()),
        "zone_id": zone_id,
        "dwell_ms": int(dwell_time * 1000),
        "is_staff": False, 
        "confidence": 0.85,
        "metadata": {
            "queue_depth": None,
            "sku_zone": zone_id,
            "session_seq": 1
        }
    }

def send_to_api(event):
    """Sends the event to the Node.js API."""
    try:
        response = requests.post(API_URL, json=[event], timeout=2)
        if response.status_code in [200, 207]:
            print(f"✅ API SUCCESS: {event['event_type']} saved to database.")
        else:
            print(f"⚠️ API WARNING: Server returned {response.status_code}")
    except requests.exceptions.RequestException as e:
        print(f"❌ API ERROR: Could not connect to Node server. Is it running?")

def run_tracker(video_path):
    print("🚀 Initializing YOLOv8 Tracker & Connecting to API...")
    model = YOLO('yolov8n.pt') 
    cap = cv2.VideoCapture(video_path)

    while cap.isOpened():
        success, frame = cap.read()
        if not success:
            break

        # Resize the raw frame immediately so it matches your coordinates
        frame = cv2.resize(frame, (1024, 576))

        # Pass the resized frame to the model
        results = model.track(frame, persist=True, classes=[0], tracker="bytetrack.yaml", verbose=False)

        # Get the YOLO annotated frame directly at this resolution
        annotated_frame = results[0].plot()

        if results[0].boxes.id is not None:
            boxes = results[0].boxes.xyxy.cpu().numpy()
            track_ids = results[0].boxes.id.cpu().numpy()

            for box, track_id in zip(boxes, track_ids):
                x1, y1, x2, y2 = map(int, box)
                foot_x = int((x1 + x2) / 2)
                foot_y = int(y2)
                
                # Initialize session state FIRST so we can cache the staff check
                if track_id not in visitor_sessions:
                    visitor_sessions[track_id] = {"current_zone": None, "zone_entry_time": None, "is_staff": None}
                
                session = visitor_sessions[track_id]
                
                # --- OPTIMIZED LOGIC: Calculate Staff Status ONLY ONCE ---
                if session["is_staff"] is None:
                    # Isolate the top 30% of the bounding box (the torso/shirt)
                    torso_y2 = int(y1 + (y2 - y1) * 0.3)
                    torso_crop = frame[max(0, y1):max(0, torso_y2), max(0, x1):max(0, x2)]
                    
                    if torso_crop.size > 0:
                        # Convert to HSV and check for black pixels
                        hsv = cv2.cvtColor(torso_crop, cv2.COLOR_BGR2HSV)
                        lower_black = np.array([0, 0, 0])
                        upper_black = np.array([180, 255, 100])
                        mask = cv2.inRange(hsv, lower_black, upper_black)
                        black_ratio = cv2.countNonZero(mask) / (mask.shape[0] * mask.shape[1] + 1e-6)
                        
                        # Save the boolean result permanently
                        session["is_staff"] = (black_ratio > 0.45)
                    else:
                        session["is_staff"] = False

                # If they are staff, draw the static tag and skip tracking them
                if session["is_staff"]:
                    cv2.putText(annotated_frame, "STAFF", (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)
                    continue 

                # If they are NOT staff, draw the tracking dot and proceed to zone logic
                cv2.circle(annotated_frame, (foot_x, foot_y), 5, (0, 255, 0), -1)

                # --- Find which zone they are in ---
                detected_zone = None
                for zone_key, zone_pts in STORE_ZONES.items():
                    if cv2.pointPolygonTest(zone_pts, (foot_x, foot_y), False) >= 0:
                        detected_zone = zone_key
                        break 

                # --- Handle Zone Transitions ---
                if detected_zone:
                    if session["current_zone"] != detected_zone:
                        if session["current_zone"] is not None:
                            event = create_event_payload(track_id, "ZONE_EXIT", session["current_zone"])
                            send_to_api(event)

                        session["current_zone"] = detected_zone
                        session["zone_entry_time"] = time.time()
                        
                        event = create_event_payload(track_id, "ZONE_ENTER", detected_zone)
                        print(f"📡 DETECTED: {event['visitor_id']} ENTERED {detected_zone}")
                        send_to_api(event)
                        
                    else:
                        dwell_time = time.time() - session["zone_entry_time"]
                        if dwell_time > 5: 
                            event = create_event_payload(track_id, "ZONE_DWELL", detected_zone, dwell_time)
                            print(f"⏱️ DETECTED: {event['visitor_id']} DWELLING in {detected_zone} ({int(dwell_time)}s)")
                            send_to_api(event)
                            session["zone_entry_time"] = time.time() 
                            
                else:
                    if session["current_zone"] is not None:
                        event = create_event_payload(track_id, "ZONE_EXIT", session["current_zone"])
                        print(f"🚶 DETECTED: {event['visitor_id']} EXITED {session['current_zone']}")
                        send_to_api(event)
                        session["current_zone"] = None
                        session["zone_entry_time"] = None

        # Draw all zones directly onto the annotated frame at the true resolution
        for zone_key, zone_pts in STORE_ZONES.items():
            cv2.polylines(annotated_frame, [zone_pts], isClosed=True, color=(255, 0, 0), thickness=2)
            
        # Display the frame directly without resizing again
        cv2.imshow("Store Intelligence - Live Pipeline", annotated_frame)

        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    # Pointing to the first video file you specified
    run_tracker("pipeline\\test_video1.mp4")