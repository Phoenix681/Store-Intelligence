/*
# PROMPT: "Write a quick Node.js HTTP test to verify my API endpoints don't crash when querying a store with zero traffic (empty store) and zero purchases."
# CHANGES MADE: Adapted the assert logic to specifically check for 0 conversion_rate instead of just a 200 OK.
*/
const http = require('http');
const assert = require('assert');

console.log("🧪 Running Edge Case Tests (Empty Store / Zero Traffic)...");

// Testing a fake store ID that has no data
const req = http.get('http://localhost:3000/stores/STORE_GHOST_999/metrics', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            assert.strictEqual(res.statusCode, 200, "Empty store should return 200 OK, not crash");
            const metrics = JSON.parse(data);
            assert.strictEqual(metrics.unique_visitors, 0, "Unique visitors should gracefully default to 0");
            assert.strictEqual(metrics.conversion_rate, 0, "Conversion rate should gracefully handle division by zero (0)");
            console.log("✅ PASS: Empty Store / Zero Purchases edge cases handled gracefully.");
            process.exit(0);
        } catch (err) {
            console.error("❌ FAIL:", err.message);
            process.exit(1);
        }
    });
});

req.on('error', (err) => console.error("API Connection Failed", err));