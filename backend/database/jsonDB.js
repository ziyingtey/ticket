const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class JSONDatabase {
    constructor() {
        this.dbPath = path.join(__dirname, 'data');
        this.ensureDirectoryExists();
        this.initializeDatabase();
    }

    ensureDirectoryExists() {
        if (!fs.existsSync(this.dbPath)) {
            fs.mkdirSync(this.dbPath, { recursive: true });
        }
    }

    initializeDatabase() {
        const tables = ['users', 'events', 'tickets', 'transfers', 'qr_verifications', 'fraud_alerts'];
        
        tables.forEach(table => {
            const filePath = path.join(this.dbPath, `${table}.json`);
            if (!fs.existsSync(filePath)) {
                this.writeTable(table, []);
            }
        });

        // Initialize with sample events if empty
        const events = this.readTable('events');
        if (events.length === 0) {
            this.initializeSampleData();
        }

        console.log('✅ JSON Database initialized');
    }

    initializeSampleData() {
        const sampleEvents = [
            {
                id: 1,
                name: 'FairFest 2025 - Web3 Music Festival',
                venue: 'MetaVerse Stadium',
                event_date: '2025-12-15 19:00:00',
                price_matic: 0.01,
                max_resale_price: 0.02,
                total_tickets: 1000,
                tickets_sold: 0,
                requires_did: true,
                organizer_address: '0x742d35Cc6432C7a8d9B05Dc6d5E5E5a7d4A6d8F3',
                is_active: true,
                created_at: new Date().toISOString()
            },
            {
                id: 2,
                name: 'Sustainable Tech Conference 2025',
                venue: 'Green Convention Center',
                event_date: '2025-11-20 09:00:00',
                price_matic: 0.005,
                max_resale_price: 0.01,
                total_tickets: 500,
                tickets_sold: 0,
                requires_did: true,
                organizer_address: '0x853e46Dd7543D8a5eA15Fd7e6E6e6b8e5C7e9G4',
                is_active: true,
                created_at: new Date().toISOString()
            },
            {
                id: 3,
                name: 'Digital Inclusion Workshop',
                venue: 'Community Innovation Hub',
                event_date: '2025-10-15 14:00:00',
                price_matic: 0.002,
                max_resale_price: 0.003,
                total_tickets: 100,
                tickets_sold: 0,
                requires_did: true,
                organizer_address: '0x964f57Ee8654E9b6fB26Ge8f7f7c9f6D8f0H5',
                is_active: true,
                created_at: new Date().toISOString()
            }
        ];

        this.writeTable('events', sampleEvents);
    }

    readTable(tableName) {
        const filePath = path.join(this.dbPath, `${tableName}.json`);
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
        return [];
    }

    writeTable(tableName, data) {
        const filePath = path.join(this.dbPath, `${tableName}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }

    // USER OPERATIONS
    createUser(walletAddress, didIdentifier = null) {
        const users = this.readTable('users');
        const existingUser = users.find(u => u.wallet_address === walletAddress);
        
        if (!existingUser) {
            const newUser = {
                id: users.length + 1,
                wallet_address: walletAddress,
                did_identifier: didIdentifier,
                created_at: new Date().toISOString(),
                is_verified: false
            };
            users.push(newUser);
            this.writeTable('users', users);
        }
    }

    getUser(walletAddress) {
        const users = this.readTable('users');
        return users.find(u => u.wallet_address === walletAddress);
    }

    // EVENT OPERATIONS
    getEvents() {
        const events = this.readTable('events');
        return events.filter(e => e.is_active).map(event => ({
            ...event,
            available_tickets: event.total_tickets - event.tickets_sold
        }));
    }

    getEvent(eventId) {
        const events = this.readTable('events');
        return events.find(e => e.id === parseInt(eventId));
    }

    // TICKET OPERATIONS - REAL DATABASE STORAGE
    createTicket(ticketData) {
        const tickets = this.readTable('tickets');
        const { tokenId, eventId, ownerAddress, purchasePrice, transactionHash } = ticketData;
        
        // Generate secure verification token
        const verificationToken = this.generateVerificationToken(tokenId);
        const expiresAt = new Date(Date.now() + 60000); // 1 minute initial
        
        const newTicket = {
            id: tickets.length + 1,
            token_id: tokenId,
            event_id: eventId,
            owner_address: ownerAddress,
            purchase_price: purchasePrice,
            purchase_timestamp: new Date().toISOString(),
            transaction_hash: transactionHash,
            is_used: false,
            used_timestamp: null,
            current_verification_token: verificationToken,
            token_expires_at: expiresAt.toISOString(),
            last_token_generation: new Date().toISOString()
        };

        tickets.push(newTicket);
        this.writeTable('tickets', tickets);
        
        // Update event sold count
        this.updateEventSoldCount(eventId, 1);
        
        return { lastInsertRowid: newTicket.id };
    }

    updateEventSoldCount(eventId, increment) {
        const events = this.readTable('events');
        const eventIndex = events.findIndex(e => e.id === parseInt(eventId));
        if (eventIndex !== -1) {
            events[eventIndex].tickets_sold += increment;
            this.writeTable('events', events);
        }
    }

    getUserTickets(walletAddress) {
        const tickets = this.readTable('tickets');
        const events = this.readTable('events');
        
        return tickets
            .filter(t => t.owner_address === walletAddress && !t.is_used)
            .map(ticket => {
                const event = events.find(e => e.id === ticket.event_id);
                return {
                    ...ticket,
                    event_name: event?.name || 'Unknown Event',
                    venue: event?.venue || 'Unknown Venue',
                    event_date: event?.event_date || 'Unknown Date'
                };
            });
    }

    // SECURE QR CODE SYSTEM - PREVENTS COPYING/SELLING
    generateVerificationToken(tokenId) {
        const timestamp = Date.now();
        const random = crypto.randomBytes(16).toString('hex');
        return crypto.createHash('sha256')
            .update(`${tokenId}-${timestamp}-${random}`)
            .digest('hex');
    }

    generateSecureQRData(ticketId, ownerAddress) {
        const tickets = this.readTable('tickets');
        const ticket = tickets.find(t => t.id === parseInt(ticketId));
        
        if (!ticket || ticket.owner_address !== ownerAddress) {
            throw new Error('Unauthorized: Not ticket owner');
        }

        // Check if current token is still valid (within 30 seconds)
        const now = new Date();
        const tokenExpiry = new Date(ticket.token_expires_at);
        
        if (now < tokenExpiry && ticket.current_verification_token) {
            return {
                verificationToken: ticket.current_verification_token,
                expiresAt: tokenExpiry,
                ticketId: ticket.id,
                tokenId: ticket.token_id,
                eventId: ticket.event_id,
                timeRemaining: Math.floor((tokenExpiry - now) / 1000)
            };
        }

        // Generate new token (expires in 30 seconds)
        const newToken = this.generateVerificationToken(ticket.token_id);
        const newExpiry = new Date(Date.now() + 30000); // 30 seconds

        // Update ticket with new token
        const ticketIndex = tickets.findIndex(t => t.id === parseInt(ticketId));
        tickets[ticketIndex].current_verification_token = newToken;
        tickets[ticketIndex].token_expires_at = newExpiry.toISOString();
        tickets[ticketIndex].last_token_generation = new Date().toISOString();
        this.writeTable('tickets', tickets);

        return {
            verificationToken: newToken,
            expiresAt: newExpiry,
            ticketId: ticket.id,
            tokenId: ticket.token_id,
            eventId: ticket.event_id,
            timeRemaining: 30
        };
    }

    // VERIFY QR CODE - PREVENTS FRAUD
    verifyQRCode(verificationToken, scannerInfo = {}) {
        const tickets = this.readTable('tickets');
        const events = this.readTable('events');
        
        const ticket = tickets.find(t => t.current_verification_token === verificationToken);
        
        let result = 'invalid';
        let message = 'Invalid ticket - possible fraud';

        if (ticket) {
            const now = new Date();
            const tokenExpiry = new Date(ticket.token_expires_at);
            const event = events.find(e => e.id === ticket.event_id);
            
            if (ticket.is_used) {
                result = 'already_used';
                message = 'Ticket already used';
            } else if (now > tokenExpiry) {
                result = 'expired';
                message = 'QR code expired - ask owner to refresh (security feature)';
                this.logFraudAttempt(ticket.id, 'expired_token', 'Attempted scan with expired token');
            } else {
                result = 'valid';
                message = `Valid ticket for ${event?.name}`;
                
                // Mark ticket as used
                const ticketIndex = tickets.findIndex(t => t.id === ticket.id);
                tickets[ticketIndex].is_used = true;
                tickets[ticketIndex].used_timestamp = new Date().toISOString();
                this.writeTable('tickets', tickets);
            }

            // Enhanced ticket info for valid scans
            if (result === 'valid') {
                ticket.event_name = event?.name;
                ticket.venue = event?.venue;
                ticket.event_date = event?.event_date;
            }
        } else {
            // Log potential fraud attempt
            this.logVerificationAttempt(null, verificationToken, result, scannerInfo);
            this.checkForFraud(null, verificationToken);
        }

        // Log all verification attempts
        if (ticket) {
            this.logVerificationAttempt(ticket.id, verificationToken, result, scannerInfo);
        }

        return {
            result,
            message,
            ticket: result === 'valid' ? ticket : null,
            timestamp: new Date().toISOString()
        };
    }

    logVerificationAttempt(ticketId, token, result, scannerInfo) {
        const verifications = this.readTable('qr_verifications');
        const newVerification = {
            id: verifications.length + 1,
            ticket_id: ticketId,
            verification_token: token,
            scanned_by: scannerInfo.scannerAddress || null,
            scan_timestamp: new Date().toISOString(),
            scan_result: result,
            scan_location: scannerInfo.location || null,
            ip_address: scannerInfo.ipAddress || null
        };
        
        verifications.push(newVerification);
        this.writeTable('qr_verifications', verifications);
    }

    checkForFraud(ticketId, token) {
        const verifications = this.readTable('qr_verifications');
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        
        const recentAttempts = verifications.filter(v => 
            v.verification_token === token && 
            new Date(v.scan_timestamp) > fiveMinutesAgo
        );

        if (recentAttempts.length > 3) {
            this.logFraudAttempt(ticketId, 'suspicious_activity', 
                `Multiple scan attempts (${recentAttempts.length}) with same token in 5 minutes`);
        }
    }

    logFraudAttempt(ticketId, alertType, description) {
        const fraudAlerts = this.readTable('fraud_alerts');
        const newAlert = {
            id: fraudAlerts.length + 1,
            ticket_id: ticketId,
            alert_type: alertType,
            description,
            created_at: new Date().toISOString()
        };
        
        fraudAlerts.push(newAlert);
        this.writeTable('fraud_alerts', fraudAlerts);
        
        console.log(`🚨 FRAUD ALERT: ${alertType} - ${description}`);
    }

    // TRANSFER OPERATIONS
    createTransferRequest(ticketId, fromAddress, toAddress, price = 0) {
        const transfers = this.readTable('transfers');
        const transferId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        
        const newTransfer = {
            id: transfers.length + 1,
            transfer_id: transferId,
            ticket_id: ticketId,
            from_address: fromAddress,
            to_address: toAddress,
            transfer_price: price,
            status: 'pending',
            created_at: new Date().toISOString(),
            confirmed_at: null,
            expires_at: expiresAt.toISOString()
        };

        transfers.push(newTransfer);
        this.writeTable('transfers', transfers);
        
        return { transferId, expiresAt };
    }

    getPendingTransfers(userAddress) {
        const transfers = this.readTable('transfers');
        const tickets = this.readTable('tickets');
        const events = this.readTable('events');
        const now = new Date();
        
        return transfers
            .filter(t => 
                t.to_address === userAddress && 
                t.status === 'pending' && 
                new Date(t.expires_at) > now
            )
            .map(transfer => {
                const ticket = tickets.find(t => t.id === transfer.ticket_id);
                const event = events.find(e => e.id === ticket?.event_id);
                return {
                    ...transfer,
                    token_id: ticket?.token_id,
                    event_name: event?.name || 'Unknown Event'
                };
            });
    }

    confirmTransfer(transferId, recipientAddress) {
        const transfers = this.readTable('transfers');
        const tickets = this.readTable('tickets');
        
        const transferIndex = transfers.findIndex(t => 
            t.transfer_id === transferId && t.to_address === recipientAddress
        );
        
        if (transferIndex === -1 || transfers[transferIndex].status !== 'pending') {
            throw new Error('Invalid or expired transfer');
        }

        const transfer = transfers[transferIndex];
        
        // Update ticket ownership
        const ticketIndex = tickets.findIndex(t => t.id === transfer.ticket_id);
        if (ticketIndex !== -1) {
            tickets[ticketIndex].owner_address = recipientAddress;
            tickets[ticketIndex].current_verification_token = null;
            tickets[ticketIndex].token_expires_at = null;
            this.writeTable('tickets', tickets);
        }

        // Update transfer status
        transfers[transferIndex].status = 'confirmed';
        transfers[transferIndex].confirmed_at = new Date().toISOString();
        this.writeTable('transfers', transfers);
        
        return true;
    }

    // STATISTICS
    getSystemStats() {
        const users = this.readTable('users');
        const tickets = this.readTable('tickets');
        const events = this.readTable('events');
        const transfers = this.readTable('transfers');
        const fraudAlerts = this.readTable('fraud_alerts');
        
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentFraud = fraudAlerts.filter(f => new Date(f.created_at) > oneDayAgo);
        
        return {
            totalUsers: users.length,
            totalTickets: tickets.length,
            activeEvents: events.filter(e => e.is_active).length,
            pendingTransfers: transfers.filter(t => t.status === 'pending').length,
            fraudAlerts: recentFraud.length
        };
    }
}

module.exports = JSONDatabase; 