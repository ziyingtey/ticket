const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FairPassTicket", function () {
  let fairPassTicket;
  let owner;
  let organizer;
  let buyer;
  let buyer2;

  beforeEach(async function () {
    // Get signers
    [owner, organizer, buyer, buyer2] = await ethers.getSigners();

    // Deploy contract
    const FairPassTicket = await ethers.getContractFactory("FairPassTicket");
    fairPassTicket = await FairPassTicket.deploy();
    await fairPassTicket.deployed();
  });

  describe("Event Creation", function () {
    it("Should create an event successfully", async function () {
      const eventDate = Math.floor(Date.now() / 1000) + 86400; // 1 day from now
      const ticketPrice = ethers.utils.parseEther("0.01");
      const maxResalePrice = ethers.utils.parseEther("0.02");

      await fairPassTicket.connect(organizer).createEvent(
        "Test Event",
        "Test Venue",
        eventDate,
        ticketPrice,
        100,
        maxResalePrice,
        true
      );

      const event = await fairPassTicket.getEvent(1);
      expect(event.name).to.equal("Test Event");
      expect(event.venue).to.equal("Test Venue");
      expect(event.organizer).to.equal(organizer.address);
      expect(event.isActive).to.be.true;
      expect(event.sustainabilityTracking).to.be.true;
    });

    it("Should reject events with past dates", async function () {
      const pastDate = Math.floor(Date.now() / 1000) - 86400; // 1 day ago
      const ticketPrice = ethers.utils.parseEther("0.01");
      const maxResalePrice = ethers.utils.parseEther("0.02");

      await expect(
        fairPassTicket.connect(organizer).createEvent(
          "Past Event",
          "Test Venue",
          pastDate,
          ticketPrice,
          100,
          maxResalePrice,
          true
        )
      ).to.be.revertedWith("Event date must be in the future");
    });
  });

  describe("Ticket Minting", function () {
    let eventId;
    let eventDate;
    let ticketPrice;

    beforeEach(async function () {
      eventDate = Math.floor(Date.now() / 1000) + 86400; // 1 day from now
      ticketPrice = ethers.utils.parseEther("0.01");
      const maxResalePrice = ethers.utils.parseEther("0.02");

      await fairPassTicket.connect(organizer).createEvent(
        "Test Event",
        "Test Venue",
        eventDate,
        ticketPrice,
        100,
        maxResalePrice,
        true
      );
      eventId = 1;
    });

    it("Should mint a ticket successfully", async function () {
      const tokenURI = "ipfs://QmTestHash";
      const didHash = "did:test:123";

      await fairPassTicket.connect(buyer).mintTicket(
        eventId,
        tokenURI,
        didHash,
        { value: ticketPrice }
      );

      const ticket = await fairPassTicket.getTicket(1);
      expect(ticket.eventId).to.equal(eventId);
      expect(ticket.originalBuyer).to.equal(buyer.address);
      expect(ticket.didVerification).to.equal(didHash);
      expect(ticket.isUsed).to.be.false;

      const tokenOwner = await fairPassTicket.ownerOf(1);
      expect(tokenOwner).to.equal(buyer.address);
    });

    it("Should reject insufficient payment", async function () {
      const tokenURI = "ipfs://QmTestHash";
      const didHash = "did:test:123";
      const insufficientPayment = ethers.utils.parseEther("0.005");

      await expect(
        fairPassTicket.connect(buyer).mintTicket(
          eventId,
          tokenURI,
          didHash,
          { value: insufficientPayment }
        )
      ).to.be.revertedWith("Insufficient payment");
    });

    it("Should track carbon offset for sustainability events", async function () {
      const tokenURI = "ipfs://QmTestHash";
      const didHash = "did:test:123";

      await fairPassTicket.connect(buyer).mintTicket(
        eventId,
        tokenURI,
        didHash,
        { value: ticketPrice }
      );

      const carbonOffset = await fairPassTicket.getCarbonOffset(eventId);
      expect(carbonOffset).to.equal(1);
    });

    it("Should prevent duplicate tickets for same event", async function () {
      const tokenURI = "ipfs://QmTestHash";
      const didHash = "did:test:123";

      await fairPassTicket.connect(buyer).mintTicket(
        eventId,
        tokenURI,
        didHash,
        { value: ticketPrice }
      );

      await expect(
        fairPassTicket.connect(buyer).mintTicket(
          eventId,
          tokenURI,
          didHash,
          { value: ticketPrice }
        )
      ).to.be.revertedWith("Already has ticket for this event");
    });
  });

  describe("Ticket Usage", function () {
    let eventId;
    let tokenId;
    let eventDate;

    beforeEach(async function () {
      eventDate = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const ticketPrice = ethers.utils.parseEther("0.01");
      const maxResalePrice = ethers.utils.parseEther("0.02");

      await fairPassTicket.connect(organizer).createEvent(
        "Test Event",
        "Test Venue",
        eventDate,
        ticketPrice,
        100,
        maxResalePrice,
        true
      );
      eventId = 1;

      await fairPassTicket.connect(buyer).mintTicket(
        eventId,
        "ipfs://QmTestHash",
        "did:test:123",
        { value: ticketPrice }
      );
      tokenId = 1;
    });

    it("Should allow ticket usage during event window", async function () {
      // Fast forward to event time
      await network.provider.send("evm_increaseTime", [3600]);
      await network.provider.send("evm_mine");

      await fairPassTicket.connect(buyer).useTicket(tokenId);

      const ticket = await fairPassTicket.getTicket(tokenId);
      expect(ticket.isUsed).to.be.true;
    });

    it("Should reject ticket usage by non-owner", async function () {
      await expect(
        fairPassTicket.connect(buyer2).useTicket(tokenId)
      ).to.be.revertedWith("Not ticket owner");
    });
  });

  describe("Anti-Scalping Protection", function () {
    let eventId;
    let tokenId;
    let ticketPrice;
    let maxResalePrice;

    beforeEach(async function () {
      const eventDate = Math.floor(Date.now() / 1000) + 86400; // 1 day from now
      ticketPrice = ethers.utils.parseEther("0.01");
      maxResalePrice = ethers.utils.parseEther("0.02");

      await fairPassTicket.connect(organizer).createEvent(
        "Test Event",
        "Test Venue",
        eventDate,
        ticketPrice,
        100,
        maxResalePrice,
        true
      );
      eventId = 1;

      await fairPassTicket.connect(buyer).mintTicket(
        eventId,
        "ipfs://QmTestHash",
        "did:test:123",
        { value: ticketPrice }
      );
      tokenId = 1;
    });

    it("Should allow resale within price limit", async function () {
      await fairPassTicket.connect(buyer).safeTransferWithPriceLimit(
        buyer.address,
        buyer2.address,
        tokenId,
        maxResalePrice,
        { value: maxResalePrice }
      );

      const newOwner = await fairPassTicket.ownerOf(tokenId);
      expect(newOwner).to.equal(buyer2.address);
    });

    it("Should reject resale above price limit", async function () {
      const excessivePrice = ethers.utils.parseEther("0.03");

      await expect(
        fairPassTicket.connect(buyer).safeTransferWithPriceLimit(
          buyer.address,
          buyer2.address,
          tokenId,
          excessivePrice,
          { value: excessivePrice }
        )
      ).to.be.revertedWith("Price exceeds maximum resale price");
    });
  });

  describe("Ticket Verification", function () {
    let eventId;
    let tokenId;

    beforeEach(async function () {
      const eventDate = Math.floor(Date.now() / 1000) + 86400; // 1 day from now
      const ticketPrice = ethers.utils.parseEther("0.01");
      const maxResalePrice = ethers.utils.parseEther("0.02");

      await fairPassTicket.connect(organizer).createEvent(
        "Test Event",
        "Test Venue",
        eventDate,
        ticketPrice,
        100,
        maxResalePrice,
        true
      );
      eventId = 1;

      await fairPassTicket.connect(buyer).mintTicket(
        eventId,
        "ipfs://QmTestHash",
        "did:test:123",
        { value: ticketPrice }
      );
      tokenId = 1;
    });

    it("Should verify valid ticket", async function () {
      const [exists, isValid, isUsed, verifiedEventId, owner] = 
        await fairPassTicket.verifyTicket(tokenId);

      expect(exists).to.be.true;
      expect(isValid).to.be.true;
      expect(isUsed).to.be.false;
      expect(verifiedEventId).to.equal(eventId);
      expect(owner).to.equal(buyer.address);
    });

    it("Should return false for non-existent ticket", async function () {
      const [exists] = await fairPassTicket.verifyTicket(999);
      expect(exists).to.be.false;
    });
  });

  describe("Event Management", function () {
    let eventId;

    beforeEach(async function () {
      const eventDate = Math.floor(Date.now() / 1000) + 86400; // 1 day from now
      const ticketPrice = ethers.utils.parseEther("0.01");
      const maxResalePrice = ethers.utils.parseEther("0.02");

      await fairPassTicket.connect(organizer).createEvent(
        "Test Event",
        "Test Venue",
        eventDate,
        ticketPrice,
        100,
        maxResalePrice,
        true
      );
      eventId = 1;
    });

    it("Should allow organizer to pause event", async function () {
      await fairPassTicket.connect(organizer).pauseEvent(eventId);

      const event = await fairPassTicket.getEvent(eventId);
      expect(event.isActive).to.be.false;
    });

    it("Should reject pause by non-organizer", async function () {
      await expect(
        fairPassTicket.connect(buyer).pauseEvent(eventId)
      ).to.be.revertedWith("Only organizer can pause");
    });
  });
}); 