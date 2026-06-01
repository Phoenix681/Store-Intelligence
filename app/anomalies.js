const express = require('express');
const router = express.Router({ mergeParams: true });
const Database = require('better-sqlite3');
const db = new Database('./store_intel.db');

router.get('/', (req, res) => {
    const storeId = req.params.id;
    const anomalies = [];

    try {
        // 1. High Dwell Time Anomaly (Customer might need help)
        // Looks for any DWELL events where the person stayed longer than 15 seconds (15000 ms)
        const loiteringEvents = db.prepare(`
            SELECT visitor_id, zone_id, dwell_ms 
            FROM events 
            WHERE store_id = ? AND event_type = 'ZONE_DWELL' AND dwell_ms > 15000
            ORDER BY timestamp DESC LIMIT 5
        `).all(storeId);

        if (loiteringEvents.length > 0) {
            loiteringEvents.forEach(event => {
                anomalies.push({
                    type: "HIGH_DWELL_TIME",
                    severity: "WARN",
                    description: `Customer ${event.visitor_id} has been dwelling in ${event.zone_id} for ${(event.dwell_ms / 1000).toFixed(1)} seconds.`,
                    suggested_action: `Send staff to ${event.zone_id} to offer assistance or check for loitering.`
                });
            });
        }

        // 2. Dead Zone Anomaly (No visits recently)
        // Uses a fake 30 min window and the REAL zones mapped in your Python script
        const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        
        const activeZones = db.prepare(`
            SELECT DISTINCT zone_id 
            FROM events 
            WHERE store_id = ? AND zone_id IS NOT NULL AND timestamp > ?
        `).all(storeId, thirtyMinsAgo).map(z => z.zone_id);

        // Actual zones mapped in detect.py
        const allZones = ["DERMADOC", "MINIMALIST", "AQUALOGICA", "MAKEUP"]; 
        const deadZones = allZones.filter(z => !activeZones.includes(z));

        deadZones.forEach(zone => {
            anomalies.push({
                type: "DEAD_ZONE",
                severity: "INFO",
                description: `Zero customer visits detected in ${zone} recently.`,
                suggested_action: "Audit zone for physical blockages, lighting issues, or restock."
            });
        });

        res.json({
            store_id: storeId,
            timestamp: new Date().toISOString(),
            active_anomalies: anomalies
        });

    } catch (error) {
        console.error("Anomaly Detection Error:", error);
        res.status(503).json({ error: "Service Unavailable", details: error.message });
    }
});

module.exports = router;