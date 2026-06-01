const express = require('express');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;

// Import routers
const db = require('./database');
const ingestionRouter = require('./ingestion');
const metricsRouter = require('./metrics');
const funnelRouter = require('./funnel');
const heatmapRouter = require('./heatmap');
const anomaliesRouter = require('./anomalies');

// Middleware to parse JSON
app.use(express.json({ limit: '10mb' }));

// --- STRUCTURED LOGGING MIDDLEWARE ---
app.use((req, res, next) => {
    const start = Date.now();
    const traceId = crypto.randomUUID();
    
    // Extract store_id from URL if it exists (e.g., /stores/STORE_BLR_002/...)
    const storeIdMatch = req.originalUrl.match(/\/stores\/([^\/]+)/);
    const storeId = storeIdMatch ? storeIdMatch[1] : "N/A";
    
    // Calculate event count for the ingest endpoint
    const eventCount = (req.originalUrl === '/events/ingest' && Array.isArray(req.body)) 
        ? req.body.length 
        : 0;

    // Hook into the response 'finish' event to calculate latency
    res.on('finish', () => {
        const latencyMs = Date.now() - start;
        
        const logEntry = {
            trace_id: traceId,
            store_id: storeId,
            endpoint: req.method + " " + req.originalUrl,
            latency_ms: latencyMs,
            event_count: eventCount,
            status_code: res.statusCode
        };
        
        // Output as a pure JSON string so log aggregators can parse it
        console.log(JSON.stringify(logEntry));
    });

    next();
});

// Mount the ingestion route
app.use('/events', ingestionRouter);
app.use('/stores/:id/metrics', metricsRouter);
app.use('/stores/:id/funnel', funnelRouter);
app.use('/stores/:id/heatmap', heatmapRouter);
app.use('/stores/:id/anomalies', anomaliesRouter);

// Basic Health Check
app.get('/health', (req, res) => {
    try {
        // Find the most recent event
        const lastEvent = db.prepare(`SELECT timestamp FROM events ORDER BY timestamp DESC LIMIT 1`).get();
        let status = "OK";
        let lastTimestamp = lastEvent ? lastEvent.timestamp : null;

        if (lastTimestamp) {
            const eventTime = new Date(lastTimestamp).getTime();
            const now = new Date().getTime();
            // If the last event was more than 10 minutes (600000 ms) ago
            if ((now - eventTime) > 600000) {
                status = "STALE_FEED";
            }
        }

        res.json({
            status: status,
            last_event_timestamp: lastTimestamp,
            uptime_seconds: process.uptime()
        });
    } catch (err) {
        res.status(500).json({ status: "ERROR", details: err.message });
    }
});

// Start Server
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`🚀 Intelligence API running on port ${PORT}`);
    });
}

module.exports = app;