const express = require('express');
const router = express.Router({ mergeParams: true });
const Database = require('better-sqlite3');
const db = new Database('./store_intel.db');

router.get('/', (req, res) => {
    const storeId = req.params.id;
    
    try {
        // Stage 1: Walk-ins (Total unique people who entered any zone)
        const walkIns = db.prepare(`
            SELECT COUNT(DISTINCT visitor_id) AS count 
            FROM events 
            WHERE store_id = ? AND event_type = 'ZONE_ENTER'
        `).get(storeId).count;

        // Stage 2: Engagement (People who dwelled in any zone)
        const engagement = db.prepare(`
            SELECT COUNT(DISTINCT visitor_id) AS count 
            FROM events 
            WHERE store_id = ? AND event_type = 'ZONE_DWELL'
        `).get(storeId).count;

        // Stage 3: Checkout Intent (People who stepped into the Billing area)
        const checkoutIntent = db.prepare(`
            SELECT COUNT(DISTINCT visitor_id) AS count 
            FROM events 
            WHERE store_id = ? AND zone_id = 'BILLING_QUEUE'
        `).get(storeId).count;

        // Stage 4: Conversion (Actual unique invoices printed)
        const purchases = db.prepare(`
            SELECT COUNT(DISTINCT invoice_number) AS count 
            FROM pos_transactions 
            WHERE store_id = ?
        `).get(storeId).count;

        // Calculate final conversion rate
        const conversionRate = walkIns > 0 ? ((purchases / walkIns) * 100).toFixed(2) : 0;

        res.json({
            store_id: storeId,
            date: "2026-04-10",
            funnel_metrics: {
                top_of_funnel_walk_ins: walkIns,
                engaged_visitors: engagement,
                checkout_intent: checkoutIntent,
                successful_purchases: purchases
            },
            overall_conversion_rate: `${conversionRate}%`
        });

    } catch (err) {
        res.status(500).json({ error: "Internal Server Error", details: err.message });
    }
});

module.exports = router;