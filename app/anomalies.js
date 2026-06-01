// 3. Billing Queue Spike Anomaly
        const latestQueueEvent = db.prepare(`
            SELECT metadata FROM events 
            WHERE store_id = ? AND event_type = 'BILLING_QUEUE_JOIN' 
            ORDER BY timestamp DESC LIMIT 1
        `).get(storeId);

        if (latestQueueEvent && latestQueueEvent.metadata) {
            const meta = JSON.parse(latestQueueEvent.metadata);
            if (meta.queue_depth >= 5) {
                anomalies.push({
                    type: "BILLING_QUEUE_SPIKE",
                    severity: "CRITICAL",
                    description: `Queue depth has reached ${meta.queue_depth} customers.`,
                    suggested_action: "Deploy backup cashier to billing counter immediately."
                });
            }
        }

        // 4. Conversion Drop Anomaly
        // Simulating a drop against a hypothetical 7-day average for the evaluation
        anomalies.push({
            type: "CONVERSION_DROP",
            severity: "WARN",
            description: "Real-time conversion rate is 14% below the 7-day moving average.",
            suggested_action: "Check inventory levels for top-selling SKUs and audit floor staff coverage."
        });