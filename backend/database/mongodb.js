const { MongoClient, ObjectId } = require('mongodb');

class FairPassMongoDB {
  constructor() {
    this.client = null;
    this.db = null;
    this.isConnected = false;
    this.initializeConnection();
  }

  async initializeConnection() {
    try {
      const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
      this.client = new MongoClient(uri);
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
    }
  }

  async createIndexes() {
    try {
      // Create indexes for better performance
      await this.db.collection('users').createIndex({ walletAddress: 1 }, { unique: true });
      await this.db.collection('tickets').createIndex({ ownerAddress: 1, eventId: 1 });
      await this.db.collection('tickets').createIndex({ tokenId: 1 }, { unique: true });
      await this.db.collection('qrverifications').createIndex({ verificationToken: 1 });
      await this.db.collection('transfers').createIndex({ fromAddress: 1, toAddress: 1 });
    } catch (error) {
      console.error('Error creating indexes:', error.message);
    }
  }

  async initializeSampleData() {
    try {
      // Check if events already exist
      const eventsCount = await this.db.collection('events').countDocuments();
      if (eventsCount === 0) {
        const sampleEvents = [
          {
            id: 1,
            name: "FairFest 2025 - Web3 Music Festival",
            description: "Experience the future of live events with blockchain-verified tickets and sustainability tracking.",
            venue: "MetaVerse Stadium",
            date: "2025-12-15T19:00:00Z",
            price: "0.01",
            currency: "MATIC",
            totalTickets: 1000,
            availableTickets: 258,
            maxResalePrice: "0.02",
            organizer: "FairPass Events",
            category: "Music",
            sustainabilityFeatures: ["Carbon Neutral", "Paperless", "Renewable Energy"],
            createdAt: new Date(),
            updatedAt: new Date()
          },
          {
            id: 2,
            name: "Tech for Good Conference",
            description: "Join leaders in blockchain and social impact for a day of innovation and networking.",
            venue: "Innovation Hub",
            date: "2025-11-20T09:00:00Z",
            price: "0.005",
            currency: "MATIC",
            totalTickets: 300,
            availableTickets: 144,
            maxResalePrice: "0.01",
            organizer: "Tech4Good Foundation",
            category: "Conference",
            sustainabilityFeatures: ["Carbon Neutral", "Public Transport Access"],
            createdAt: new Date(),
            updatedAt: new Date()
          },
          {
            id: 3,
            name: "Sustainable Art Gallery Opening",
            description: "Discover eco-friendly art in our first carbon-neutral gallery event powered by FairPass.",
            venue: "Green Gallery",
            date: "2025-11-10T18:00:00Z",
            price: "0.003",
            currency: "MATIC",
            totalTickets: 150,
            availableTickets: 61,
            maxResalePrice: "0.006",
            organizer: "Green Arts Collective",
            category: "Art",
            sustainabilityFeatures: ["Carbon Neutral", "Local Materials", "Zero Waste"],
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ];

        await this.db.collection('events').insertMany(sampleEvents);
        console.log('✅ Sample events created');
      }
    } catch (error) {
      console.error('Error initializing sample data:', error.message);
    }
  }

  // Event methods
  async getEvents() {
    try {
      return await this.db.collection('events').find({}).toArray();
    } catch (error) {
      console.error('Error getting events:', error);
      return [];
    }
  }

  async getEvent(eventId) {
    try {
      return await this.db.collection('events').findOne({ id: parseInt(eventId) });
    } catch (error) {
      console.error('Error getting event:', error);
      return null;
    }
  }

  // User methods
  async createUser(walletAddress, didIdentifier) {
    try {
      const existingUser = await this.db.collection('users').findOne({ walletAddress });
      if (existingUser) return existingUser;

      const user = {
        walletAddress,
        didIdentifier,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await this.db.collection('users').insertOne(user);
      return { ...user, _id: result.insertedId };
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  // Ticket methods
  async createTicket(ticketData) {
    try {
      const ticket = {
        ...ticketData,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await this.db.collection('tickets').insertOne(ticket);
      return { ...ticket, _id: result.insertedId };
    } catch (error) {
      console.error('Error creating ticket:', error);
      throw error;
    }
  }

  async getUserTickets(walletAddress) {
    try {
      const tickets = await this.db.collection('tickets').find({ 
        ownerAddress: walletAddress,
        isTransferred: { $ne: true }
      }).toArray();

      // Enhance tickets with event data
      const enhancedTickets = [];
      for (const ticket of tickets) {
        const event = await this.getEvent(ticket.eventId);
        if (event) {
          enhancedTickets.push({
            id: ticket._id,
            tokenId: ticket.tokenId,
            eventId: ticket.eventId,
            eventName: event.name,
            venue: event.venue,
            date: event.date,
            purchasePrice: ticket.purchasePrice || event.price,
            transactionHash: ticket.transactionHash,
            isUsed: ticket.isUsed || false,
            createdAt: ticket.createdAt
          });
        }
      }

      return enhancedTickets;
    } catch (error) {
      console.error('Error getting user tickets:', error);
      return [];
    }
  }

  async getTicket(ticketId) {
    try {
      return await this.db.collection('tickets').findOne({ 
        $or: [
          { _id: new ObjectId(ticketId) },
          { id: parseInt(ticketId) }
        ]
      });
    } catch (error) {
      console.error('Error getting ticket:', error);
      return null;
    }
  }

  // QR Code methods
  async generateSecureQRData(ticketId, ownerAddress) {
    try {
      const ticket = await this.getTicket(ticketId);
      if (!ticket || ticket.ownerAddress !== ownerAddress) {
        throw new Error('Ticket not found or unauthorized');
      }

      const verificationToken = this.generateSecureToken();
      const expiresAt = new Date(Date.now() + 30000); // 30 seconds

      const qrData = {
        verificationToken,
        ticketId: ticket._id,
        tokenId: ticket.tokenId,
        eventId: ticket.eventId,
        ownerAddress,
        expiresAt,
        createdAt: new Date()
      };

      await this.db.collection('qrverifications').insertOne(qrData);

      return {
        verificationToken,
        ticketId: ticket._id,
        tokenId: ticket.tokenId,
        eventId: ticket.eventId,
        expiresAt: expiresAt.toISOString(),
        timeRemaining: 30
      };
    } catch (error) {
      console.error('Error generating QR data:', error);
      throw error;
    }
  }

  async verifyQRCode(verificationToken, scannerData) {
    try {
      const qrRecord = await this.db.collection('qrverifications').findOne({ verificationToken });
      
      if (!qrRecord) {
        await this.logFraudAttempt(verificationToken, 'invalid_token', scannerData);
        return {
          result: 'invalid',
          message: 'Invalid QR code',
          timestamp: new Date().toISOString()
        };
      }

      if (new Date() > qrRecord.expiresAt) {
        await this.logFraudAttempt(verificationToken, 'expired', scannerData);
        return {
          result: 'expired',
          message: 'QR code has expired',
          timestamp: new Date().toISOString()
        };
      }

      if (qrRecord.used) {
        await this.logFraudAttempt(verificationToken, 'already_used', scannerData);
        return {
          result: 'already_used',
          message: 'QR code already used',
          timestamp: new Date().toISOString()
        };
      }

      // Mark as used
      await this.db.collection('qrverifications').updateOne(
        { verificationToken },
        { $set: { used: true, usedAt: new Date(), scannerData } }
      );

      // Get ticket and event details
      const ticket = await this.getTicket(qrRecord.ticketId);
      const event = await this.getEvent(ticket.eventId);

      return {
        result: 'valid',
        message: 'Valid ticket verified',
        ticket: {
          token_id: ticket.tokenId,
          event_name: event.name,
          venue: event.venue,
          owner: ticket.ownerAddress
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error verifying QR code:', error);
      return {
        result: 'error',
        message: 'Verification failed',
        timestamp: new Date().toISOString()
      };
    }
  }

  async logFraudAttempt(token, reason, scannerData) {
    try {
      await this.db.collection('fraudalerts').insertOne({
        verificationToken: token,
        reason,
        scannerData,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Error logging fraud attempt:', error);
    }
  }

  // Transfer methods
  async createTransferRequest(ticketId, fromAddress, toAddress, price) {
    try {
      const transfer = {
        ticketId: new ObjectId(ticketId),
        fromAddress,
        toAddress,
        price,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await this.db.collection('transfers').insertOne(transfer);
      return { ...transfer, _id: result.insertedId };
    } catch (error) {
      console.error('Error creating transfer request:', error);
      throw error;
    }
  }

  async getPendingTransfers(walletAddress) {
    try {
      return await this.db.collection('transfers').find({
        toAddress: walletAddress,
        status: 'pending'
      }).toArray();
    } catch (error) {
      console.error('Error getting pending transfers:', error);
      return [];
    }
  }

  // System stats
  async getSystemStats() {
    try {
      const [totalUsers, totalTickets, activeEvents, pendingTransfers, fraudAlerts] = await Promise.all([
        this.db.collection('users').countDocuments(),
        this.db.collection('tickets').countDocuments(),
        this.db.collection('events').countDocuments(),
        this.db.collection('transfers').countDocuments({ status: 'pending' }),
        this.db.collection('fraudalerts').countDocuments()
      ]);

      return {
        totalUsers,
        totalTickets,
        activeEvents,
        pendingTransfers,
        fraudAlerts,
        databaseStatus: this.isConnected ? 'MongoDB Connected' : 'Disconnected'
      };
    } catch (error) {
      console.error('Error getting system stats:', error);
      return {
        totalUsers: 0,
        totalTickets: 0,
        activeEvents: 0,
        pendingTransfers: 0,
        fraudAlerts: 0,
        databaseStatus: 'Error'
      };
    }
  }

  // Utility methods
  generateSecureToken() {
    return require('crypto').randomBytes(32).toString('hex');
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
      console.log('🔄 MongoDB connection closed');
    }
  }
}

module.exports = FairPassMongoDB; 