const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('./database');

router.get('/', (req, res) => {
    const storeId = req.params.id;
    try {
        const walkIns = db.prepare(`SELECT COUNT(DISTINCT visitor_id) as count FROM events WHERE store_id = ? AND is_staff = 0 AND event_type IN ('ENTRY', 'ZONE_ENTER')`).get(storeId).count;
        
        const zoneVisits = db.prepare(`SELECT COUNT(DISTINCT visitor_id) as count FROM events WHERE store_id = ? AND is_staff = 0 AND zone_id IS NOT NULL`).get(storeId).count;
        
        const queueJoins = db.prepare(`SELECT COUNT(DISTINCT visitor_id) as count FROM events WHERE store_id = ? AND is_staff = 0 AND event_type = 'BILLING_QUEUE_JOIN'`).get(storeId).count;

        let purchases = 0;
        try {
            purchases = db.prepare(`
                SELECT COUNT(DISTINCT p.invoice_number) as count 
                FROM pos_transactions p
                JOIN events e ON p.store_id = e.store_id
                WHERE p.store_id = ? 
                  AND e.event_type = 'BILLING_QUEUE_JOIN' 
                  AND e.is_staff = 0
                  AND (strftime('%s', p.order_date) - strftime('%s', e.timestamp)) BETWEEN 0 AND 300
            `).get(storeId).count;
        } catch(e) {}

        res.json({
            store_id: storeId,
            funnel_metrics: {
                walk_ins: walkIns,
                engaged_in_zones: zoneVisits,
                joined_billing_queue: queueJoins,
                successful_purchases: purchases
            },
            drop_off_percentages: {
                walk_in_to_engage: walkIns > 0 ? (((walkIns - zoneVisits) / walkIns) * 100).toFixed(1) + "%" : "0%",
                engage_to_queue: zoneVisits > 0 ? (((zoneVisits - queueJoins) / zoneVisits) * 100).toFixed(1) + "%" : "0%",
                queue_to_purchase: queueJoins > 0 ? (((queueJoins - purchases) / queueJoins) * 100).toFixed(1) + "%" : "0%"
            }
        });
    } catch (error) {
        res.status(503).json({ error: "Service Unavailable", details: "Database connection failed or table missing" });
    }
});

module.exports = router;