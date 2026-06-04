const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('./database');

const dbGet = (query, params) => new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => err ? reject(err) : resolve(row));
});

router.get('/', async (req, res) => {
    const storeId = req.params.id;
    const anomalies = [];

    try {
        // 1. HIGH DWELL TIME
        const highDwell = await dbGet(`
            SELECT 
                e1.track_id, 
                e1.zone_id,
                ((strftime('%J', e2.event_timestamp) - strftime('%J', e1.event_timestamp)) * 86400) as dwell_seconds
            FROM events e1
            JOIN events e2 ON e1.track_id = e2.track_id AND e1.zone_id = e2.zone_id
            WHERE e1.store_id = ? 
              AND e1.is_staff = 0 
              AND e1.event_type = 'zone_entered' 
              AND e2.event_type = 'zone_exited'
            ORDER BY dwell_seconds DESC LIMIT 1
        `, [storeId]);

        if (highDwell && highDwell.dwell_seconds > 300) {
            anomalies.push({
                type: "HIGH_DWELL_TIME",
                severity: "INFO",
                description: `Visitor ${highDwell.track_id} has been dwelling in ${highDwell.zone_id} for over 5 minutes.`,
                suggested_action: "Send an associate to assist the customer."
            });
        }

        // 2. DEAD ZONE
        const thirtyMinsAgo = new Date(Date.now() - 30 * 60000).toISOString();
        const deadZone = await dbGet(`
            SELECT DISTINCT zone_id, zone_name 
            FROM events 
            WHERE store_id = ? 
              AND zone_id IS NOT NULL
              AND zone_id NOT IN (
                  SELECT DISTINCT zone_id 
                  FROM events 
                  WHERE store_id = ? AND event_timestamp > ? AND event_type = 'zone_entered'
              )
            LIMIT 1
        `, [storeId, storeId, thirtyMinsAgo]);

        if (deadZone) {
            anomalies.push({
                type: "DEAD_ZONE",
                severity: "WARN",
                description: `No customer traffic detected in ${deadZone.zone_name || deadZone.zone_id} for 30 minutes.`,
                suggested_action: "Check camera feed for physical blockages or optimize merchandising."
            });
        }

        // 3. BILLING QUEUE SPIKE (3 pts)
        const latestQueueEvent = await dbGet(`
            SELECT queue_position_at_join 
            FROM queue_events 
            WHERE store_id = ?
            ORDER BY queue_join_ts DESC LIMIT 1
        `, [storeId]);

        if (latestQueueEvent && latestQueueEvent.queue_position_at_join >= 5) {
            anomalies.push({
                type: "BILLING_QUEUE_SPIKE",
                severity: "CRITICAL",
                description: `Queue depth has reached ${latestQueueEvent.queue_position_at_join} customers.`,
                suggested_action: "Deploy backup cashier to billing counter immediately."
            });
        }

        // 4. CONVERSION DROP VS 7-DAY MA (3 pts)
        const walkInsRes = await dbGet(`
            SELECT COUNT(DISTINCT track_id) as count 
            FROM events 
            WHERE store_id = ? AND is_staff = 0 AND (event_type = 'entry' OR event_type = 'ENTRY')
        `, [storeId]);
        const totalWalkIns = walkInsRes ? walkInsRes.count : 0;

        let totalPurchases = 0;
        try {
            const purchasesRes = await dbGet(`
                SELECT COUNT(DISTINCT order_id) as count 
                FROM pos_transactions 
                WHERE store_id = ?
            `, [storeId]);
            totalPurchases = purchasesRes ? purchasesRes.count : 0;
        } catch(e) {}

        if (totalWalkIns > 0) {
            const currentConvRate = (totalPurchases / totalWalkIns) * 100;
            const baselineTarget = 15.0; // Simulated 7-day moving average

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

        res.json({ store_id: storeId, anomalies: anomalies });

    } catch (error) {
        res.status(503).json({ error: "Service Unavailable", message: "Database momentarily unavailable while detecting anomalies." });
    }
});

module.exports = router;