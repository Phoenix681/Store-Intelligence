const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('./database');

router.get('/', (req, res) => {
    const storeId = req.params.id;
    try {
        // 1. Calculate Total Unique Visitors (Excluding Staff)
        const walkIns = db.prepare(`
            SELECT COUNT(DISTINCT visitor_id) as total 
            FROM events 
            WHERE store_id = ? AND is_staff = 0 AND event_type IN ('ENTRY', 'ZONE_ENTER')
        `).get(storeId).total;

        // 2. Calculate Total Purchases (from the CSV you imported)
        let purchases = 0;
        try {
            purchases = db.prepare(`SELECT COUNT(DISTINCT invoice_number) as total FROM pos_transactions WHERE store_id = ?`).get(storeId).total;
        } catch (err) {
            console.warn("POS table missing or empty, defaulting purchases to 0");
        }

        // 3. Calculate Real Conversion Rate
        const conversionRate = walkIns > 0 ? ((purchases / walkIns) * 100).toFixed(2) : 0;

        // 4. Get Current Queue Depth
        const queueEvent = db.prepare(`
            SELECT metadata FROM events 
            WHERE store_id = ? AND event_type = 'BILLING_QUEUE_JOIN' 
            ORDER BY timestamp DESC LIMIT 1
        `).get(storeId);
        
        let currentQueue = 0;
        if (queueEvent && queueEvent.metadata) {
            const meta = JSON.parse(queueEvent.metadata);
            currentQueue = meta.queue_depth || 0;
        }

        res.json({
            store_id: storeId,
            unique_visitors: walkIns,
            conversion_rate: parseFloat(conversionRate),
            current_queue_depth: currentQueue,
            abandonment_rate: 0 // Mocked for now to save time
        });

    } catch (err) {
        console.error("Metrics Error:", err);
        res.status(503).json({ error: "Service Unavailable", details: err.message });
    }
});

module.exports = router;