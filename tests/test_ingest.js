/* # PROMPT: "Write a Node.js test script to verify the /events/ingest endpoint. It should test a batch of 100 events and ensure idempotency (sending the same events twice doesn't duplicate them in the database). Test partial success with a malformed payload."
# CHANGES MADE: I updated the payload structure to match the new ST1008 YOLOv8 multi-table schema (track_id, dedicated queue_events, demographic inference). Added strict assertions for idempotency and the HTTP 207 Multi-Status partial success requirement.
*/

const { v4: uuidv4 } = require('uuid');
const assert = require('assert');

const STORE_ID = "ST1008"; // Matches our POS data perfectly

function generateMockEvent(index) {
    const isQueue = Math.random() > 0.8;
    const trackId = Math.floor(index / 2) + 1;

    // Dynamically generate data for both of our new database tables
    if (isQueue) {
        return {
            queue_event_id: uuidv4(),
            event_type: Math.random() > 0.5 ? "queue_completed" : "queue_abandoned",
            track_id: trackId,
            store_id: STORE_ID,
            camera_id: "CAM6",
            zone_id: "PURPLLE_MUM_1008_Z_BILLING_01",
            queue_join_ts: new Date(Date.now() - 60000).toISOString(),
            queue_exit_ts: new Date().toISOString(),
            wait_seconds: 60,
            queue_position_at_join: Math.floor(Math.random() * 5),
            abandoned: false,
            gender: "F",
            age: 25,
            age_bucket: "25-34"
        };
    } else {
        return {
            event_id: uuidv4(),
            event_type: Math.random() > 0.5 ? "entry" : "zone_entered",
            track_id: trackId,
            store_id: STORE_ID,
            camera_id: "CAM1",
            event_timestamp: new Date().toISOString(),
            is_staff: Math.random() > 0.9,
            gender: "F",
            age: 25,
            age_bucket: "25-34"
        };
    }
}

async function runTest() {
    const events = [];
    
    // 1. Generate 100 valid events
    for (let i = 0; i < 100; i++) {
        events.push(generateMockEvent(i));
    }

    // 2. IDEMPOTENCY CHECK: Push the exact same first event again
    events.push(events[0]); 

    // 3. PARTIAL SUCCESS CHECK: Push a completely malformed event (missing store_id)
    events.push({
        event_id: uuidv4(),
        event_type: "zone_entered" 
    });

    console.log(`🚀 Sending batch of ${events.length} events to API...`);

    try {
        const response = await fetch('http://localhost:3000/events/ingest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(events)
        });

        const data = await response.json();
        
        console.log("\n--- Server Response ---");
        console.log(`Status Code: ${response.status}`);
        console.dir(data, { depth: null, colors: true });

        // Verify Partial Success (HTTP 207)
        assert.strictEqual(response.status, 207, "API should return 207 Multi-Status for partial successes");

        // Verify Idempotency (The duplicate is ignored entirely, SQLite returns 0 changes)
        assert.strictEqual(data.inserted, 100, "Idempotency failed: Duplicate event should not be inserted");
        console.log("✅ PASS: Idempotency confirmed (100 inserted, 1 ignored safely).");

        // Verify Malformed Event Catch
        assert.strictEqual(data.failed, 1, "Partial success failed: Malformed event was not caught");
        console.log("✅ PASS: Graceful degradation confirmed (Malformed event caught without crashing the batch).");

        console.log("\n🎉 Ingest integration tests passed successfully.");
        process.exit(0);

    } catch (error) {
        console.error("❌ FAIL: API Test Error -", error.message);
        process.exit(1);
    }
}

runTest();