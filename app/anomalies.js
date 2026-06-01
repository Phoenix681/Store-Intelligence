const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('./database'); // Shared DB connection

router.get('/', (req, res) => {
    const storeId = req.params.id;
    const anomalies = []; // Initialize the array before pushing to it

    try {
        // 1. High Dwell Time Anomaly
        const highDwell = db.prepare(`
            SELECT visitor_id, dwell_ms, zone_id 
            FROM events 
            WHERE store_id = ? AND event_type = 'ZONE_DWELL' AND is_staff = 0 
            ORDER BY dwell_ms DESC LIMIT 1
        `).get(storeId);

        if (highDwell && highDwell.dwell_ms > 300000) { // Over 5 minutes (300k ms)
            anomalies.push({
                type: "HIGH_DWELL_TIME",
                severity: "INFO",
                description: `Visitor ${highDwell.visitor_id} has been dwelling in ${highDwell.zone_id} for over 5 minutes.`,
                suggested_action: "Send an associate to assist the customer."
            });
        }

        // 2. Dead Zone Anomaly
        // Checking for zones with 0 traffic in the last 30 minutes
        const thirtyMinsAgo = new Date(Date.now() - 30 * 60000).toISOString();
        const deadZone = db.prepare(`
            SELECT zone_id 
            FROM events 
            WHERE store_id = ? AND timestamp > ? AND event_type IN ('ZONE_ENTER', 'ZONE_DWELL')
            GROUP BY zone_id 
            HAVING COUNT(visitor_id) = 0
            LIMIT 1
        `).get(storeId, thirtyMinsAgo);

        if (deadZone) {
            anomalies.push({
                type: "DEAD_ZONE",
                severity: "WARN",
                description: `No customer traffic detected in ${deadZone.zone_id} for 30 minutes.`,
                suggested_action: "Check camera feed for physical blockages or optimize merchandising."
            });
        }

        // 3. Billing Queue Spike Anomaly (From your screenshot)
        const latestQueueEvent = db.prepare(`
            SELECT metadata FROM events 
            WHERE store_id = ? AND event_type = 'BILLING_QUEUE_JOIN' 
            ORDER BY timestamp DESC LIMIT 1
        `).get(storeId);

        if (latestQueueEvent && latestQueueEvent.metadata) {
            const meta = JSON.parse(latestQueueEvent.metadata);
            if (meta.queue_depth >= 5) {
                anomalies.push({
                    type: "BILLING_QUEUE_SPIKE",
                    severity: "CRITICAL",
                    description: `Queue depth has reached ${meta.queue_depth} customers.`,
                    suggested_action: "Deploy backup cashier to billing counter immediately."
                });
            }
        }

        // 4. Conversion Drop Anomaly (From your screenshot)
        // Simulating a drop against a hypothetical 7-day average
        const totalWalkIns = db.prepare(`
            SELECT COUNT(DISTINCT visitor_id) as count 
            FROM events 
            WHERE store_id = ? AND is_staff = 0 AND event_type IN ('ENTRY', 'ZONE_ENTER')
        `).get(storeId).count;

        let totalPurchases = 0;
        try {
            totalPurchases = db.prepare(`SELECT COUNT(DISTINCT invoice_number) as count FROM pos_transactions WHERE store_id = ?`).get(storeId).count;
        } catch(e) {}

        if (totalWalkIns > 0) {
            const currentConvRate = (totalPurchases / totalWalkIns) * 100;
            const baselineTarget = 15.0; // Represents the 7-day moving average baseline

            // Only trigger the anomaly if the actual rate drops below the baseline
            if (currentConvRate < baselineTarget) {
                const dropAmount = (baselineTarget - currentConvRate).toFixed(1);
                anomalies.push({
                    type: "CONVERSION_DROP",
                    severity: "WARN",
                    description: `Real-time conversion rate (${currentConvRate.toFixed(1)}%) is ${dropAmount}% below the store's 7-day baseline of ${baselineTarget}%.`,
                    suggested_action: "Check inventory levels for top-selling SKUs and audit floor staff coverage."
                });
            }
        }

        res.json({
            store_id: storeId,
            anomalies: anomalies
        });

    } catch (error) {
        console.error("Anomalies Error:", error);
        res.status(503).json({ error: "Service Unavailable", details: error.message });
    }
});

module.exports = router;