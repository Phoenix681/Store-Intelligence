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
    res.on('finish', () => {
        const latency = Date.now() - start;
        let eventCount = 0;
        
        // Safely count events only after body is fully parsed
        if (req.originalUrl === '/events/ingest' && Array.isArray(req.body)) {
            eventCount = req.body.length;
        }

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            method: req.method,
            endpoint: req.originalUrl,
            status: res.statusCode,
            latency_ms: latency,
            event_count: eventCount
        }));
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