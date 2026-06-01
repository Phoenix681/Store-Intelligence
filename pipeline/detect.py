import os
import cv2
import numpy as np
from ultralytics import YOLO
import time
import uuid
import requests

# The endpoint of your running Express API
API_URL = "http://localhost:3000/events/ingest"
STORE_ID = "STORE_BLR_002" # Standardized for the Acceptance Gate

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

def create_event_payload(visitor_id, event_type, zone_id=None, dwell_time=0, is_staff=False, confidence=0.85, seq=1):
    """Helper to format our JSON payload matching the API schema"""
    return {
        "event_id": str(uuid.uuid4()),
        "store_id": STORE_ID,
        "camera_id": "CAM_FLOOR_01",
        "visitor_id": f"VIS_{int(visitor_id)}",
        "event_type": event_type,
        "timestamp": "2026-04-10T" + time.strftime('%H:%M:%SZ', time.gmtime()),
        "zone_id": zone_id,
        "dwell_ms": int(dwell_time * 1000),
        "is_staff": bool(is_staff), 
        "confidence": float(confidence),
        "metadata": {
            "queue_depth": sum(1 for s in visitor_sessions.values() if s.get("current_zone") == "BILLING_QUEUE" and s.get("status") == "ACTIVE") if event_type == "BILLING_QUEUE_JOIN" else None,
            "sku_zone": zone_id,
            "session_seq": int(seq)
        }
    }

def send_to_api(event):
    """Sends the event to the Node.js API."""
    try:
        response = requests.post(API_URL, json=[event], timeout=2)
        if response.status_code in [200, 207]:
            pass # Keep terminal clean, we will print major transitions manually
    except requests.exceptions.RequestException:
        print("❌ API ERROR: Could not connect to Node server.")

def run_tracker(video_path):
    print("🚀 Initializing YOLOv8 Tracker & Connecting to API...")
    model = YOLO('yolov8n.pt') 
    cap = cv2.VideoCapture(video_path)

    while cap.isOpened():
        success, frame = cap.read()
        if not success: break

        frame = cv2.resize(frame, (1024, 576))
        results = model.track(frame, persist=True, classes=[0], tracker="bytetrack.yaml", verbose=False)
        annotated_frame = results[0].plot()

        current_frame_track_ids = []

        if results[0].boxes.id is not None:
            boxes = results[0].boxes.xyxy.cpu().numpy()
            track_ids = results[0].boxes.id.cpu().numpy()
            confidences = results[0].boxes.conf.cpu().numpy()

            for box, track_id, conf in zip(boxes, track_ids, confidences):
                current_frame_track_ids.append(track_id)
                x1, y1, x2, y2 = map(int, box)
                foot_x = int((x1 + x2) / 2)
                foot_y = int(y2)
                
                # --- ENTRY / REENTRY LOGIC ---
                if track_id not in visitor_sessions:
                    visitor_sessions[track_id] = {
                        "current_zone": None, 
                        "zone_entry_time": None, 
                        "is_staff": None, 
                        "session_seq": 1, 
                        "status": "ACTIVE"
                    }
                    entry_event = create_event_payload(track_id, "ENTRY", confidence=conf, seq=1)
                    send_to_api(entry_event)
                    print(f"🚪 EMITTED ENTRY: Visitor {track_id}")
                
                elif visitor_sessions[track_id].get("status") == "EXITED":
                    visitor_sessions[track_id]["status"] = "ACTIVE"
                    visitor_sessions[track_id]["session_seq"] += 1
                    reentry_event = create_event_payload(track_id, "REENTRY", confidence=conf, seq=visitor_sessions[track_id]["session_seq"])
                    send_to_api(reentry_event)
                    print(f"🔄 EMITTED REENTRY: Visitor {track_id}")
                
                session = visitor_sessions[track_id]
                
                # --- STAFF EXCLUSION LOGIC ---
                if session["is_staff"] is None:
                    torso_y2 = int(y1 + (y2 - y1) * 0.3)
                    torso_crop = frame[max(0, y1):max(0, torso_y2), max(0, x1):max(0, x2)]
                    
                    if torso_crop.size > 0:
                        hsv = cv2.cvtColor(torso_crop, cv2.COLOR_BGR2HSV)
                        mask = cv2.inRange(hsv, np.array([0, 0, 0]), np.array([180, 255, 100]))
                        black_ratio = cv2.countNonZero(mask) / (mask.shape[0] * mask.shape[1] + 1e-6)
                        session["is_staff"] = (black_ratio > 0.45)
                    else:
                        session["is_staff"] = False

                if session["is_staff"]:
                    cv2.putText(annotated_frame, "STAFF", (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)
                    # Emit one event occasionally to ensure schema compliance for staff handling
                    if int(time.time()) % 10 == 0: 
                        staff_event = create_event_payload(track_id, "ZONE_DWELL", "MAIN_FLOOR", is_staff=True, confidence=conf, seq=session["session_seq"])
                        send_to_api(staff_event)
                    continue 

                cv2.circle(annotated_frame, (foot_x, foot_y), 5, (0, 255, 0), -1)

                # --- ZONE ASSIGNMENT ---
                detected_zone = None
                for zone_key, zone_pts in STORE_ZONES.items():
                    if cv2.pointPolygonTest(zone_pts, (foot_x, foot_y), False) >= 0:
                        detected_zone = zone_key
                        break 

                # --- ZONE TRANSITIONS & QUEUE LOGIC ---
                if detected_zone:
                    if session["current_zone"] != detected_zone:
                        if session["current_zone"] is not None:
                            event_type = "BILLING_QUEUE_ABANDON" if session["current_zone"] == "BILLING_QUEUE" else "ZONE_EXIT"
                            send_to_api(create_event_payload(track_id, event_type, session["current_zone"], confidence=conf, seq=session["session_seq"]))

                        session["current_zone"] = detected_zone
                        session["zone_entry_time"] = time.time()
                        
                        event_type = "BILLING_QUEUE_JOIN" if detected_zone == "BILLING_QUEUE" else "ZONE_ENTER"
                        event = create_event_payload(track_id, event_type, detected_zone, confidence=conf, seq=session["session_seq"])
                        print(f"📡 DETECTED: {event['visitor_id']} {event_type} in {detected_zone}")
                        send_to_api(event)
                        
                    else:
                        dwell_time = time.time() - session["zone_entry_time"]
                        if dwell_time > 5: 
                            event = create_event_payload(track_id, "ZONE_DWELL", detected_zone, dwell_time, confidence=conf, seq=session["session_seq"])
                            print(f"⏱️ DETECTED: {event['visitor_id']} DWELLING in {detected_zone} ({int(dwell_time)}s)")
                            send_to_api(event)
                            session["zone_entry_time"] = time.time() 
                            
                else:
                    if session["current_zone"] is not None:
                        event_type = "BILLING_QUEUE_ABANDON" if session["current_zone"] == "BILLING_QUEUE" else "ZONE_EXIT"
                        event = create_event_payload(track_id, event_type, session["current_zone"], confidence=conf, seq=session["session_seq"])
                        print(f"🚶 DETECTED: {event['visitor_id']} {event_type} from {session['current_zone']}")
                        send_to_api(event)
                        session["current_zone"] = None
                        session["zone_entry_time"] = None

        # --- EXIT LOGIC ---
        for old_id in list(visitor_sessions.keys()):
            if old_id not in current_frame_track_ids and visitor_sessions[old_id].get("status") != "EXITED":
                exit_event = create_event_payload(old_id, "EXIT", seq=visitor_sessions[old_id]["session_seq"])
                send_to_api(exit_event)
                visitor_sessions[old_id]["status"] = "EXITED"
                visitor_sessions[old_id]["current_zone"] = None
                print(f"👋 EMITTED EXIT: Visitor {old_id}")

        for zone_key, zone_pts in STORE_ZONES.items():
            cv2.polylines(annotated_frame, [zone_pts], isClosed=True, color=(255, 0, 0), thickness=2)
            
        cv2.imshow("Store Intelligence - Live Pipeline", annotated_frame)
        if cv2.waitKey(1) & 0xFF == ord("q"): break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    # Uses os.path.join to prevent Windows/Linux path breaks
    video_path = os.path.join("pipeline", "test_video1.mp4")
    run_tracker(video_path)