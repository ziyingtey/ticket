const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); // Added for email verification token

class FairPassMongoDB {
  constructor() {
    this.client = null;
    this.db = null;
    this.isConnected = false;
    this.JWT_SECRET = process.env.JWT_SECRET || 'fairpass-secret-key-2025';
    this.initializeConnection();
  }

  async initializeConnection() {
    try {
      const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
      this.client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      
      await this.client.connect();
      this.db = this.client.db('fairpass');
      this.isConnected = true;
      
      console.log('✅ MongoDB connected successfully');
      
      // Create indexes and sample data
      await this.createIndexes();
      await this.initializeSampleData();
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error.message);
      this.isConnected = false;
      // Don't throw - allow fallback to demo mode
    }
  }

  async createIndexes() {
    try {
      if (!this.isConnected || !this.db) return;

      // Users collection indexes
      await this.db.collection('users').createIndex({ email: 1 }, { unique: true });
      await this.db.collection('users').createIndex({ walletAddress: 1 }, { unique: true });
      
      // Tickets collection indexes
      await this.db.collection('tickets').createIndex({ ownerAddress: 1 });
      await this.db.collection('tickets').createIndex({ eventId: 1 });
      await this.db.collection('tickets').createIndex({ tokenId: 1 }, { unique: true });
      
      // Events collection indexes
      await this.db.collection('events').createIndex({ name: 1 });
      
      // Transfers collection indexes
      await this.db.collection('transfers').createIndex({ fromAddress: 1 });
      await this.db.collection('transfers').createIndex({ toAddress: 1 });
      await this.db.collection('transfers').createIndex({ status: 1 });
      
      // QR verifications indexes
      await this.db.collection('qrverifications').createIndex({ verificationToken: 1 }, { unique: true });
      await this.db.collection('qrverifications').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      
      console.log('✅ Database indexes created');
    } catch (error) {
      console.error('❌ Error creating indexes:', error.message);
    }
  }

  async initializeSampleData() {
    try {
      if (!this.isConnected || !this.db) return;

      // Check if events already exist
      const eventCount = await this.db.collection('events').countDocuments();
      if (eventCount > 0) {
        console.log('✅ Sample data already exists');
        return;
      }

      // Create sample events
      const events = [
        {
          _id: new ObjectId(),
          name: 'FairFest 2025',
          description: 'A revolutionary Web3 music festival celebrating decentralized creativity and social impact.',
          venue: 'Singapore Marina Bay',
          date: '2025-09-15',
          time: '18:00',
          totalTickets: 1000,
          availableTickets: 1000,
          priceETH: 0.01,
          category: 'Music Festival',
          organizer: 'FairPass Events',
          image: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800',
          sustainabilityFeatures: [
            'Carbon-neutral venue',
            'Digital-only tickets',
            'Local artist support'
          ],
          maxTicketsPerUser: 10,
          resaleMultiplier: 0.2, // Max 20% above original price
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          _id: new ObjectId(),
          name: 'Tech for Good Conference 2025',
          description: 'Blockchain innovations driving social impact and sustainable development.',
          venue: 'Innovation Hub',
          date: '2025-10-20',
          time: '09:00',
          totalTickets: 300,
          availableTickets: 300,
          priceETH: 0.005,
          category: 'Conference',
          organizer: 'BGA Alliance',
          image: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800',
          sustainabilityFeatures: [
            'Paperless conference',
            'Remote participation options',
            'Offset carbon emissions'
          ],
          maxTicketsPerUser: 5,
          resaleMultiplier: 0.15, // Max 15% above original price
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          _id: new ObjectId(),
          name: 'Sustainable Art Gallery Opening',
          description: 'Eco-conscious art exhibition featuring NFT artists committed to environmental causes.',
          venue: 'Green Gallery',
          date: '2025-11-10',
          time: '19:00',
          totalTickets: 150,
          availableTickets: 150,
          priceETH: 0.003,
          category: 'Art Exhibition',
          organizer: 'EcoArt Collective',
          image: 'https://images.unsplash.com/photo-1578321272176-b7bbc0679853?w=800',
          sustainabilityFeatures: [
            'Renewable energy venue',
            'Local materials only',
            'Waste-free event'
          ],
          maxTicketsPerUser: 3,
          resaleMultiplier: 0.1, // Max 10% above original price
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      await this.db.collection('events').insertMany(events);
      console.log('✅ Sample events created');
      
    } catch (error) {
      console.error('Error initializing sample data:', error.message);
    }
  }

  // ==========================================
  // USER AUTHENTICATION METHODS
  // ==========================================

  async registerUser(userData) {
    try {
      if (!this.isConnected || !this.db) {
        throw new Error('Database not connected');
      }

      const { email, password, walletAddress, firstName, lastName } = userData;
      
      // Check if user already exists in verified users collection
      const existingUser = await this.db.collection('users').findOne({
        $or: [{ email }, { walletAddress }]
      });
      
      if (existingUser) {
        throw new Error('User already exists with this email or wallet address');
      }

      // Clean up ALL pending registrations for this email/wallet to allow fresh registration
      await this.db.collection('pendingUsers').deleteMany({
        $or: [{ email }, { walletAddress }]
      });

      // Also clean up any existing verified users for testing purposes
      // await this.db.collection('users').deleteMany({
      //   $or: [{ email }, { walletAddress }]
      // });

      // Hash password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Generate email verification token
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Create user document and save directly to users collection for immediate access
      const newUser = {
        _id: new ObjectId(),
        email,
        password: hashedPassword,
        walletAddress,
        firstName,
        lastName,
        totalTicketsPurchased: 0,
        totalTicketsTransferred: 0,
        totalSpentETH: 0,
        verificationLevel: 'basic',
        emailVerified: true, // Set to true for immediate access
        registrationDate: new Date(),
        lastLogin: new Date(),
        isActive: true,
        purchaseHistory: [],
        transferHistory: [],
        verificationToken: verificationToken,
        verificationExpiry: verificationExpiry
      };

      // Save directly to users collection for immediate login access
      const result = await this.db.collection('users').insertOne(newUser);
      
      // Generate JWT token for immediate login
      const jwtToken = jwt.sign(
        { 
          userId: result.insertedId, 
          email: email, 
          walletAddress: walletAddress 
        }, 
        this.JWT_SECRET, 
        { expiresIn: '7d' }
      );

      return {
        success: true,
        message: 'Registration successful! You can now login immediately.',
        userId: result.insertedId,
        user: {
          id: result.insertedId,
          email,
          firstName,
          lastName,
          emailVerified: true,
          verificationLevel: 'basic'
        },
        token: jwtToken,
        requiresVerification: false
      };
    } catch (error) {
      throw new Error(`Registration failed: ${error.message}`);
    }
  }

  // Method to verify email and move user from pending to verified collection
  async verifyEmail(token) {
    try {
      if (!this.isConnected || !this.db) {
        throw new Error('Database not connected');
      }

      // Find pending user with valid verification token
      const pendingUser = await this.db.collection('pendingUsers').findOne({
        verificationToken: token,
        verificationExpiry: { $gt: new Date() }
      });

      if (!pendingUser) {
        throw new Error('Invalid or expired verification token');
      }

      // Create verified user document with all necessary fields
      const verifiedUser = {
        _id: pendingUser._id,
        email: pendingUser.email,
        password: pendingUser.password,
        walletAddress: pendingUser.walletAddress,
        firstName: pendingUser.firstName,
        lastName: pendingUser.lastName,
        totalTicketsPurchased: 0,
        totalTicketsTransferred: 0,
        totalSpentETH: 0,
        verificationLevel: 'basic',
        emailVerified: true,
        registrationDate: pendingUser.registrationDate,
        lastLogin: new Date(),
        isActive: true,
        purchaseHistory: [],
        transferHistory: []
      };

      // Save verified user to main users collection
      await this.db.collection('users').insertOne(verifiedUser);

      // Remove from pending users collection
      await this.db.collection('pendingUsers').deleteOne({ _id: pendingUser._id });

      // Generate JWT token for the verified user
      const jwtToken = jwt.sign(
        { 
          userId: verifiedUser._id, 
          email: verifiedUser.email, 
          walletAddress: verifiedUser.walletAddress 
        }, 
        this.JWT_SECRET, 
        { expiresIn: '7d' }
      );

      return {
        success: true,
        message: 'Email verified successfully! You can now log in.',
        user: {
          id: verifiedUser._id,
          email: verifiedUser.email,
          walletAddress: verifiedUser.walletAddress,
          firstName: verifiedUser.firstName,
          lastName: verifiedUser.lastName,
          verificationLevel: verifiedUser.verificationLevel,
          totalTicketsPurchased: verifiedUser.totalTicketsPurchased
        },
        token: jwtToken
      };
    } catch (error) {
      throw new Error(`Email verification failed: ${error.message}`);
    }
  }

  async loginUser(email, password) {
    try {
      if (!this.isConnected || !this.db) {
        throw new Error('Database not connected');
      }

      // Find user by email
      const user = await this.db.collection('users').findOne({ email });
      if (!user) {
        throw new Error('Invalid email or password');
      }

      // Email verification check removed - users can login immediately after registration
      // if (!user.emailVerified) {
      //   throw new Error('Please verify your email before logging in. Check your inbox for the verification link.');
      // }

      // Check password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        throw new Error('Invalid email or password');
      }

      // Update last login
      await this.db.collection('users').updateOne(
        { _id: user._id },
        { $set: { lastLogin: new Date() } }
      );

      // Generate JWT token
      const token = jwt.sign(
        { 
          userId: user._id, 
          email: user.email, 
          walletAddress: user.walletAddress 
        }, 
        this.JWT_SECRET, 
        { expiresIn: '7d' }
      );

      return {
        success: true,
        user: {
          id: user._id,
          email: user.email,
          walletAddress: user.walletAddress,
          firstName: user.firstName,
          lastName: user.lastName,
          verificationLevel: user.verificationLevel,
          totalTicketsPurchased: user.totalTicketsPurchased
        },
        token
      };
    } catch (error) {
      throw new Error(`Login failed: ${error.message}`);
    }
  }

  // Utility method to clean up expired pending registrations
  async cleanupExpiredPendingUsers() {
    try {
      if (!this.isConnected || !this.db) {
        throw new Error('Database not connected');
      }

      const result = await this.db.collection('pendingUsers').deleteMany({
        verificationExpiry: { $lt: new Date() }
      });

      console.log(`🧹 Cleaned up ${result.deletedCount} expired pending registrations`);
      return result.deletedCount;
    } catch (error) {
      console.error('Cleanup error:', error);
      throw new Error(`Cleanup failed: ${error.message}`);
    }
  }

  async verifyToken(token) {
    try {
      const decoded = jwt.verify(token, this.JWT_SECRET);
      
      if (!this.isConnected || !this.db) {
        return { valid: false, error: 'Database not connected' };
      }

      const user = await this.db.collection('users').findOne({ _id: new ObjectId(decoded.userId) });
      if (!user || !user.isActive) {
        return { valid: false, error: 'User not found or inactive' };
      }

      return {
        valid: true,
        user: {
          id: user._id.toString(),
          email: user.email,
          walletAddress: user.walletAddress,
          firstName: user.firstName,
          lastName: user.lastName,
          verificationLevel: user.verificationLevel
        }
      };
    } catch (error) {
      return { valid: false, error: 'Invalid token' };
    }
  }

  // ==========================================
  // EVENT METHODS
  // ==========================================

  async getEvents() {
    try {
      if (!this.isConnected || !this.db) {
        return this.getDemoEvents();
      }

      const events = await this.db.collection('events').find({}).toArray();
      return events.map(event => ({
        id: event._id.toString(),
        name: event.name,
        description: event.description,
        venue: event.venue,
        date: event.date,
        time: event.time,
        totalTickets: event.totalTickets,
        availableTickets: event.availableTickets,
        priceETH: event.priceETH,
        category: event.category,
        organizer: event.organizer,
        image: event.image,
        sustainabilityFeatures: event.sustainabilityFeatures,
        maxTicketsPerUser: event.maxTicketsPerUser,
        resaleMultiplier: event.resaleMultiplier
      }));
    } catch (error) {
      console.error('Error getting events:', error);
      return this.getDemoEvents();
    }
  }

  getDemoEvents() {
    return [
      {
        id: '1',
        name: 'FairFest 2025',
        description: 'A revolutionary Web3 music festival celebrating decentralized creativity and social impact.',
        venue: 'Singapore Marina Bay',
        date: '2025-09-15',
        time: '18:00',
        totalTickets: 1000,
        availableTickets: 1000,
        priceETH: 0.01,
        category: 'Music Festival',
        organizer: 'FairPass Events',
        image: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800',
        sustainabilityFeatures: [
          'Carbon-neutral venue',
          'Digital-only tickets',
          'Local artist support'
        ],
        maxTicketsPerUser: 10,
        resaleMultiplier: 0.2
      }
    ];
  }

  async getEvent(eventId) {
    try {
      if (!this.isConnected || !this.db) {
        return this.getDemoEvents().find(e => e.id === eventId);
      }

      const event = await this.db.collection('events').findOne({ _id: new ObjectId(eventId) });
      if (!event) return null;

      return {
        id: event._id.toString(),
        name: event.name,
        description: event.description,
        venue: event.venue,
        date: event.date,
        time: event.time,
        totalTickets: event.totalTickets,
        availableTickets: event.availableTickets,
        priceETH: event.priceETH,
        category: event.category,
        organizer: event.organizer,
        image: event.image,
        sustainabilityFeatures: event.sustainabilityFeatures,
        maxTicketsPerUser: event.maxTicketsPerUser,
        resaleMultiplier: event.resaleMultiplier
      };
    } catch (error) {
      console.error('Error getting event:', error);
      return null;
    }
  }

  // ==========================================
  // TICKET PURCHASE WITH LIMITS
  // ==========================================

  async purchaseTickets(purchaseData) {
    try {
      if (!this.isConnected || !this.db) {
        throw new Error('Database not connected');
      }

      const { eventId, userId, quantity, transactionHash } = purchaseData;

      // Get event and user data
      const event = await this.db.collection('events').findOne({ _id: new ObjectId(eventId) });
      const user = await this.db.collection('users').findOne({ _id: new ObjectId(userId) });

      if (!event) throw new Error('Event not found');
      if (!user) throw new Error('User not found');

      // Check availability
      if (event.availableTickets < quantity) {
        throw new Error('Not enough tickets available');
      }

      // Check user purchase limit for this event
      const userTicketsForEvent = await this.db.collection('tickets').countDocuments({
        ownerAddress: user.walletAddress,
        eventId: eventId,
        isTransferred: false
      });

      if (userTicketsForEvent + quantity > event.maxTicketsPerUser) {
        throw new Error(`Purchase limit exceeded. Maximum ${event.maxTicketsPerUser} tickets per user for this event.`);
      }

      // Create tickets
      const tickets = [];
      for (let i = 0; i < quantity; i++) {
        const tokenId = Math.floor(Math.random() * 1e10);
        const ticket = {
          _id: new ObjectId(),
          tokenId,
          eventId: eventId,
          eventName: event.name,
          venue: event.venue,
          date: event.date,
          time: event.time,
          ownerAddress: user.walletAddress,
          ownerEmail: user.email,
          ownerName: `${user.firstName} ${user.lastName}`,
          originalPrice: event.priceETH,
          purchaseTimestamp: new Date(),
          transactionHash,
          isUsed: false,
          isTransferred: false,
          transferHistory: [],
          fraudAlerts: [],
          createdAt: new Date()
        };
        tickets.push(ticket);
      }

      // Insert tickets
      await this.db.collection('tickets').insertMany(tickets);

      // Update event availability
      await this.db.collection('events').updateOne(
        { _id: new ObjectId(eventId) },
        { $inc: { availableTickets: -quantity } }
      );

      // Update user stats
      await this.db.collection('users').updateOne(
        { _id: new ObjectId(userId) },
        { 
          $inc: { 
            totalTicketsPurchased: quantity,
            totalSpentETH: event.priceETH * quantity
          },
          $push: {
            purchaseHistory: {
              eventId,
              eventName: event.name,
              quantity,
              priceETH: event.priceETH,
              totalETH: event.priceETH * quantity,
              transactionHash,
              timestamp: new Date()
            }
          }
        }
      );

      return {
        success: true,
        tickets: tickets.map(t => ({
          id: t._id.toString(),
          tokenId: t.tokenId,
          eventId: t.eventId,
          eventName: t.eventName,
          venue: t.venue,
          date: t.date,
          time: t.time,
          ownerAddress: t.ownerAddress,
          originalPrice: t.originalPrice,
          purchaseTimestamp: t.purchaseTimestamp
        }))
      };
    } catch (error) {
      throw new Error(`Purchase failed: ${error.message}`);
    }
  }

  // ==========================================
  // TRANSFER/RESALE SYSTEM
  // ==========================================

  async createTransferRequest(transferData) {
    try {
      if (!this.isConnected || !this.db) {
        throw new Error('Database not connected');
      }

      const { ticketId, fromUserId, toEmail, transferType, price } = transferData;
      // transferType: 'transfer' (free) or 'sale' (paid)

      // Get ticket and verify ownership
      const ticket = await this.db.collection('tickets').findOne({ _id: new ObjectId(ticketId) });
      const fromUser = await this.db.collection('users').findOne({ _id: new ObjectId(fromUserId) });

      if (!ticket) throw new Error('Ticket not found');
      if (!fromUser) throw new Error('User not found');
      if (ticket.ownerAddress !== fromUser.walletAddress) {
        throw new Error('You do not own this ticket');
      }
      if (ticket.isUsed) throw new Error('Ticket has already been used');

      // Get event for price validation
      const event = await this.db.collection('events').findOne({ _id: new ObjectId(ticket.eventId) });
      
      // Validate resale price
      if (transferType === 'sale') {
        const maxPrice = ticket.originalPrice * (1 + event.resaleMultiplier);
        if (price > maxPrice) {
          throw new Error(`Resale price exceeds limit. Maximum allowed: ${maxPrice} ETH`);
        }
      }

      // Create transfer request
      const transfer = {
        _id: new ObjectId(),
        ticketId: ticketId,
        fromAddress: fromUser.walletAddress,
        fromEmail: fromUser.email,
        fromName: `${fromUser.firstName} ${fromUser.lastName}`,
        toEmail,
        transferType, // 'transfer' or 'sale'
        price: transferType === 'sale' ? price : 0,
        status: 'pending', // pending, approved, rejected, completed
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        eventName: ticket.eventName,
        eventDate: ticket.date,
        confirmationToken: this.generateSecureToken()
      };

      await this.db.collection('transfers').insertOne(transfer);

      return {
        success: true,
        transfer: {
          id: transfer._id.toString(),
          ticketId: transfer.ticketId,
          fromEmail: transfer.fromEmail,
          toEmail: transfer.toEmail,
          transferType: transfer.transferType,
          price: transfer.price,
          status: transfer.status,
          eventName: transfer.eventName,
          eventDate: transfer.eventDate,
          confirmationToken: transfer.confirmationToken
        }
      };
    } catch (error) {
      throw new Error(`Transfer creation failed: ${error.message}`);
    }
  }

  async getPendingTransfers(userEmail) {
    try {
      if (!this.isConnected || !this.db) {
        return [];
      }

      const transfers = await this.db.collection('transfers').find({
        toEmail: userEmail,
        status: 'pending',
        expiresAt: { $gt: new Date() }
      }).toArray();

      return transfers.map(t => ({
        id: t._id.toString(),
        ticketId: t.ticketId,
        fromEmail: t.fromEmail,
        fromName: t.fromName,
        transferType: t.transferType,
        price: t.price,
        eventName: t.eventName,
        eventDate: t.eventDate,
        createdAt: t.createdAt,
        confirmationToken: t.confirmationToken
      }));
    } catch (error) {
      console.error('Error getting pending transfers:', error);
      return [];
    }
  }

  async approveTransfer(transferId, toUserId, paymentHash = null) {
    try {
      if (!this.isConnected || !this.db) {
        throw new Error('Database not connected');
      }

      const transfer = await this.db.collection('transfers').findOne({ _id: new ObjectId(transferId) });
      const toUser = await this.db.collection('users').findOne({ _id: new ObjectId(toUserId) });

      if (!transfer) throw new Error('Transfer not found');
      if (!toUser) throw new Error('User not found');
      if (transfer.status !== 'pending') throw new Error('Transfer is no longer pending');

      // Get ticket
      const ticket = await this.db.collection('tickets').findOne({ _id: new ObjectId(transfer.ticketId) });
      if (!ticket) throw new Error('Ticket not found');

      // Update ticket ownership
      await this.db.collection('tickets').updateOne(
        { _id: new ObjectId(transfer.ticketId) },
        {
          $set: {
            ownerAddress: toUser.walletAddress,
            ownerEmail: toUser.email,
            ownerName: `${toUser.firstName} ${toUser.lastName}`,
            isTransferred: true
          },
          $push: {
            transferHistory: {
              fromAddress: transfer.fromAddress,
              fromEmail: transfer.fromEmail,
              toAddress: toUser.walletAddress,
              toEmail: toUser.email,
              transferType: transfer.transferType,
              price: transfer.price,
              paymentHash,
              timestamp: new Date()
            }
          }
        }
      );

      // Update transfer status
      await this.db.collection('transfers').updateOne(
        { _id: new ObjectId(transferId) },
        {
          $set: {
            status: 'completed',
            completedAt: new Date(),
            paymentHash,
            toAddress: toUser.walletAddress
          }
        }
      );

      // Update user stats
      await this.db.collection('users').updateOne(
        { _id: new ObjectId(toUserId) },
        {
          $inc: { totalTicketsPurchased: 1 },
          $push: {
            transferHistory: {
              transferId,
              ticketId: transfer.ticketId,
              fromEmail: transfer.fromEmail,
              transferType: transfer.transferType,
              price: transfer.price,
              eventName: transfer.eventName,
              timestamp: new Date()
            }
          }
        }
      );

      return {
        success: true,
        message: 'Transfer completed successfully',
        ticket: {
          id: ticket._id.toString(),
          tokenId: ticket.tokenId,
          eventName: ticket.eventName,
          newOwner: toUser.email
        }
      };
    } catch (error) {
      throw new Error(`Transfer approval failed: ${error.message}`);
    }
  }

  // ==========================================
  // ANTI-FRAUD QR SYSTEM
  // ==========================================

  async generateSecureQR(ticketId, ownerAddress, venueMode = false, userLocation = null) {
    try {
      if (!this.isConnected || !this.db) {
        throw new Error('Database not connected');
      }

      // Verify ticket ownership
      const ticket = await this.db.collection('tickets').findOne({
        _id: new ObjectId(ticketId),
        ownerAddress
      });

      if (!ticket) {
        throw new Error('Ticket not found or you do not own this ticket');
      }

      if (ticket.isUsed) {
        throw new Error('Ticket has already been used');
      }

      // Get event details for venue validation
      const event = await this.db.collection('events').findOne({ _id: new ObjectId(ticket.eventId) });

      // Determine QR validity period based on location and context
      let expirySeconds = 30; // Default 30 seconds
      let qrType = 'standard';
      let distance = 999; // Default far from venue

      if (venueMode && userLocation) {
        // Venue coordinates (in real app, these would be stored in event data)
        const venueCoordinates = {
          lat: 1.2966, // Marina Bay, Singapore
          lng: 103.8547
        };

        // Check if user is within venue radius (100m)
        distance = this.calculateDistance(userLocation, venueCoordinates);
        
        if (distance <= 0.1) { // Within 100m of venue
          expirySeconds = 180; // 3 minutes at venue
          qrType = 'venue_entry';
        } else if (distance <= 0.5) { // Within 500m of venue
          expirySeconds = 60; // 1 minute near venue
          qrType = 'venue_proximity';
        }
      }

      // Generate time-limited token
      const verificationToken = this.generateSecureToken();
      const expiresAt = new Date(Date.now() + expirySeconds * 1000);

      // Store QR verification data
      const qrData = {
        _id: new ObjectId(),
        verificationToken,
        ticketId: ticketId,
        tokenId: ticket.tokenId,
        eventId: ticket.eventId,
        ownerAddress,
        expiresAt,
        isUsed: false,
        qrType, // 'standard', 'venue_proximity', 'venue_entry'
        generatedAt: new Date(),
        userLocation,
        venueMode,
        fraudPrevention: {
          ipAddress: 'system', // Would be real IP in production
          userAgent: 'system', // Would be real user agent
          geolocation: userLocation || 'unknown'
        }
      };

      await this.db.collection('qrverifications').insertOne(qrData);

      return {
        verificationToken,
        ticketId: ticketId,
        tokenId: ticket.tokenId,
        eventId: ticket.eventId,
        expiresAt: expiresAt.toISOString(),
        timeRemaining: expirySeconds,
        qrType,
        venueMode,
        isVenueProximity: distance <= 0.5,
        distanceToVenue: distance
      };
    } catch (error) {
      throw new Error(`QR generation failed: ${error.message}`);
    }
  }

  // Calculate distance between two coordinates (in kilometers)
  calculateDistance(pos1, pos2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(pos2.lat - pos1.lat);
    const dLng = this.toRadians(pos2.lng - pos1.lng);
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(pos1.lat)) * Math.cos(this.toRadians(pos2.lat)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  async verifyQRCode(verificationToken, scannerData) {
    try {
      if (!this.isConnected || !this.db) {
        throw new Error('Database not connected');
      }

      // Find QR verification record
      const qrRecord = await this.db.collection('qrverifications').findOne({
        verificationToken,
        expiresAt: { $gt: new Date() },
        isUsed: false
      });

      if (!qrRecord) {
        // Log fraud attempt
        await this.logFraudAttempt(verificationToken, scannerData, 'invalid_or_expired_token');
        
        return {
          success: false,
          result: 'invalid',
          message: 'QR code is invalid, expired, or already used',
          timestamp: new Date().toISOString()
        };
      }

      // Get ticket details
      const ticket = await this.db.collection('tickets').findOne({
        _id: new ObjectId(qrRecord.ticketId)
      });

      if (!ticket) {
        return {
          success: false,
          result: 'error',
          message: 'Ticket not found',
          timestamp: new Date().toISOString()
        };
      }

      // Mark QR as used
      await this.db.collection('qrverifications').updateOne(
        { _id: qrRecord._id },
        { 
          $set: { 
            isUsed: true,
            usedAt: new Date(),
            scannerData
          }
        }
      );

      // Mark ticket as used
      await this.db.collection('tickets').updateOne(
        { _id: new ObjectId(qrRecord.ticketId) },
        { 
          $set: { 
            isUsed: true,
            usedAt: new Date(),
            usedBy: scannerData
          }
        }
      );

      return {
        success: true,
        result: 'valid',
        message: 'Ticket verified successfully',
        ticket: {
          token_id: ticket.tokenId,
          event_name: ticket.eventName,
          venue: ticket.venue,
          date: ticket.date,
          time: ticket.time,
          owner_email: ticket.ownerEmail,
          owner_name: ticket.ownerName
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('QR verification error:', error);
      return {
        success: false,
        result: 'error',
        message: 'Verification failed',
        timestamp: new Date().toISOString()
      };
    }
  }

  async logFraudAttempt(verificationToken, scannerData, reason) {
    try {
      if (!this.isConnected || !this.db) return;

      const fraudAlert = {
        _id: new ObjectId(),
        verificationToken,
        scannerData,
        reason,
        timestamp: new Date(),
        ipAddress: scannerData.ipAddress || 'unknown',
        userAgent: scannerData.userAgent || 'unknown',
        severity: 'medium'
      };

      await this.db.collection('fraudalerts').insertOne(fraudAlert);
    } catch (error) {
      console.error('Error logging fraud attempt:', error);
    }
  }

  // ==========================================
  // USER TICKET MANAGEMENT
  // ==========================================

  async getUserTickets(walletAddress) {
    try {
      if (!this.isConnected || !this.db) {
        return [];
      }

      const tickets = await this.db.collection('tickets').find({
        ownerAddress: walletAddress
      }).toArray();

      return tickets.map(ticket => ({
        id: ticket._id.toString(),
        tokenId: ticket.tokenId,
        eventId: ticket.eventId,
        eventName: ticket.eventName,
        venue: ticket.venue,
        date: ticket.date,
        time: ticket.time,
        originalPrice: ticket.originalPrice,
        purchaseTimestamp: ticket.purchaseTimestamp,
        isUsed: ticket.isUsed,
        isTransferred: ticket.isTransferred,
        transferHistory: ticket.transferHistory || []
      }));
    } catch (error) {
      console.error('Error getting user tickets:', error);
      return [];
    }
  }

  // ==========================================
  // SYSTEM STATS
  // ==========================================

  async getSystemStats() {
    try {
      if (!this.isConnected || !this.db) {
        return {
          totalUsers: 0,
          totalEvents: 3,
          totalTickets: 0,
          pendingTransfers: 0,
          fraudAlerts: 0,
          databaseStatus: 'Demo Mode'
        };
      }

      const [totalUsers, totalEvents, totalTickets, pendingTransfers, fraudAlerts] = await Promise.all([
        this.db.collection('users').countDocuments(),
        this.db.collection('events').countDocuments(),
        this.db.collection('tickets').countDocuments(),
        this.db.collection('transfers').countDocuments({ status: 'pending' }),
        this.db.collection('fraudalerts').countDocuments()
      ]);

      return {
        totalUsers,
        totalEvents,
        totalTickets,
        pendingTransfers,
        fraudAlerts,
        databaseStatus: 'MongoDB Connected'
      };
    } catch (error) {
      console.error('Error getting stats:', error);
      return {
        totalUsers: 0,
        totalEvents: 0,
        totalTickets: 0,
        pendingTransfers: 0,
        fraudAlerts: 0,
        databaseStatus: 'Error'
      };
    }
  }

  // ==========================================
  // UTILITY METHODS
  // ==========================================

  generateSecureToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async close() {
    try {
      if (this.client) {
        await this.client.close();
        this.isConnected = false;
        console.log('✅ MongoDB connection closed');
      }
    } catch (error) {
      console.error('Error closing MongoDB connection:', error);
    }
  }
}

module.exports = FairPassMongoDB; 