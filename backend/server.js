const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const FairPassMongoDB = require('./database/mongodb');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize MongoDB database
const db = new FairPassMongoDB();

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ==========================================
// AUTHENTICATION & USER ROUTES
// ==========================================

// Register/get user
app.post('/api/users/register', async (req, res) => {
    try {
        const { walletAddress, didIdentifier } = req.body;
        
        if (!walletAddress) {
            return res.status(400).json({ error: 'Wallet address required' });
        }

        // Create or get existing user
        await db.createUser(walletAddress, didIdentifier);
        const user = await db.getUser(walletAddress);
        
        res.json({
            success: true,
            user: {
                walletAddress: user.wallet_address,
                didIdentifier: user.did_identifier,
                isVerified: user.is_verified,
                createdAt: user.created_at
            }
        });
    } catch (error) {
        console.error('User registration error:', error);
        res.status(500).json({ error: 'Failed to register user' });
    }
});

// ==========================================
// EVENT ROUTES
// ==========================================

// Get all events
app.get('/api/events', async (req, res) => {
    try {
        const events = await db.getEvents();
        res.json({
            success: true,
            events: events.map(event => ({
                id: event.id || event._id,
                name: event.name,
                venue: event.venue,
                date: event.event_date,
                price: event.price_matic.toString(),
                maxResalePrice: event.max_resale_price.toString(),
                totalTickets: event.total_tickets,
                soldTickets: event.tickets_sold,
                availableTickets: event.available_tickets,
                requiresDID: event.requires_did,
                organizer: event.organizer_address,
                isActive: event.is_active
            }))
        });
    } catch (error) {
        console.error('Events fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

// ==========================================
// TICKET ROUTES - REAL OWNERSHIP
// ==========================================

// Purchase tickets - REAL MONGODB STORAGE
app.post('/api/tickets/purchase', async (req, res) => {
    try {
        const { eventId, ownerAddress, quantity, didIdentifier, transactionHash } = req.body;
        
        if (!eventId || !ownerAddress || !quantity || !transactionHash) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Verify event exists and has tickets available
        const event = await db.getEvent(eventId);
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }

        if (event.tickets_sold + quantity > event.total_tickets) {
            return res.status(400).json({ error: 'Not enough tickets available' });
        }

        // Register user if not exists
        await db.createUser(ownerAddress, didIdentifier);

        // Create tickets in database
        const tickets = [];
        for (let i = 0; i < quantity; i++) {
            const tokenId = Date.now() + i; // Simple token ID generation
            
            const ticketData = {
                tokenId,
                eventId,
                ownerAddress,
                purchasePrice: event.price_matic,
                transactionHash: `${transactionHash}-${i}`
            };

            const result = await db.createTicket(ticketData);
            tickets.push({
                tokenId,
                ticketId: result.insertedId,
                eventId,
                eventName: event.name,
                venue: event.venue,
                date: event.event_date,
                purchasePrice: event.price_matic.toString(),
                transactionHash: ticketData.transactionHash
            });
        }

        res.json({
            success: true,
            message: `${quantity} ticket(s) purchased successfully`,
            tickets,
            transactionHash
        });

    } catch (error) {
        console.error('Ticket purchase error:', error);
        res.status(500).json({ error: 'Failed to purchase tickets' });
    }
});

// Get user's tickets - REAL OWNERSHIP
app.get('/api/tickets/user/:walletAddress', async (req, res) => {
    try {
        const { walletAddress } = req.params;
        const tickets = await db.getUserTickets(walletAddress);
        
        res.json({
            success: true,
            tickets: tickets.map(ticket => ({
                id: ticket.id || ticket._id,
                tokenId: ticket.token_id,
                eventId: ticket.event_id,
                eventName: ticket.event_name,
                venue: ticket.venue,
                date: ticket.event_date,
                purchasePrice: ticket.purchase_price.toString(),
                purchaseTimestamp: ticket.purchase_timestamp,
                transactionHash: ticket.transaction_hash,
                isUsed: ticket.is_used
            }))
        });
    } catch (error) {
        console.error('User tickets fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch user tickets' });
    }
});

// ==========================================
// SECURE QR CODE ROUTES - FRAUD PREVENTION
// ==========================================

// Generate dynamic QR code (changes every 30 seconds)
app.post('/api/qr/generate', async (req, res) => {
    try {
        const { ticketId, ownerAddress } = req.body;
        
        if (!ticketId || !ownerAddress) {
            return res.status(400).json({ error: 'Ticket ID and owner address required' });
        }

        const qrData = await db.generateSecureQRData(ticketId, ownerAddress);
        
        res.json({
            success: true,
            qrData: {
                verificationToken: qrData.verificationToken,
                expiresAt: qrData.expiresAt,
                ticketId: qrData.ticketId,
                tokenId: qrData.tokenId,
                eventId: qrData.eventId,
                timeRemaining: Math.floor((new Date(qrData.expiresAt) - new Date()) / 1000)
            },
            message: 'QR code generated (expires in 30 seconds)'
        });

    } catch (error) {
        console.error('QR generation error:', error);
        res.status(403).json({ error: error.message || 'Failed to generate QR code' });
    }
});

// Verify QR code at entry point
app.post('/api/qr/verify', async (req, res) => {
    try {
        const { verificationToken, scannerInfo } = req.body;
        
        if (!verificationToken) {
            return res.status(400).json({ error: 'Verification token required' });
        }

        // Add scanner IP for fraud detection
        const scannerData = {
            ...scannerInfo,
            ipAddress: req.ip || req.connection.remoteAddress
        };

        const verification = await db.verifyQRCode(verificationToken, scannerData);
        
        const statusCode = verification.result === 'valid' ? 200 : 400;
        
        res.status(statusCode).json({
            success: verification.result === 'valid',
            result: verification.result,
            message: verification.message,
            ticket: verification.ticket,
            timestamp: verification.timestamp
        });

    } catch (error) {
        console.error('QR verification error:', error);
        res.status(500).json({ error: 'Failed to verify QR code' });
    }
});

// ==========================================
// TRANSFER ROUTES
// ==========================================

// Create transfer request
app.post('/api/transfers/create', async (req, res) => {
    try {
        const { ticketId, fromAddress, toAddress, price } = req.body;
        
        if (!ticketId || !fromAddress || !toAddress) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Verify ownership
        const tickets = await db.getUserTickets(fromAddress);
        const ticket = tickets.find(t => t.id == ticketId);
        
        if (!ticket) {
            return res.status(403).json({ error: 'Not authorized to transfer this ticket' });
        }

        const transfer = await db.createTransferRequest(ticketId, fromAddress, toAddress, price || 0);
        
        res.json({
            success: true,
            transferId: transfer.transferId,
            expiresAt: transfer.expiresAt,
            message: 'Transfer request created'
        });

    } catch (error) {
        console.error('Transfer creation error:', error);
        res.status(500).json({ error: 'Failed to create transfer' });
    }
});

// Get pending transfers for user
app.get('/api/transfers/pending/:walletAddress', async (req, res) => {
    try {
        const { walletAddress } = req.params;
        const transfers = await db.getPendingTransfers(walletAddress);
        
        res.json({
            success: true,
            transfers: transfers.map(transfer => ({
                transferId: transfer.transfer_id,
                ticketId: transfer.ticket_id,
                tokenId: transfer.token_id,
                eventName: transfer.event_name,
                fromAddress: transfer.from_address,
                toAddress: transfer.to_address,
                price: transfer.transfer_price.toString(),
                createdAt: transfer.created_at,
                expiresAt: transfer.expires_at
            }))
        });
    } catch (error) {
        console.error('Pending transfers fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch pending transfers' });
    }
});

// Confirm transfer
app.post('/api/transfers/confirm', async (req, res) => {
    try {
        const { transferId, recipientAddress } = req.body;
        
        if (!transferId || !recipientAddress) {
            return res.status(400).json({ error: 'Transfer ID and recipient address required' });
        }

        await db.confirmTransfer(transferId, recipientAddress);
        
        res.json({
            success: true,
            message: 'Transfer confirmed successfully'
        });

    } catch (error) {
        console.error('Transfer confirmation error:', error);
        res.status(400).json({ error: error.message || 'Failed to confirm transfer' });
    }
});

// ==========================================
// ADMIN & MONITORING ROUTES
// ==========================================

// System statistics
app.get('/api/admin/stats', async (req, res) => {
    try {
        const stats = await db.getSystemStats();
        res.json({
            success: true,
            stats
        });
    } catch (error) {
        console.error('Stats fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'FairPass API is running',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: db.isConnected ? 'MongoDB Connected' : 'Demo Mode'
    });
});

// ==========================================
// ERROR HANDLING
// ==========================================

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'API endpoint not found',
        path: req.originalUrl
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {
    console.log(`
🎫 FairPass API Server Running
🌐 Port: ${PORT}
📊 Database: MongoDB (with demo fallback)
🔒 Security: Dynamic QR Codes (30s expiry)
🚫 Anti-Fraud: Multi-layer protection
📱 QR Protection: Prevents copying/selling
🚀 Ready for production!
    `);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down FairPass API...');
    await db.close();
    process.exit(0);
}); 