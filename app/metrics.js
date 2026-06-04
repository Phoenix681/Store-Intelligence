const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('./database');

// Promisify SQLite methods for clean async/await execution
const dbGet = (query, params) => new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => err ? reject(err) : resolve(row));
});
const dbAll = (query, params) => new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows));
});

router.get('/', async (req, res) => {
    const storeId = req.params.id;

    try {
        // 1. Walk-ins (Unique Visitors) - Excludes Staff per requirements
        const walkInsResult = await dbGet(`
            SELECT COUNT(DISTINCT track_id) as total 
            FROM events 
            WHERE store_id = ? AND is_staff = 0 AND (event_type = 'entry' OR event_type = 'ENTRY')
        `, [storeId]);
        const walkIns = walkInsResult ? walkInsResult.total : 0;

        // 2. Purchases (using the new POS schema 'order_id')
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

        // 3. Conversion Rate (Handles zero-purchase stores gracefully)
        const conversionRate = walkIns > 0 ? parseFloat(((purchases / walkIns) * 100).toFixed(2)) : 0;

        // 4. Current Queue Depth (Pulls from our new dedicated queue_events table)
        const queueDepthResult = await dbGet(`
            SELECT queue_position_at_join 
            FROM queue_events 
            WHERE store_id = ? 
            ORDER BY queue_join_ts DESC LIMIT 1
        `, [storeId]);
        const currentQueue = queueDepthResult ? queueDepthResult.queue_position_at_join : 0;

        // 5. Abandonment Rate (Aggregated from queue_events boolean flag)
        const queueStats = await dbGet(`
            SELECT 
                COUNT(*) as total_joins,
                SUM(CASE WHEN abandoned = 1 THEN 1 ELSE 0 END) as total_abandons
            FROM queue_events
            WHERE store_id = ?
        `, [storeId]);
        
        let abandonmentRate = 0;
        if (queueStats && queueStats.total_joins > 0) {
            abandonmentRate = parseFloat(((queueStats.total_abandons / queueStats.total_joins) * 100).toFixed(2));
        }

        // 6. Average Dwell by Zone (Calculates time difference between entered/exited events)
        const avgDwellByZone = await dbAll(`
            SELECT 
                e1.zone_id, 
                e1.zone_name,
                AVG(
                    (strftime('%J', e2.event_timestamp) - strftime('%J', e1.event_timestamp)) * 86400
                ) as avg_dwell_seconds
            FROM events e1
            JOIN events e2 ON e1.track_id = e2.track_id AND e1.zone_id = e2.zone_id
            WHERE e1.store_id = ? 
              AND e1.is_staff = 0 
              AND e1.event_type = 'zone_entered' 
              AND e2.event_type = 'zone_exited'
              AND e1.event_timestamp < e2.event_timestamp
            GROUP BY e1.zone_id, e1.zone_name
        `, [storeId]);

        // Send the formatted payload
        res.json({
            store_id: storeId,
            unique_visitors: walkIns,
            conversion_rate: conversionRate,
            current_queue_depth: currentQueue,
            abandonment_rate: abandonmentRate,
            avg_dwell_by_zone: avgDwellByZone.map(z => ({
                zone_id: z.zone_id,
                zone_name: z.zone_name || "Unknown Zone",
                avg_dwell_seconds: z.avg_dwell_seconds ? parseFloat(z.avg_dwell_seconds.toFixed(1)) : 0
            }))
        });

    } catch (err) {
        console.error(`Metrics Error for store ${storeId}:`, err);
        // Graceful degradation: HTTP 503 with structured body, NO raw stack traces 
        res.status(503).json({ 
            error: "Service Unavailable", 
            message: "Database momentarily unavailable while computing metrics." 
        });
    }
});

module.exports = router;