const express = require('express');
const router = express.Router({ mergeParams: true });
const Database = require('better-sqlite3');
const db = new Database('./store_intel.db');

router.get('/', (req, res) => {
    const storeId = req.params.id;
    try {
        // Get raw counts and dwell
        const zones = db.prepare(`
            SELECT zone_id, COUNT(DISTINCT visitor_id) as visits, AVG(dwell_ms) as avg_dwell
            FROM events 
            WHERE store_id = ? AND zone_id IS NOT NULL AND event_type IN ('ZONE_ENTER', 'ZONE_DWELL')
            GROUP BY zone_id
        `).all(storeId);

        if (zones.length === 0) return res.json({ store_id: storeId, heatmap_data: [] });

        // Find the max visits to normalize against
        const maxVisits = Math.max(...zones.map(z => z.visits));

        const normalizedData = zones.map(z => ({
            zone_id: z.zone_id,
            raw_visits: z.visits,
            avg_dwell_ms: Math.round(z.avg_dwell),
            // Normalize exactly as requested by the PDF (0-100)
            heat_intensity_0_to_100: Math.round((z.visits / maxVisits) * 100)
        }));

        res.json({
            store_id: storeId,
            heatmap_data: normalizedData
        });
    } catch (error) {
        res.status(500).json({ error: "Service Unavailable" });
    }
});

module.exports = router;