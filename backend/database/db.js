const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class FairPassDB {
    constructor() {
        // Create database directory if it doesn't exist
        const dbDir = path.join(__dirname);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        // Initialize SQLite database
        this.db = new Database(path.join(dbDir, 'fairpass.db'));
        this.db.pragma('journal_mode = WAL');
        this.initializeDatabase();
    }

    initializeDatabase() {
        // Read and execute schema
        const schemaPath = path.join(__dirname, 'schema.sql');
        if (fs.existsSync(schemaPath)) {
            const schema = fs.readFileSync(schemaPath, 'utf8');
            this.db.exec(schema);
            console.log('✅ Database initialized with schema');
        }
    }

    // USER OPERATIONS
    createUser(walletAddress, didIdentifier = null) {
        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO users (wallet_address, did_identifier) 
            VALUES (?, ?)
        `);
        return stmt.run(walletAddress, didIdentifier);
    }

    getUser(walletAddress) {
        const stmt = this.db.prepare('SELECT * FROM users WHERE wallet_address = ?');
        return stmt.get(walletAddress);
    }

    // EVENT OPERATIONS
    getEvents() {
        const stmt = this.db.prepare(`
            SELECT *, 
                   (total_tickets - tickets_sold) as available_tickets
            FROM events 
            WHERE is_active = 1
            ORDER BY event_date ASC
        `);
        return stmt.all();
    }

    getEvent(eventId) {
        const stmt = this.db.prepare('SELECT * FROM events WHERE id = ?');
        return stmt.get(eventId);
    }

    // TICKET OPERATIONS - REAL OWNERSHIP
    createTicket(ticketData) {
        const { tokenId, eventId, ownerAddress, purchasePrice, transactionHash } = ticketData;
        
        // Generate initial verification token
        const verificationToken = this.generateVerificationToken(tokenId);
        const expiresAt = new Date(Date.now() + 60000); // 1 minute initial expiry
        
        const stmt = this.db.prepare(`
            INSERT INTO tickets 
            (token_id, event_id, owner_address, purchase_price, transaction_hash, 
             current_verification_token, token_expires_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        return stmt.run(tokenId, eventId, ownerAddress, purchasePrice, 
                       transactionHash, verificationToken, expiresAt.toISOString());
    }

    // Get user's real owned tickets
    getUserTickets(walletAddress) {
        const stmt = this.db.prepare(`
            SELECT t.*, e.name as event_name, e.venue, e.event_date
            FROM tickets t
            JOIN events e ON t.event_id = e.id
            WHERE t.owner_address = ? AND t.is_used = 0
            ORDER BY t.purchase_timestamp DESC
        `);
        return stmt.all(walletAddress);
    }

    // SECURE QR CODE SYSTEM
    generateVerificationToken(tokenId) {
        const timestamp = Date.now();
        const random = crypto.randomBytes(16).toString('hex');
        return crypto.createHash('sha256')
            .update(`${tokenId}-${timestamp}-${random}`)
            .digest('hex');
    }

    // Generate new QR code data (changes every 30 seconds)
    generateSecureQRData(ticketId, ownerAddress) {
        const ticket = this.db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
        if (!ticket || ticket.owner_address !== ownerAddress) {
            throw new Error('Unauthorized: Not ticket owner');
        }

        // Check if current token is still valid (within 30 seconds)
        const now = new Date();
        const tokenExpiry = new Date(ticket.token_expires_at);
        
        if (now < tokenExpiry && ticket.current_verification_token) {
            // Return existing valid token
            return {
                verificationToken: ticket.current_verification_token,
                expiresAt: tokenExpiry,
                ticketId: ticket.id,
                tokenId: ticket.token_id,
                eventId: ticket.event_id
            };
        }

        // Generate new token (expires in 30 seconds)
        const newToken = this.generateVerificationToken(ticket.token_id);
        const newExpiry = new Date(Date.now() + 30000); // 30 seconds

        // Update database
        const updateStmt = this.db.prepare(`
            UPDATE tickets 
            SET current_verification_token = ?, 
                token_expires_at = ?, 
                last_token_generation = CURRENT_TIMESTAMP 
            WHERE id = ?
        `);
        updateStmt.run(newToken, newExpiry.toISOString(), ticketId);

        return {
            verificationToken: newToken,
            expiresAt: newExpiry,
            ticketId: ticket.id,
            tokenId: ticket.token_id,
            eventId: ticket.event_id,
            ownerAddress: ticket.owner_address
        };
    }

    // VERIFY QR CODE AT SCAN TIME
    verifyQRCode(verificationToken, scannerInfo = {}) {
        const stmt = this.db.prepare(`
            SELECT t.*, e.name as event_name, e.venue, e.event_date
            FROM tickets t
            JOIN events e ON t.event_id = e.id
            WHERE t.current_verification_token = ?
        `);
        
        const ticket = stmt.get(verificationToken);
        
        let result = 'invalid';
        let message = 'Invalid ticket';

        if (ticket) {
            const now = new Date();
            const tokenExpiry = new Date(ticket.token_expires_at);
            
            if (ticket.is_used) {
                result = 'already_used';
                message = 'Ticket already used';
            } else if (now > tokenExpiry) {
                result = 'expired';
                message = 'QR code expired - ask owner to refresh';
            } else {
                result = 'valid';
                message = 'Valid ticket';
                
                // Mark ticket as used
                const useStmt = this.db.prepare(`
                    UPDATE tickets 
                    SET is_used = 1, used_timestamp = CURRENT_TIMESTAMP 
                    WHERE id = ?
                `);
                useStmt.run(ticket.id);
            }
        }

        // Log verification attempt
        this.logVerification(ticket?.id, verificationToken, result, scannerInfo);
        
        // Check for fraud patterns
        if (result === 'invalid' || result === 'expired') {
            this.checkForFraud(ticket?.id, verificationToken, result);
        }

        return {
            result,
            message,
            ticket: result === 'valid' ? ticket : null,
            timestamp: new Date().toISOString()
        };
    }

    logVerification(ticketId, token, result, scannerInfo) {
        if (!ticketId) return; // Can't log without ticket ID
        
        const stmt = this.db.prepare(`
            INSERT INTO qr_verifications 
            (ticket_id, verification_token, scanned_by, scan_result, scan_location, ip_address)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(
            ticketId, 
            token, 
            scannerInfo.scannerAddress || null,
            result,
            scannerInfo.location || null,
            scannerInfo.ipAddress || null
        );
    }

    checkForFraud(ticketId, token, result) {
        if (!ticketId) return;
        
        // Check for multiple scan attempts with same token
        const recentScans = this.db.prepare(`
            SELECT COUNT(*) as count 
            FROM qr_verifications 
            WHERE verification_token = ? AND scan_timestamp > datetime('now', '-5 minutes')
        `).get(token);

        if (recentScans.count > 3) {
            // Multiple failed attempts - potential fraud
            this.db.prepare(`
                INSERT INTO fraud_alerts (ticket_id, alert_type, description)
                VALUES (?, 'suspicious_activity', 'Multiple scan attempts with same token')
            `).run(ticketId);
        }
    }

    // TRANSFER OPERATIONS
    createTransferRequest(ticketId, fromAddress, toAddress, price = 0) {
        const transferId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        
        const stmt = this.db.prepare(`
            INSERT INTO transfer_requests 
            (transfer_id, ticket_id, from_address, to_address, transfer_price, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        const result = stmt.run(transferId, ticketId, fromAddress, toAddress, price, expiresAt.toISOString());
        return { transferId, expiresAt };
    }

    getPendingTransfers(userAddress) {
        const stmt = this.db.prepare(`
            SELECT tr.*, t.token_id, e.name as event_name
            FROM transfer_requests tr
            JOIN tickets t ON tr.ticket_id = t.id
            JOIN events e ON t.event_id = e.id
            WHERE tr.to_address = ? AND tr.status = 'pending' AND tr.expires_at > datetime('now')
            ORDER BY tr.created_at DESC
        `);
        return stmt.all(userAddress);
    }

    confirmTransfer(transferId, recipientAddress) {
        const transfer = this.db.prepare(`
            SELECT tr.*, t.owner_address, t.id as ticket_db_id
            FROM transfer_requests tr
            JOIN tickets t ON tr.ticket_id = t.id
            WHERE tr.transfer_id = ? AND tr.to_address = ?
        `).get(transferId, recipientAddress);

        if (!transfer || transfer.status !== 'pending') {
            throw new Error('Invalid or expired transfer');
        }

        // Update ticket ownership
        const updateTicket = this.db.prepare(`
            UPDATE tickets 
            SET owner_address = ?, 
                current_verification_token = NULL,
                token_expires_at = NULL
            WHERE id = ?
        `);
        
        // Update transfer status
        const updateTransfer = this.db.prepare(`
            UPDATE transfer_requests 
            SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP 
            WHERE transfer_id = ?
        `);

        // Execute both updates in transaction
        const transaction = this.db.transaction(() => {
            updateTicket.run(recipientAddress, transfer.ticket_db_id);
            updateTransfer.run(transferId);
        });
        
        transaction();
        return true;
    }

    // STATISTICS AND MONITORING
    getSystemStats() {
        const stats = {
            totalUsers: this.db.prepare('SELECT COUNT(*) as count FROM users').get().count,
            totalTickets: this.db.prepare('SELECT COUNT(*) as count FROM tickets').get().count,
            activeEvents: this.db.prepare('SELECT COUNT(*) as count FROM events WHERE is_active = 1').get().count,
            pendingTransfers: this.db.prepare('SELECT COUNT(*) as count FROM transfer_requests WHERE status = "pending"').get().count,
            fraudAlerts: this.db.prepare('SELECT COUNT(*) as count FROM fraud_alerts WHERE created_at > datetime("now", "-24 hours")').get().count
        };
        return stats;
    }

    close() {
        this.db.close();
    }
}

module.exports = FairPassDB; 