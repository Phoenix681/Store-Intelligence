const Database = require('better-sqlite3');
const path = require('path');

// Store the database in the root of the project
const dbPath = path.resolve(__dirname, '../store_intel.db');
const db = new Database(dbPath); 

// Initialize the schema
const initDB = () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS events (
            event_id TEXT PRIMARY KEY,
            store_id TEXT NOT NULL,
            camera_id TEXT NOT NULL,
            visitor_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            timestamp DATETIME NOT NULL,
            zone_id TEXT,
            dwell_ms INTEGER DEFAULT 0,
            is_staff INTEGER DEFAULT 0,  -- SQLite uses 1/0 for booleans
            confidence REAL NOT NULL,
            metadata TEXT                -- Store JSON string here
        );
        
        -- Indexes for faster metric aggregation later
        CREATE INDEX IF NOT EXISTS idx_store_time ON events(store_id, timestamp);
        CREATE INDEX IF NOT EXISTS idx_visitor ON events(visitor_id);
    `);
    console.log("✅ Database initialized successfully.");
};

initDB();

module.exports = db;