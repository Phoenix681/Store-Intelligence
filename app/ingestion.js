const express = require('express');
const router = express.Router();
const db = require('./database');

router.post(['/', '/ingest'], (req, res) => {
    let events = req.body;
    if (!Array.isArray(events)) {
        events = [events];
    }

    let inserted = 0;
    let failed = 0;
    let errors = [];
    const seenIds = new Set();

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        const insertQueue = db.prepare(`
            INSERT OR IGNORE INTO queue_events (
                queue_event_id, event_type, track_id, store_id, camera_id, 
                zone_id, zone_name, queue_join_ts, queue_served_ts, queue_exit_ts, 
                wait_seconds, queue_position_at_join, abandoned, gender, age, age_bucket, confidence
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertEvent = db.prepare(`
            INSERT OR IGNORE INTO events (
                event_id, event_type, store_id, camera_id, track_id, 
                zone_id, zone_name, zone_type, is_revenue_zone, event_timestamp, 
                zone_hotspot_x, zone_hotspot_y, gender, age, age_bucket, is_staff, confidence
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        events.forEach(evt => {
            if (!evt.store_id || !evt.event_type) {
                failed++;
                errors.push({ event: evt.event_id || evt.queue_event_id || 'unknown', reason: 'Missing required fields: store_id or event_type' });
                return;
            }

            const id = evt.queue_event_id || evt.event_id || evt.id_token;

            try {
                if (evt.queue_event_id) {
                    insertQueue.run([
                        evt.queue_event_id,
                        evt.event_type,
                        evt.track_id || null,
                        evt.store_id,
                        evt.camera_id || null,
                        evt.zone_id || null,
                        evt.zone_name || null,
                        evt.queue_join_ts || null,
                        evt.queue_served_ts || null,
                        evt.queue_exit_ts || null,
                        evt.wait_seconds || 0,
                        evt.queue_position_at_join || 0,
                        evt.abandoned ? 1 : 0,
                        evt.gender || null,
                        evt.age || null,
                        evt.age_bucket || null,
                        evt.confidence || 1.0
                    ]);
                } else {
                    insertEvent.run([
                        evt.event_id || evt.id_token,
                        evt.event_type,
                        evt.store_code || evt.store_id,
                        evt.camera_id || null,
                        evt.track_id || (evt.id_token ? parseInt(evt.id_token.replace('ID_', '')) : null),
                        evt.zone_id || null,
                        evt.zone_name || null,
                        evt.zone_type || null,
                        evt.is_revenue_zone || null,
                        evt.event_timestamp || evt.event_time,
                        evt.zone_hotspot_x || null,
                        evt.zone_hotspot_y || null,
                        evt.gender_pred || evt.gender || null,
                        evt.age_pred || evt.age || null,
                        evt.age_bucket || null,
                        evt.is_staff === true ? 1 : 0,
                        evt.confidence || 1.0
                    ]);
                }

                // Telemetry matching: Only increment counter if it's genuinely unique in this transmission
                if (!seenIds.has(id)) {
                    seenIds.add(id);
                    inserted++;
                }
            } catch (err) {
                failed++;
                errors.push({ event: id, reason: err.message });
            }
        });

        insertQueue.finalize();
        insertEvent.finalize();

        db.run('COMMIT', (err) => {
            if (err) {
                return res.status(500).json({ error: 'Transaction commit failed' });
            }
            res.status(207).json({
                message: 'Batch processed',
                total_received: events.length,
                inserted,
                failed,
                errors: errors.length > 0 ? errors : undefined
            });
        });
    });
});

module.exports = router;