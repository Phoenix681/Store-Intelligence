const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('./database');

// Promisify SQLite for clean async/await execution
const dbGet = (query, params) => new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => err ? reject(err) : resolve(row));
});

router.get('/', async (req, res) => {
    const storeId = req.params.id;

    try {
        // 1. Walk-Ins (Stage 1 of Funnel)
        const walkInsRes = await dbGet(`
            SELECT COUNT(DISTINCT track_id) as count 
            FROM events 
            WHERE store_id = ? AND is_staff = 0 AND (event_type = 'entry' OR event_type = 'ENTRY')
        `, [storeId]);
        const walkIns = walkInsRes ? walkInsRes.count : 0;
        
        // 2. Zone Engagements (Stage 2 of Funnel)
        const zoneVisitsRes = await dbGet(`
            SELECT COUNT(DISTINCT track_id) as count 
            FROM events 
            WHERE store_id = ? AND is_staff = 0 AND (event_type = 'zone_entered' OR event_type = 'ZONE_ENTER') AND zone_id IS NOT NULL
        `, [storeId]);
        const zoneVisits = zoneVisitsRes ? zoneVisitsRes.count : 0;
        
        // 3. Queue Joins (Stage 3 of Funnel - Utilizing the new dedicated table)
        const queueJoinsRes = await dbGet(`
            SELECT COUNT(DISTINCT track_id) as count 
            FROM queue_events 
            WHERE store_id = ?
        `, [storeId]);
        const queueJoins = queueJoinsRes ? queueJoinsRes.count : 0;

        // 4. Purchases (Stage 4 of Funnel)
        let purchases = 0;
        try {
            const purchasesRes = await dbGet(`
                SELECT COUNT(DISTINCT p.order_id) as count 
                FROM pos_transactions p
                JOIN queue_events q ON p.store_id = q.store_id
                WHERE p.store_id = ?
                  AND q.abandoned = 0
                  -- Transaction must occur within 5 minutes (300 seconds) of the customer joining the queue
                  AND (
                      strftime('%s', p.order_date || ' ' || p.order_time) - 
                      strftime('%s', q.queue_join_ts)
                  ) BETWEEN 0 AND 300
            `, [storeId]);
            purchases = purchasesRes ? purchasesRes.count : 0;
        } catch (e) {
            console.warn(`POS table missing or empty for ${storeId}, defaulting purchases to 0`);
        }

        // Calculate drop-off percentages safely (preventing divide-by-zero)
        const walkInToEngage = walkIns > 0 ? (((walkIns - zoneVisits) / walkIns) * 100).toFixed(1) : "0.0";
        const engageToQueue = zoneVisits > 0 ? (((zoneVisits - queueJoins) / zoneVisits) * 100).toFixed(1) : "0.0";
        const queueToPurchase = queueJoins > 0 ? (((queueJoins - purchases) / queueJoins) * 100).toFixed(1) : "0.0";

        res.json({
            store_id: storeId,
            funnel_metrics: {
                walk_ins: walkIns,
                engaged_in_zones: zoneVisits,
                joined_billing_queue: queueJoins,
                successful_purchases: purchases
            },
            drop_off_percentages: {
                walk_in_to_engage: `${Math.max(0, walkInToEngage)}%`,
                engage_to_queue: `${Math.max(0, engageToQueue)}%`,
                queue_to_purchase: `${Math.max(0, queueToPurchase)}%`
            }
        });

    } catch (error) {
        console.error(`Funnel Error for store ${storeId}:`, error);
        // Graceful degradation: HTTP 503 with structured body, NO raw stack traces
        res.status(503).json({ 
            error: "Service Unavailable", 
            message: "Database momentarily unavailable while computing funnel metrics." 
        });
    }
});

module.exports = router;