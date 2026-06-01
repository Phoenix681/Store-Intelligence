const { v4: uuidv4 } = require('uuid');

const STORE_ID = "STORE_BLR_002";
const CAMERAS = ["CAM_ENTRY_01", "CAM_FLOOR_01", "CAM_BILLING_01"];
const ZONES = ["SKINCARE", "MAKEUP", "HAIRCARE", "BILLING_QUEUE", null];
const EVENT_TYPES = ["ENTRY", "EXIT", "ZONE_ENTER", "ZONE_EXIT", "ZONE_DWELL", "BILLING_QUEUE_JOIN", "BILLING_QUEUE_ABANDON", "REENTRY"];

function generateMockEvent(index) {
    // We group events by visitor to simulate real session flows
    const visitorGroup = Math.floor(index / 5); 
    
    return {
        event_id: uuidv4(),
        store_id: STORE_ID,
        camera_id: CAMERAS[Math.floor(Math.random() * CAMERAS.length)],
        visitor_id: `VIS_mock_${visitorGroup}`, 
        event_type: EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)],
        timestamp: new Date(Date.now() - Math.floor(Math.random() * 10000000)).toISOString(),
        zone_id: ZONES[Math.floor(Math.random() * ZONES.length)],
        dwell_ms: Math.floor(Math.random() * 15000),
        is_staff: Math.random() > 0.9, // 10% chance of being staff
        confidence: parseFloat((Math.random() * (1.0 - 0.7) + 0.7).toFixed(2)),
        metadata: {
            session_seq: (index % 5) + 1,
            queue_depth: Math.floor(Math.random() * 5)
        }
    };
}

async function runTest() {
    const events = [];
    
    // 1. Generate 100 perfectly valid events
    for (let i = 0; i < 100; i++) {
        events.push(generateMockEvent(i));
    }

    // 2. Add an exact duplicate of the first event to test Idempotency (INSERT OR IGNORE)
    events.push(events[0]); 

    // 3. Add a malformed event to test Partial Success (missing required fields)
    events.push({
        event_id: uuidv4(),
        event_type: "ZONE_ENTER" 
        // purposely missing store_id and timestamp
    });

    console.log(`🚀 Sending batch of ${events.length} events to API...`);

    try {
        // Node 18+ has native fetch. If using an older version, you'd need axios.
        const response = await fetch('http://localhost:3000/events/ingest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(events)
        });

        const data = await response.json();
        
        console.log("\n--- Server Response ---");
        console.log(`Status Code: ${response.status}`);
        console.dir(data, { depth: null, colors: true });

    } catch (error) {
        console.error("❌ Connection failed. Is the API running?", error.message);
    }
}

runTest();