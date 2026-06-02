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
    
    // Extract store_id from URL or Ingest Body
    let storeId = "UNKNOWN";
    if (req.originalUrl.includes('/stores/')) {
        storeId = req.originalUrl.split('/')[2];
    } else if (req.originalUrl === '/events/ingest' && Array.isArray(req.body) && req.body[0]) {
        storeId = req.body[0].store_id;
    }

    res.on('finish', () => {
        const latency = Date.now() - start;
        let eventCount = (req.originalUrl === '/events/ingest' && Array.isArray(req.body)) ? req.body.length : 0;

        console.log(JSON.stringify({
            trace_id: traceId,
            store_id: storeId,
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
        // Find the most recent event PER STORE
        const lastEvents = db.prepare(`
            SELECT store_id, MAX(timestamp) as last_event 
            FROM events 
            GROUP BY store_id
        `).all();
        
        let status = "OK";
        const now = new Date().getTime();

        // Check if ANY store has a stale feed (no events in 10 minutes)
        for (const store of lastEvents) {
            const eventTime = new Date(store.last_event).getTime();
            if ((now - eventTime) > 600000) {
                status = "STALE_FEED";
                break; 
            }
        }

        res.json({
            status: status,
            last_events_per_store: lastEvents,
            uptime_seconds: process.uptime()
        });
    } catch (err) {
        res.status(503).json({ status: "ERROR", details: err.message });
    }
});

// Start Server
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`🚀 Intelligence API running on port ${PORT}`);
    });
}

module.exports = app;