const express = require('express');
// mergeParams ensures we can read the :id from the parent router
const router = express.Router({ mergeParams: true }); 
const db = require('./database');

router.get('/', (req, res) => {
    const storeId = req.params.id;

    try {
        // 1. Unique Visitors (excluding staff)
        const visitorRow = db.prepare(`
            SELECT COUNT(DISTINCT visitor_id) as unique_visitors 
            FROM events 
            WHERE store_id = ? AND is_staff = 0 AND event_type = 'ENTRY'
        `).get(storeId);

        // 2. Average Dwell Time Per Zone
        const dwellRows = db.prepare(`
            SELECT zone_id, AVG(dwell_ms) as avg_dwell_ms
            FROM events
            WHERE store_id = ? AND event_type = 'ZONE_DWELL' AND is_staff = 0 AND zone_id IS NOT NULL
            GROUP BY zone_id
        `).all(storeId);

        // 3. Queue Abandonment Rate
        const queueStats = db.prepare(`
            SELECT 
                SUM(CASE WHEN event_type = 'BILLING_QUEUE_JOIN' THEN 1 ELSE 0 END) as joins,
                SUM(CASE WHEN event_type = 'BILLING_QUEUE_ABANDON' THEN 1 ELSE 0 END) as abandons
            FROM events
            WHERE store_id = ? AND is_staff = 0
        `).get(storeId);

        const abandonmentRate = (queueStats.joins > 0) 
            ? parseFloat((queueStats.abandons / queueStats.joins).toFixed(2)) 
            : 0;

        // 4. Current Queue Depth (Parse from the most recent event's metadata)
        const latestQueueEvent = db.prepare(`
            SELECT metadata 
            FROM events 
            WHERE store_id = ? AND event_type = 'BILLING_QUEUE_JOIN'
            ORDER BY timestamp DESC LIMIT 1
        `).get(storeId);

        let currentQueueDepth = 0;
        if (latestQueueEvent && latestQueueEvent.metadata) {
            const meta = JSON.parse(latestQueueEvent.metadata);
            currentQueueDepth = meta.queue_depth || 0;
        }

        // 5. Conversion Rate (Placeholder)
        // We will tackle the complex POS data correlation later. 
        // For now, we return 0 so the API contract is fulfilled.
        const conversion_rate = 0; 

        // Format the response to match standard API expectations
        res.json({
            store_id: storeId,
            unique_visitors: visitorRow.unique_visitors || 0,
            conversion_rate: conversion_rate,
            abandonment_rate: abandonmentRate,
            current_queue_depth: currentQueueDepth,
            avg_dwell_per_zone: dwellRows.reduce((acc, row) => {
                acc[row.zone_id] = Math.round(row.avg_dwell_ms);
                return acc;
            }, {})
        });

    } catch (error) {
        console.error("Metrics Calculation Error:", error);
        // Failsafe HTTP 503 response as mandated by the graceful degradation requirement
        res.status(503).json({ 
            error: "Service Unavailable",
            message: "Unable to compute metrics at this time."
        });
    }
});

module.exports = router;