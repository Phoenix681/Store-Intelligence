const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('./database');

// Promisify SQLite for clean async/await execution
const dbGet = (query, params) => new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => err ? reject(err) : resolve(row));
});
const dbAll = (query, params) => new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows));
});

router.get('/', async (req, res) => {
    const storeId = req.params.id;

    try {
        // 1. Get total unique sessions to determine data_confidence
        const sessionCountRes = await dbGet(`
            SELECT COUNT(DISTINCT track_id) as count 
            FROM events 
            WHERE store_id = ? AND is_staff = 0
        `, [storeId]);
        const sessionCount = sessionCountRes ? sessionCountRes.count : 0;

        // 2. Aggregate visits and dynamically calculate average dwell time per zone
        // We use a LEFT JOIN so we still count visits even if the exit event hasn't fired yet
        const zones = await dbAll(`
            SELECT 
                e1.zone_id, 
                e1.zone_name,
                COUNT(DISTINCT e1.track_id) as visits,
                AVG(
                    (strftime('%J', e2.event_timestamp) - strftime('%J', e1.event_timestamp)) * 86400
                ) as avg_dwell_seconds
            FROM events e1
            LEFT JOIN events e2 
                ON e1.track_id = e2.track_id 
                AND e1.zone_id = e2.zone_id 
                AND e2.event_type = 'zone_exited' 
                AND e1.event_timestamp < e2.event_timestamp
            WHERE e1.store_id = ? 
              AND e1.zone_id IS NOT NULL 
              AND e1.is_staff = 0 
              AND e1.event_type = 'zone_entered'
            GROUP BY e1.zone_id, e1.zone_name
        `, [storeId]);

        if (!zones || zones.length === 0) {
            return res.json({ 
                store_id: storeId, 
                data_confidence: false, 
                heatmap_data: [] 
            });
        }

        // 3. Normalize data (0-100 scale for frontend heatmap rendering)
        const maxVisits = Math.max(...zones.map(z => z.visits));

        const normalizedData = zones.map(z => ({
            zone_id: z.zone_id,
            zone_name: z.zone_name || "Unknown Zone",
            raw_visits: z.visits,
            avg_dwell_seconds: z.avg_dwell_seconds ? parseFloat(z.avg_dwell_seconds.toFixed(1)) : 0,
            heat_intensity_0_to_100: maxVisits > 0 ? Math.round((z.visits / maxVisits) * 100) : 0
        }));

        res.json({
            store_id: storeId,
            data_confidence: sessionCount >= 20, // Strict rule from the PDF
            heatmap_data: normalizedData
        });

    } catch (error) {
        console.error(`Heatmap Error for store ${storeId}:`, error);
        // Graceful degradation: HTTP 503 with structured body, NO raw stack traces
        res.status(503).json({ 
            error: "Service Unavailable", 
            message: "Database momentarily unavailable while computing heatmap." 
        });
    }
});

module.exports = router;