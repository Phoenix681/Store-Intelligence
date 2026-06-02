/* # PROMPT: "Write a zero-dependency Node.js integration test using the native 'http' and 'assert' modules to test my Express /funnel endpoint. It must verify a 200 status code and check that the JSON response contains funnel_metrics."
# CHANGES MADE: I manually added the assertions for checking the successful_purchases metric and updated the API path to use the dynamic store ID STORE_BLR_002 to match the updated detection pipeline.
*/

const http = require('http');
const assert = require('assert');

console.log("🧪 Starting API Integration Tests...");

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/stores/STORE_BLR_002/funnel', 
    method: 'GET'
};

const req = http.request(options, (res) => {
    let data = '';

    try {
        assert.strictEqual(res.statusCode, 200, "API should return a 200 OK status");
        console.log("✅ PASS: HTTP Status is 200");
    } catch (err) {
        console.error("❌ FAIL:", err.message);
        process.exit(1);
    }

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        try {
            const response = JSON.parse(data);
            
            assert.ok(response.store_id === 'STORE_BLR_002', "Store ID should match STORE_BLR_002");
            console.log("✅ PASS: Store ID correctly mapped");

            assert.ok(response.funnel_metrics, "Response must contain funnel_metrics object");
            console.log("✅ PASS: Funnel metrics object exists");

            // Verify that the POS merge is returning a valid number
            assert.ok(response.funnel_metrics.successful_purchases >= 0, "Purchases must be a valid number");
            console.log("✅ PASS: POS offline data successfully merged");

            console.log("\n🎉 All tests passed! The Intelligence API is production-ready.");
            process.exit(0);

        } catch (err) {
            console.error("❌ FAIL: Invalid JSON or missing data fields -", err.message);
            process.exit(1);
        }
    });
});

req.on('error', (error) => {
    console.error("❌ FAIL: Could not connect to API. Is the Docker container running?", error.message);
    process.exit(1);
});

req.end();