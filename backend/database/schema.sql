-- FairPass Ticket Database Schema
-- Real production-ready database structure

-- Users table for wallet addresses and profiles
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_address TEXT UNIQUE NOT NULL,
    did_identifier TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_verified BOOLEAN DEFAULT 0
);

-- Events table
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    venue TEXT NOT NULL,
    event_date DATETIME NOT NULL,
    price_matic DECIMAL(10,6) NOT NULL,
    max_resale_price DECIMAL(10,6) NOT NULL,
    total_tickets INTEGER NOT NULL,
    tickets_sold INTEGER DEFAULT 0,
    requires_did BOOLEAN DEFAULT 1,
    organizer_address TEXT NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    blockchain_contract TEXT
);

-- Tickets table - REAL ownership tracking
CREATE TABLE tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_id INTEGER UNIQUE NOT NULL,
    event_id INTEGER NOT NULL,
    owner_address TEXT NOT NULL,
    purchase_price DECIMAL(10,6) NOT NULL,
    purchase_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    transaction_hash TEXT NOT NULL,
    is_used BOOLEAN DEFAULT 0,
    used_timestamp DATETIME NULL,
    metadata_uri TEXT,
    
    -- Security fields for QR codes
    current_verification_token TEXT UNIQUE,
    token_expires_at DATETIME,
    last_token_generation DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (event_id) REFERENCES events(id),
    FOREIGN KEY (owner_address) REFERENCES users(wallet_address)
);

-- Transfer requests - secure transfer system
CREATE TABLE transfer_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_id TEXT UNIQUE NOT NULL,
    ticket_id INTEGER NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    transfer_price DECIMAL(10,6) DEFAULT 0,
    status TEXT CHECK(status IN ('pending', 'confirmed', 'cancelled', 'expired')) DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    confirmed_at DATETIME NULL,
    expires_at DATETIME NOT NULL,
    
    FOREIGN KEY (ticket_id) REFERENCES tickets(id),
    FOREIGN KEY (from_address) REFERENCES users(wallet_address),
    FOREIGN KEY (to_address) REFERENCES users(wallet_address)
);

-- QR Code verification logs - track all scan attempts
CREATE TABLE qr_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    verification_token TEXT NOT NULL,
    scanned_by TEXT, -- scanner address/device
    scan_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    scan_result TEXT CHECK(scan_result IN ('valid', 'invalid', 'expired', 'already_used', 'stolen')) NOT NULL,
    scan_location TEXT, -- event location/device
    ip_address TEXT,
    
    FOREIGN KEY (ticket_id) REFERENCES tickets(id)
);

-- Anti-fraud tracking
CREATE TABLE fraud_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    alert_type TEXT CHECK(alert_type IN ('duplicate_scan', 'invalid_owner', 'expired_token', 'suspicious_activity')) NOT NULL,
    description TEXT,
    reported_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (ticket_id) REFERENCES tickets(id)
);

-- Indexes for performance
CREATE INDEX idx_tickets_owner ON tickets(owner_address);
CREATE INDEX idx_tickets_event ON tickets(event_id);
CREATE INDEX idx_tickets_token ON tickets(current_verification_token);
CREATE INDEX idx_transfer_requests_addresses ON transfer_requests(from_address, to_address);
CREATE INDEX idx_qr_verifications_token ON qr_verifications(verification_token);

-- Sample data
INSERT INTO events (name, venue, event_date, price_matic, max_resale_price, total_tickets, organizer_address) VALUES 
('FairFest 2025 - Web3 Music Festival', 'MetaVerse Stadium', '2025-12-15 19:00:00', 0.01, 0.02, 1000, '0x742d35Cc6432C7a8d9B05Dc6d5E5E5a7d4A6d8F3'),
('Sustainable Tech Conference 2025', 'Green Convention Center', '2025-11-20 09:00:00', 0.005, 0.01, 500, '0x853e46Dd7543D8a5eA15Fd7e6E6e6b8e5C7e9G4'),
('Digital Inclusion Workshop', 'Community Innovation Hub', '2025-10-15 14:00:00', 0.002, 0.003, 100, '0x964f57Ee8654E9b6fB26Ge8f7f7c9f6D8f0H5'); 