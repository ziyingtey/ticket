const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const FairPassMongoDB = require('./database/mongodb');
const EmailService = require('./services/emailService');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize MongoDB database
const db = new FairPassMongoDB();
const emailService = new EmailService();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Authentication middleware
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const verification = await db.verifyToken(token);
    if (!verification.valid) {
      return res.status(403).json({ error: verification.error });
    }
    req.user = verification.user;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid token' });
  }
}

// ==========================================
// AUTHENTICATION ENDPOINTS
// ==========================================

// User registration
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, walletAddress, firstName, lastName } = req.body;

    // Validate required fields
    if (!email || !password || !walletAddress || !firstName || !lastName) {
      return res.status(400).json({ 
        error: 'All fields are required: email, password, walletAddress, firstName, lastName' 
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    const result = await db.registerUser({
      email,
      password,
      walletAddress,
      firstName,
      lastName
    });

    // Send verification email
    try {
      const verificationUrl = `http://localhost:3000/auth/verify?token=${result.verificationToken}`;
      await emailService.sendVerificationEmail({
        to: email,
        firstName: firstName,
        verificationUrl: verificationUrl
      });
    } catch (emailError) {
      console.error('Failed to send verification email:', emailError);
      // Continue anyway - user can request resend
    }

    res.json({
      success: true,
      message: result.message,
      user: result.user,
      requiresVerification: true
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Email verification route
app.get('/api/auth/verify/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    if (!token) {
      return res.status(400).json({ error: 'Verification token is required' });
    }

    const result = await db.verifyEmail(token);

    res.json({
      success: true,
      message: result.message,
      user: result.user,
      token: result.token
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Route to resend verification email
app.post('/api/auth/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Find unverified user
    const user = await db.db.collection('users').findOne({ 
      email: email, 
      emailVerified: false 
    });

    if (!user) {
      return res.status(400).json({ 
        error: 'No unverified account found with this email' 
      });
    }

    // Generate new verification token if expired
    if (user.emailVerificationExpiry < new Date()) {
      const crypto = require('crypto');
      const newToken = crypto.randomBytes(32).toString('hex');
      const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await db.db.collection('users').updateOne(
        { _id: user._id },
        { 
          $set: {
            emailVerificationToken: newToken,
            emailVerificationExpiry: newExpiry
          }
        }
      );

      user.emailVerificationToken = newToken;
    }

    // Send verification email
    const verificationUrl = `http://localhost:3000/auth/verify?token=${user.emailVerificationToken}`;
    await emailService.sendVerificationEmail({
      to: email,
      firstName: user.firstName,
      verificationUrl: verificationUrl
    });

    res.json({
      success: true,
      message: 'Verification email sent! Please check your inbox.'
    });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(400).json({ error: error.message });
  }
});

// User login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await db.loginUser(email, password);

    res.json({
      success: true,
      message: 'Login successful',
      user: result.user,
      token: result.token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(401).json({ error: error.message });
  }
});

// Verify token
app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// ==========================================
// EVENT ENDPOINTS
// ==========================================

// Get all events
app.get('/api/events', async (req, res) => {
  try {
    const events = await db.getEvents();
    res.json({ success: true, events });
  } catch (error) {
    console.error('Error getting events:', error);
    res.status(500).json({ error: 'Failed to fetch events', details: error.message });
  }
});

// Get single event
app.get('/api/events/:id', async (req, res) => {
  try {
    const event = await db.getEvent(req.params.id);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.json({ success: true, event });
  } catch (error) {
    console.error('Error getting event:', error);
    res.status(500).json({ error: 'Failed to fetch event', details: error.message });
  }
});

// ==========================================
// TICKET PURCHASE ENDPOINTS
// ==========================================

// Purchase tickets with authentication and limits
app.post('/api/tickets/purchase', authenticateToken, async (req, res) => {
  try {
    const { eventId, quantity, transactionHash } = req.body;

    // Validate input
    if (!eventId || !quantity || !transactionHash) {
      return res.status(400).json({ 
        error: 'eventId, quantity, and transactionHash are required' 
      });
    }

    if (quantity < 1 || quantity > 10) {
      return res.status(400).json({ 
        error: 'Quantity must be between 1 and 10' 
      });
    }

    const result = await db.purchaseTickets({
      eventId,
      userId: req.user.id,
      quantity,
      transactionHash
    });

    res.json({
      success: true,
      message: `Successfully purchased ${quantity} ticket(s)`,
      tickets: result.tickets
    });
  } catch (error) {
    console.error('Error purchasing tickets:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get user's tickets
app.get('/api/tickets/my', authenticateToken, async (req, res) => {
  try {
    const tickets = await db.getUserTickets(req.user.walletAddress);
    res.json({ success: true, tickets });
  } catch (error) {
    console.error('Error getting user tickets:', error);
    res.status(500).json({ error: 'Failed to fetch tickets', details: error.message });
  }
});

// ==========================================
// TRANSFER/RESALE ENDPOINTS
// ==========================================

// Create transfer request with email notification
app.post('/api/transfers/create', authenticateToken, async (req, res) => {
  try {
    const {
      ticketId,
      recipientEmail,
      price = null,
      isResale = false,
      message = ''
    } = req.body;

    if (!ticketId || !recipientEmail) {
      return res.status(400).json({ error: 'ticketId and recipientEmail are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check if recipient has FairPass account
    let recipientUser = null;
    try {
      recipientUser = await db.db.collection('users').findOne({ email: recipientEmail });
    } catch (error) {
      // Continue without recipient user - they'll need to register
    }

    // Create transfer request
    const transferData = {
      ticketId,
      fromUserId: req.user.userId,
      fromEmail: req.user.email,
      toEmail: recipientEmail,
      toUserId: recipientUser?._id || null,
      price: isResale ? parseFloat(price) : null,
      isResale,
      message,
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    };

    const result = await db.createTransferRequest(transferData);

    // Get ticket and event details for email
    const ticket = await db.db.collection('tickets').findOne({ 
      _id: new db.ObjectId(ticketId) 
    });
    const event = await db.db.collection('events').findOne({ 
      _id: new db.ObjectId(ticket.eventId) 
    });

    // Send email notification
    const emailResult = await emailService.sendTransferNotification({
      recipientEmail,
      senderEmail: req.user.email,
      senderName: req.user.name,
      ticketDetails: {
        ticketId: ticketId,
        eventName: event.name,
        date: event.date,
        venue: event.location,
        type: ticket.ticketType || 'General Admission'
      },
      transferId: result.transferId,
      price: isResale ? price : null,
      isResale
    });

    res.json({
      success: true,
      message: isResale ? 'Sale offer sent successfully!' : 'Transfer request sent successfully!',
      transferId: result.transferId,
      recipientHasAccount: !!recipientUser,
      emailSent: emailResult.success,
      emailPreview: emailResult.previewUrl || null
    });
  } catch (error) {
    console.error('Error creating transfer:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get transfer details (for email recipients)
app.get('/api/transfers/:transferId', async (req, res) => {
  try {
    const { transferId } = req.params;
    
    // Get transfer request
    const transfer = await db.db.collection('transfer_requests').findOne({
      _id: new db.ObjectId(transferId)
    });

    if (!transfer) {
      return res.status(404).json({ error: 'Transfer not found' });
    }

    // Check if expired
    if (new Date() > transfer.expiresAt) {
      return res.status(410).json({ error: 'Transfer has expired' });
    }

    // Get ticket and event details
    const ticket = await db.db.collection('tickets').findOne({
      _id: new db.ObjectId(transfer.ticketId)
    });
    const event = await db.db.collection('events').findOne({
      _id: new db.ObjectId(ticket.eventId)
    });
    const sender = await db.db.collection('users').findOne({
      _id: new db.ObjectId(transfer.fromUserId)
    });

    res.json({
      success: true,
      transfer: {
        id: transfer._id,
        ticketId: transfer.ticketId,
        from: {
          email: transfer.fromEmail,
          name: sender?.name || 'Anonymous'
        },
        to: {
          email: transfer.toEmail
        },
        price: transfer.price,
        isResale: transfer.isResale,
        message: transfer.message,
        status: transfer.status,
        createdAt: transfer.createdAt,
        expiresAt: transfer.expiresAt
      },
      ticket: {
        id: ticket._id,
        tokenId: ticket.tokenId,
        ticketType: ticket.ticketType
      },
      event: {
        name: event.name,
        date: event.date,
        location: event.location,
        description: event.description,
        image: event.image
      }
    });
  } catch (error) {
    console.error('Error getting transfer:', error);
    res.status(400).json({ error: error.message });
  }
});

// Approve/reject transfer (enhanced with email confirmation)
app.post('/api/transfers/:transferId/:action', authenticateToken, async (req, res) => {
  try {
    const { transferId, action } = req.params;

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be accept or reject' });
    }

    // Get transfer details
    const transfer = await db.db.collection('transfer_requests').findOne({
      _id: new db.ObjectId(transferId)
    });

    if (!transfer) {
      return res.status(404).json({ error: 'Transfer not found' });
    }

    if (transfer.toEmail !== req.user.email) {
      return res.status(403).json({ error: 'You are not authorized to modify this transfer' });
    }

    if (transfer.status !== 'pending') {
      return res.status(400).json({ error: 'Transfer is no longer pending' });
    }

    if (new Date() > transfer.expiresAt) {
      return res.status(410).json({ error: 'Transfer has expired' });
    }

    let result;
    if (action === 'accept') {
      // Process the transfer
      result = await db.approveTransfer(transferId, req.user.userId);
    } else {
      // Reject the transfer
      await db.db.collection('transfer_requests').updateOne(
        { _id: new db.ObjectId(transferId) },
        { 
          $set: { 
            status: 'rejected',
            rejectedAt: new Date(),
            rejectedBy: req.user.userId
          }
        }
      );
      result = { success: true, message: 'Transfer rejected' };
    }

    // Get ticket and event details for confirmation email
    const ticket = await db.db.collection('tickets').findOne({
      _id: new db.ObjectId(transfer.ticketId)
    });
    const event = await db.db.collection('events').findOne({
      _id: new db.ObjectId(ticket.eventId)
    });

    // Send confirmation email to sender
    await emailService.sendTransferConfirmation({
      senderEmail: transfer.fromEmail,
      recipientEmail: transfer.toEmail,
      ticketDetails: {
        ticketId: transfer.ticketId,
        eventName: event.name,
        date: event.date,
        venue: event.location
      },
      action: action === 'accept' ? 'accepted' : 'rejected',
      price: transfer.price
    });

    res.json({
      success: true,
      message: action === 'accept' 
        ? 'Transfer accepted successfully! You now own this ticket.' 
        : 'Transfer rejected.',
      action,
      transferId
    });
  } catch (error) {
    console.error(`Error ${action}ing transfer:`, error);
    res.status(400).json({ error: error.message });
  }
});

// ==========================================
// QR CODE ENDPOINTS (SECURE)
// ==========================================

// Generate secure QR code
app.post('/api/qr/generate', authenticateToken, async (req, res) => {
  try {
    const { ticketId, venueMode = false, userLocation = null } = req.body;

    if (!ticketId) {
      return res.status(400).json({ error: 'ticketId is required' });
    }

    // Validate location data if venue mode is requested
    if (venueMode && userLocation) {
      if (!userLocation.lat || !userLocation.lng) {
        return res.status(400).json({ 
          error: 'Valid location coordinates (lat, lng) required for venue mode' 
        });
      }
    }

    const qrData = await db.generateSecureQR(
      ticketId, 
      req.user.walletAddress, 
      venueMode, 
      userLocation
    );

    res.json({
      success: true,
      message: qrData.qrType === 'venue_entry' 
        ? 'Extended venue entry QR generated' 
        : qrData.qrType === 'venue_proximity'
        ? 'Venue proximity QR generated'
        : 'Standard QR code generated',
      qrData
    });
  } catch (error) {
    console.error('Error generating QR:', error);
    res.status(400).json({ error: error.message });
  }
});

// Verify QR code (for scanners)
app.post('/api/qr/verify', async (req, res) => {
  try {
    const { verificationToken, scannerData } = req.body;

    if (!verificationToken || !scannerData) {
      return res.status(400).json({ 
        error: 'verificationToken and scannerData are required' 
      });
    }

    const result = await db.verifyQRCode(verificationToken, scannerData);

    res.json(result);
  } catch (error) {
    console.error('Error verifying QR:', error);
    res.status(500).json({ 
      success: false,
      result: 'error',
      message: 'Verification system error',
      timestamp: new Date().toISOString()
    });
  }
});

// ==========================================
// ADMIN/STATS ENDPOINTS
// ==========================================

// Get system statistics
app.get('/api/admin/stats', async (req, res) => {
  try {
    const stats = await db.getSystemStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats', details: error.message });
  }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  res.json({
    success: true,
    message: 'FairPass API is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: db.isConnected ? 'MongoDB Connected' : 'Demo Mode',
    features: {
      userAuthentication: true,
      purchaseLimits: true,
      transferSystem: true,
      antifraudQR: true,
      priceControls: true
    }
  });
});

// ==========================================
// ERROR HANDLING
// ==========================================

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    availableEndpoints: [
      'POST /api/auth/register',
      'POST /api/auth/login',
      'GET /api/auth/verify',
      'GET /api/events',
      'GET /api/events/:id',
      'POST /api/tickets/purchase',
      'GET /api/tickets/my',
      'POST /api/transfers/create',
      'GET /api/transfers/pending',
      'POST /api/transfers/approve',
      'POST /api/qr/generate',
      'POST /api/qr/verify',
      'GET /api/admin/stats',
      'GET /api/health'
    ]
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`
███████╗ █████╗ ██╗██████╗  █████╗ ███████╗███████╗
██╔════╝██╔══██╗██║██╔══██╗██╔══██╗██╔════╝██╔════╝
█████╗  ███████║██║██████╔╝███████║█████╗  ███████╗
██╔══╝  ██╔══██║██║██╔══██╗██╔══██║██╔══╝  ╚════██║
██║     ██║  ██║██║██║  ██║██║  ██║███████╗███████║
╚═╝     ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚══════╝

🎫 FairPass API Server Running
🌐 Port: ${PORT}
📊 Database: MongoDB with Authentication
🔒 Security: JWT Authentication + Dynamic QR Codes
🎯 Features: Purchase Limits + Transfer System + Anti-Fraud
💰 Price Control: Resale limits enforced
👥 User Management: Email registration required
🚫 Anti-Fraud: QR codes expire every 30 seconds
📱 QR Protection: Prevents external platform selling
🔄 Transfer System: Recipient confirmation required
💸 Resale Limits: Maximum price multipliers enforced
🚀 Ready for production!
  `);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down FairPass API...');
  await db.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down FairPass API...');
  await db.close();
  process.exit(0);
}); 