const express = require('express');
const router = express.Router();
const db = require('./database');


const insertEvent = db.prepare(`
    INSERT OR IGNORE INTO events (
        event_id, store_id, camera_id, visitor_id, event_type, 
        timestamp, zone_id, dwell_ms, is_staff, confidence, metadata
    ) VALUES (
        @event_id, @store_id, @camera_id, @visitor_id, @event_type, 
        @timestamp, @zone_id, @dwell_ms, @is_staff, @confidence, @metadata
    )
`);

router.post('/ingest', (req, res) => {
    const events = req.body;

    if (!Array.isArray(events)) {
        return res.status(400).json({ error: "Payload must be an array of events." });
    }

    if (events.length > 500) {
        return res.status(413).json({ error: "Batch size exceeds limit of 500." });
    }

    let inserted = 0;
    let failed = 0;
    const errors = [];

    const insertMany = db.transaction((eventsArray) => {
        for (const evt of eventsArray) {
            // TRY/CATCH INSIDE TRANSACTION: Deliberately catching errors per-event 
            // so a single malformed payload doesn't roll back the entire batch (Partial Success requirement).
            try {
                // Basic validation for required fields
                if (!evt.event_id || !evt.store_id || !evt.event_type || !evt.timestamp) {
                    throw new Error("Missing required fields");
                }

                const result = insertEvent.run({
                    event_id: evt.event_id,
                    store_id: evt.store_id,
                    camera_id: evt.camera_id || 'UNKNOWN',
                    visitor_id: evt.visitor_id || 'UNKNOWN',
                    event_type: evt.event_type,
                    timestamp: evt.timestamp,
                    zone_id: evt.zone_id || null,
                    dwell_ms: evt.dwell_ms || 0,
                    is_staff: evt.is_staff === true ? 1 : 0,
                    confidence: evt.confidence || 1.0,
                    metadata: evt.metadata ? JSON.stringify(evt.metadata) : null
                });

                if (result.changes > 0) inserted++;
            } catch (err) {
                failed++;
                errors.push({ event_id: evt.event_id || "unknown", reason: err.message });
            }
        }
    });

    insertMany(events);

    res.status(failed > 0 ? 207 : 200).json({
        message: "Batch processed",
        total_received: events.length,
        inserted: inserted,
        failed: failed,
        errors: errors.length > 0 ? errors : undefined
    });
});

module.exports = router;