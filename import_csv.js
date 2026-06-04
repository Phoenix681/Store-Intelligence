const fs = require('fs');
const csv = require('csv-parser');
const db = require('./app/database');

console.log("⏳ Starting POS data ingestion with ISO timestamp conversion...");

const results = [];

fs.createReadStream('pos_transactions.csv')
  .pipe(csv())
  .on('data', (row) => results.push(row))
  .on('end', () => {
      db.serialize(() => {
          db.run('BEGIN TRANSACTION');
          
          const stmt = db.prepare(`
              INSERT OR IGNORE INTO pos_transactions 
              (order_id, order_date, order_time, store_id, product_id, brand_name, total_amount)
              VALUES (?, ?, ?, ?, ?, ?, ?)
          `);

          for (const row of results) {
              // Convert DD-MM-YYYY to YYYY-MM-DD for accurate SQLite time math
              const parts = row.order_date.split('-');
              let formattedDate = row.order_date;
              if (parts.length === 3) {
                  formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`; 
              }

              stmt.run([
                  row.order_id,
                  formattedDate,
                  row.order_time,
                  row.store_id,
                  row.product_id,
                  row.brand_name,
                  parseFloat(row.total_amount)
              ]);
          }

          stmt.finalize();
          db.run('COMMIT', (err) => {
              if (err) console.error("❌ Error committing POS data:", err.message);
              else console.log(`✅ Successfully imported ${results.length} POS transactions with corrected timestamps.`);
          });
      });
  });