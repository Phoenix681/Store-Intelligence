const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('./database');

router.get('/', (req, res) => {
    const storeId = req.params.id;
    try {
        // FIX: Check session count for the data_confidence flag
        const sessionCountRes = db.prepare(`SELECT COUNT(DISTINCT visitor_id) as count FROM events WHERE store_id = ? AND is_staff = 0`).get(storeId);
        const sessionCount = sessionCountRes ? sessionCountRes.count : 0;

        const zones = db.prepare(`
            SELECT zone_id, COUNT(DISTINCT visitor_id) as visits, AVG(dwell_ms) as avg_dwell
            FROM events 
            WHERE store_id = ? AND zone_id IS NOT NULL AND is_staff = 0 AND event_type IN ('ZONE_ENTER', 'ZONE_DWELL')
            GROUP BY zone_id
        `).all(storeId);

        if (zones.length === 0) {
            return res.json({ store_id: storeId, data_confidence: false, heatmap_data: [] });
        }

        const maxVisits = Math.max(...zones.map(z => z.visits));

        const normalizedData = zones.map(z => ({
            zone_id: z.zone_id,
            raw_visits: z.visits,
            avg_dwell_ms: Math.round(z.avg_dwell),
            heat_intensity_0_to_100: Math.round((z.visits / maxVisits) * 100)
        }));

        res.json({
            store_id: storeId,
            data_confidence: sessionCount >= 20,
            heatmap_data: normalizedData
        });
    } catch (error) {
        // FIX: Graceful 503 instead of 500
        res.status(503).json({ error: "Service Unavailable", details: error.message });
    }
});

module.exports = router;