const fs = require('fs');
const Database = require('better-sqlite3');

// Connect to your local database
const db = new Database('./store_intel.db');

console.log("⏳ Initializing database tables...");

// 1. Create the POS table
db.exec(`
  CREATE TABLE IF NOT EXISTS pos_transactions (
    invoice_number TEXT,
    store_id TEXT,
    order_date TEXT
  )
`);

// 2. Prepare the high-speed insert statement
const insertStmt = db.prepare('INSERT INTO pos_transactions (invoice_number, store_id, order_date) VALUES (?, ?, ?)');

console.log("⏳ Reading pos_transactions.csv...");
try {
    const csvData = fs.readFileSync('pos_transactions.csv', 'utf-8');
    const rows = csvData.split('\n');

    // Find the exact column numbers dynamically based on the headers
    const headers = rows[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const invoiceIdx = headers.indexOf('invoice_number');
    const storeIdx = headers.indexOf('store_id');
    const dateIdx = headers.indexOf('order_date');

    let count = 0;

    // 3. Insert using a SQLite Transaction (this makes it 100x faster)
    const insertMany = db.transaction((rows) => {
        for (let i = 1; i < rows.length; i++) {
            if (!rows[i].trim()) continue; 
            
            const cols = rows[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
            const invoice = cols[invoiceIdx];
            const store = cols[storeIdx];
            const date = cols[dateIdx];

            if (invoice && store) {
                insertStmt.run(invoice, store, date);
                count++;
            }
        }
    });

    insertMany(rows);
    console.log(`✅ BOOM! Successfully imported ${count} rows into the pos_transactions table!`);

} catch (err) {
    console.error("❌ ERROR: Could not read pos_transactions.csv. Is it in the root folder?", err.message);
}