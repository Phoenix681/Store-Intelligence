// db.js - Updated to support multi-store, multi-camera, and advanced queue tracking
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./store_intel.db');

db.serialize(() => {
  // 1. Updated Core Events Table
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      store_id TEXT NOT NULL,
      camera_id TEXT NOT NULL,
      track_id INTEGER,
      zone_id TEXT,
      zone_name TEXT,
      zone_type TEXT,
      is_revenue_zone TEXT,
      event_timestamp TEXT NOT NULL,
      zone_hotspot_x REAL,
      zone_hotspot_y REAL,
      gender TEXT,
      age INTEGER,
      age_bucket TEXT,
      is_staff BOOLEAN DEFAULT 0,
      confidence REAL
    )
  `);

  // 2. Dedicated Billing Queue Transactions Table
  db.run(`
    CREATE TABLE IF NOT EXISTS queue_events (
      queue_event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      track_id INTEGER NOT NULL,
      store_id TEXT NOT NULL,
      camera_id TEXT NOT NULL,
      zone_id TEXT,
      zone_name TEXT,
      queue_join_ts TEXT NOT NULL,
      queue_served_ts TEXT,
      queue_exit_ts TEXT,
      wait_seconds INTEGER,
      queue_position_at_join INTEGER,
      abandoned BOOLEAN DEFAULT 0,
      gender TEXT,
      age INTEGER,
      age_bucket TEXT,
      confidence REAL
    )
  `);

  // 3. Updated POS Transactions Table matching the new schema
  db.run(`
    CREATE TABLE IF NOT EXISTS pos_transactions (
      order_id INTEGER PRIMARY KEY,
      order_date TEXT NOT NULL,
      order_time TEXT NOT NULL,
      store_id TEXT NOT NULL,
      product_id INTEGER,
      brand_name TEXT,
      total_amount REAL NOT NULL
    )
  `);

  // 4. Indexes for faster metric aggregation
  db.run(`CREATE INDEX IF NOT EXISTS idx_store_time ON events(store_id, event_timestamp)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_track_id ON events(track_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_queue_store ON queue_events(store_id, queue_join_ts)`);
});

module.exports = db;