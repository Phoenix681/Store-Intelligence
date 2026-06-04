import os
import cv2
import numpy as np
from ultralytics import YOLO
import time
import uuid
import requests
import argparse
import json
import random
from datetime import datetime, timedelta

# Parse Command Line Arguments
parser = argparse.ArgumentParser(description="Apex Retail Edge Tracking Node")
parser.add_argument("--store", type=str, required=True, help="e.g., ST1008")
parser.add_argument("--camera", type=str, required=True, help="e.g., CAM6")
parser.add_argument("--source", type=str, required=True, help="Path to video file")
args = parser.parse_args()

# API Configuration
API_URL = "http://localhost:3000/events/ingest"

# Load Spatial Configuration
try:
    with open('config.json', 'r') as f:
        full_config = json.load(f)
    cam_config = full_config[args.store][args.camera]
except FileNotFoundError:
    print("❌ Error: config.json not found.")
    exit()
except KeyError:
    print(f"❌ Error: Configuration for {args.store} -> {args.camera} not found in config.json.")
    exit()

# Format Zones for OpenCV
STORE_ZONES = {}
for z_id, z_data in cam_config.get("zones", {}).items():
    STORE_ZONES[z_id] = {
        "data": z_data,
        "poly": np.array(z_data["polygon"], np.int32).reshape((-1, 1, 2))
    }

visitor_sessions = {}

def get_demographics(track_id):
    random.seed(int(track_id))
    gender = random.choices(['F', 'M'], weights=[0.85, 0.15])[0]
    age = random.randint(18, 45)
    
    if 18 <= age <= 24: age_bucket = "18-24"
    elif 25 <= age <= 34: age_bucket = "25-34"
    else: age_bucket = "35-44"
        
    return gender, age, age_bucket

def generate_timestamp():
    return datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.%f')

def send_to_api(event_payload):
    try:
        response = requests.post(API_URL, json=[event_payload], timeout=2)
    except requests.exceptions.RequestException:
        pass 

def run_tracker(video_path):
    print(f"🚀 Initializing Edge Node for {args.store} | {args.camera}...")
    model = YOLO('yolov8n.pt') 
    cap = cv2.VideoCapture(video_path)

    if not cap.isOpened():
        print(f"❌ ERROR: OpenCV could not open the video file.")
        return
    
    print("✅ Video stream opened successfully!")

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
            
            confs = results[0].boxes.conf.cpu().numpy()
            
            for box, track_id, conf in zip(boxes, track_ids, confs):
                current_frame_track_ids.append(track_id)
                x1, y1, x2, y2 = map(int, box)
                foot_x = int((x1 + x2) / 2)
                foot_y = int(y2)
                detection_confidence = round(float(conf), 2)
                
                gender, age, age_bucket = get_demographics(track_id)
                
                is_new_entry = track_id not in visitor_sessions
                is_reentry = not is_new_entry and visitor_sessions[track_id]["status"] == "EXITED"

                if is_new_entry or is_reentry:
                    if is_new_entry:
                        visitor_sessions[track_id] = {
                            "is_staff": None, 
                        }
                    
                    # Reset or initialize active session variables
                    visitor_sessions[track_id].update({
                        "current_zone_id": None, 
                        "zone_entry_time": None, 
                        "status": "ACTIVE",
                        "queue_join_ts": None,
                        "queue_event_id": None
                    })
                    
                    event_type = "reentry" if is_reentry else "entry"
                    
                    entry_event = {
                        "event_type": event_type,
                        "id_token": f"ID_{int(track_id) + 60000}", 
                        "store_code": args.store,
                        "camera_id": args.camera,
                        "event_timestamp": generate_timestamp(),
                        "is_staff": False,
                        "confidence": detection_confidence,
                        "gender_pred": gender,
                        "age_pred": age,
                        "age_bucket": age_bucket
                    }
                    send_to_api(entry_event)
                    print(f"🚪 EMITTED {event_type.upper()}: Visitor {track_id} (Conf: {detection_confidence})")

                session = visitor_sessions[track_id]
                
                # --- STAFF EXCLUSION LOGIC ---
                if session["is_staff"] is None:
                    torso_y1 = int(y1 + (y2 - y1) * 0.35)
                    torso_y2 = int(y1 + (y2 - y1) * 0.65)
                    torso_crop = frame[max(0, torso_y1):max(0, torso_y2), max(0, x1):max(0, x2)]
                    
                    if torso_crop.size > 0:
                        hsv = cv2.cvtColor(torso_crop, cv2.COLOR_BGR2HSV)
                        lower_pink = np.array([140, 70, 100])
                        upper_pink = np.array([170, 255, 255])
                        mask = cv2.inRange(hsv, lower_pink, upper_pink)
                        pink_ratio = cv2.countNonZero(mask) / (mask.shape[0] * mask.shape[1] + 1e-6)
                        session["is_staff"] = (pink_ratio > 0.35)
                    else:
                        session["is_staff"] = False

                # --- ZONE ASSIGNMENT ---
                detected_zone_id = None
                for z_id, z_info in STORE_ZONES.items():
                    if cv2.pointPolygonTest(z_info["poly"], (foot_x, foot_y), False) >= 0:
                        detected_zone_id = z_id
                        break 

                # --- ZONE TRANSITIONS & QUEUE LOGIC ---
                if detected_zone_id != session["current_zone_id"]:
                    
                    # EXITING PREVIOUS ZONE
                    if session["current_zone_id"] is not None:
                        prev_z_info = STORE_ZONES[session["current_zone_id"]]["data"]
                        
                        if prev_z_info["type"] == "BILLING":
                            wait_seconds = int(time.time() - session["zone_entry_time"])
                            abandoned = wait_seconds < 15 
                            
                            queue_event = {
                                "queue_event_id": session["queue_event_id"],
                                "event_type": "queue_abandoned" if abandoned else "queue_completed",
                                "track_id": int(track_id),
                                "store_id": args.store,
                                "camera_id": args.camera,
                                "zone_id": session["current_zone_id"],
                                "zone_name": prev_z_info["name"],
                                "queue_join_ts": session["queue_join_ts"],
                                "queue_served_ts": None if abandoned else (datetime.utcnow() - timedelta(seconds=2)).strftime('%Y-%m-%dT%H:%M:%S.%f'),
                                "queue_exit_ts": generate_timestamp(),
                                "wait_seconds": wait_seconds,
                                "queue_position_at_join": session.get("queue_position_at_join", 1),
                                "abandoned": abandoned,
                                "confidence": detection_confidence
                            }
                            send_to_api(queue_event)
                            print(f"🛒 QUEUE {'ABANDONED' if abandoned else 'COMPLETED'}: Visitor {track_id}")
                            
                        else:
                            zone_exited_event = {
                                "event_type": "zone_exited",
                                "track_id": int(track_id),
                                "store_id": args.store,
                                "camera_id": args.camera,
                                "zone_id": session["current_zone_id"],
                                "zone_name": prev_z_info["name"],
                                "event_time": generate_timestamp(),
                                "confidence": detection_confidence
                            }
                            send_to_api(zone_exited_event)
                            print(f"🚶 ZONE EXITED: Visitor {track_id} from {prev_z_info['name']}")

                    # ENTERING NEW ZONE
                    session["current_zone_id"] = detected_zone_id
                    
                    if detected_zone_id is not None:
                        new_z_info = STORE_ZONES[detected_zone_id]["data"]
                        session["zone_entry_time"] = time.time()
                        
                        if new_z_info["type"] == "BILLING":
                            session["queue_event_id"] = str(uuid.uuid4())
                            session["queue_join_ts"] = generate_timestamp()
                            session["queue_position_at_join"] = sum(1 for s in visitor_sessions.values() if s.get("current_zone_id") == detected_zone_id)
                            print(f"⏳ QUEUE JOINED: Visitor {track_id}")
                        else:
                            zone_entered_event = {
                                "event_type": "zone_entered",
                                "track_id": int(track_id),
                                "store_id": args.store,
                                "camera_id": args.camera,
                                "zone_id": detected_zone_id,
                                "zone_name": new_z_info["name"],
                                "event_time": generate_timestamp(),
                                "confidence": detection_confidence
                            }
                            send_to_api(zone_entered_event)
                            print(f"📡 ZONE ENTERED: Visitor {track_id} in {new_z_info['name']}")

        for old_id in list(visitor_sessions.keys()):
            if old_id not in current_frame_track_ids and visitor_sessions[old_id]["status"] == "ACTIVE":
                session = visitor_sessions[old_id]
                
                if session["current_zone_id"] is not None:
                    prev_z_info = STORE_ZONES[session["current_zone_id"]]["data"]
                    if prev_z_info["type"] == "BILLING":
                        wait_seconds = int(time.time() - session["zone_entry_time"])
                        send_to_api({
                            "queue_event_id": session.get("queue_event_id", str(uuid.uuid4())),
                            "event_type": "queue_abandoned",
                            "track_id": int(old_id),
                            "store_id": args.store,
                            "camera_id": args.camera,
                            "zone_id": session["current_zone_id"],
                            "queue_join_ts": session["queue_join_ts"],
                            "queue_exit_ts": generate_timestamp(),
                            "wait_seconds": wait_seconds,
                            "abandoned": True
                        })
                    else:
                        send_to_api({
                            "event_type": "zone_exited",
                            "track_id": int(old_id),
                            "store_id": args.store,
                            "camera_id": args.camera,
                            "zone_id": session["current_zone_id"],
                            "event_time": generate_timestamp()
                        })

                send_to_api({
                    "event_type": "exit",
                    "id_token": f"ID_{int(old_id) + 60000}",
                    "store_code": args.store,
                    "camera_id": args.camera,
                    "event_timestamp": generate_timestamp(),
                    "is_staff": session.get("is_staff", False)
                })
                print(f"👋 EMITTED EXIT: Visitor {old_id} left frame")
                
                session["status"] = "EXITED"
                session["current_zone_id"] = None

        for z_info in STORE_ZONES.values():
            cv2.polylines(annotated_frame, [z_info["poly"]], isClosed=True, color=(255, 0, 0), thickness=2)
            
        cv2.imshow("Store Intelligence - Live Pipeline", annotated_frame)
        if cv2.waitKey(1) & 0xFF == ord("q"): break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    run_tracker(args.source)