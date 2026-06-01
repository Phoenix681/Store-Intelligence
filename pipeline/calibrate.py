import cv2

# Store coordinates for the current polygon
current_polygon = []

def click_event(event, x, y, flags, params):
    global current_polygon
    
    # On left mouse click, record the coordinates
    if event == cv2.EVENT_LBUTTONDOWN:
        current_polygon.append([x, y])
        print(f"[{x}, {y}],")
        
        cv2.circle(img, (x, y), 5, (0, 0, 255), -1)
        cv2.imshow('Zone Calibration', img)

# Load video
cap = cv2.VideoCapture('pipeline/test_video1.mp4')
success, img = cap.read()

if not success:
    print("❌ Could not load video frame.")
else:
    print("🎯 Click the corners of a zone on the image. Press 'q' to quit.")

    img = cv2.resize(img, (1024, 576))
    
    cv2.imshow('Zone Calibration', img)
    cv2.setMouseCallback('Zone Calibration', click_event)
    
    cv2.waitKey(0)
    cv2.destroyAllWindows()