// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

/**
 * @title FairPassTicket
 * @dev Enhanced NFT ticket system with anti-scalping and fairness mechanisms
 * Built for the Blockchain for Good Alliance hackathon
 * Implements SDG 10 (Reduced Inequality) and SDG 9 (Innovation)
 */
contract FairPassTicket is ERC721, ERC721URIStorage, ERC721Burnable, Ownable, Pausable, ReentrancyGuard {
    using Counters for Counters.Counter;

    Counters.Counter private _tokenIdCounter;

    // Event and Ticket Management
    struct Event {
        string name;
        string description;
        uint256 eventDate;
        uint256 originalPrice;
        uint256 maxSupply;
        uint256 currentSupply;
        address payable organizer;
        bool isActive;
        // Anti-scalping features
        uint256 maxResaleMultiplier; // e.g., 110 = 110% of original price
        uint256 royaltyPercentage;   // e.g., 10 = 10% to organizer
        uint256 maxTicketsPerUser;   // Anti-scalping: limit per wallet
        bool requiresVerification;   // DID verification required
    }

    struct Ticket {
        uint256 eventId;
        uint256 originalPrice;
        bool hasAttended;
        uint256 purchaseTimestamp;
        address originalBuyer;
    }

    // State variables
    mapping(uint256 => Event) public events;
    mapping(uint256 => Ticket) public tickets;
    mapping(uint256 => mapping(address => uint256)) public userTicketCount; // eventId => user => count
    mapping(address => bool) public verifiedUsers; // DID verification status
    
    uint256 private _eventIdCounter;
    uint256 public platformFee = 200; // 2% platform fee (200 basis points)
    address payable public platformWallet;

    // Events for tracking and analytics
    event EventCreated(uint256 indexed eventId, string name, address organizer, uint256 maxSupply);
    event TicketMinted(uint256 indexed tokenId, uint256 indexed eventId, address indexed buyer, uint256 price);
    event TicketResold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, uint256 royalty);
    event AttendanceMarked(uint256 indexed tokenId, uint256 indexed eventId, address indexed attendee);
    event UserVerified(address indexed user, bool verified);
    event FraudAlert(address indexed user, string reason, uint256 timestamp);

    constructor() ERC721("FairPass Ticket", "FAIR") {
        platformWallet = payable(msg.sender);
    }

    // ==============================================================================
    // EVENT MANAGEMENT (For Organizers)
    // ==============================================================================

    /**
     * @dev Create a new event with anti-scalping parameters
     * @param name Event name
     * @param description Event description  
     * @param eventDate Event timestamp
     * @param originalPrice Ticket price in wei
     * @param maxSupply Maximum tickets available
     * @param maxResaleMultiplier Maximum resale price (e.g., 110 = 110%)
     * @param royaltyPercentage Organizer royalty on resales (e.g., 10 = 10%)
     * @param maxTicketsPerUser Anti-scalping limit per wallet
     * @param requiresVerification Whether DID verification is required
     */
    function createEvent(
        string memory name,
        string memory description,
        uint256 eventDate,
        uint256 originalPrice,
        uint256 maxSupply,
        uint256 maxResaleMultiplier,
        uint256 royaltyPercentage,
        uint256 maxTicketsPerUser,
        bool requiresVerification
    ) public returns (uint256) {
        require(eventDate > block.timestamp, "Event date must be in the future");
        require(originalPrice > 0, "Price must be greater than 0");
        require(maxSupply > 0, "Max supply must be greater than 0");
        require(maxResaleMultiplier >= 100, "Resale multiplier must be at least 100%");
        require(royaltyPercentage <= 25, "Royalty cannot exceed 25%");
        require(maxTicketsPerUser > 0 && maxTicketsPerUser <= 10, "Invalid tickets per user limit");

        uint256 eventId = _eventIdCounter;
        _eventIdCounter++;

        events[eventId] = Event({
            name: name,
            description: description,
            eventDate: eventDate,
            originalPrice: originalPrice,
            maxSupply: maxSupply,
            currentSupply: 0,
            organizer: payable(msg.sender),
            isActive: true,
            maxResaleMultiplier: maxResaleMultiplier,
            royaltyPercentage: royaltyPercentage,
            maxTicketsPerUser: maxTicketsPerUser,
            requiresVerification: requiresVerification
        });

        emit EventCreated(eventId, name, msg.sender, maxSupply);
        return eventId;
    }

    // ==============================================================================
    // TICKET PURCHASING (Anti-Scalping Mechanisms)
    // ==============================================================================

    /**
     * @dev Purchase tickets with anti-scalping protection
     * @param eventId Event to purchase tickets for
     * @param quantity Number of tickets to purchase
     */
    function purchaseTickets(uint256 eventId, uint256 quantity) 
        public 
        payable 
        nonReentrant 
        whenNotPaused 
    {
        Event storage eventData = events[eventId];
        require(eventData.isActive, "Event is not active");
        require(block.timestamp < eventData.eventDate, "Event has already occurred");
        require(quantity > 0, "Quantity must be greater than 0");
        
        // Anti-scalping: Check user ticket limit
        require(
            userTicketCount[eventId][msg.sender] + quantity <= eventData.maxTicketsPerUser,
            "Exceeds maximum tickets per user"
        );
        
        // Supply check
        require(
            eventData.currentSupply + quantity <= eventData.maxSupply,
            "Not enough tickets available"
        );

        // DID verification check
        if (eventData.requiresVerification) {
            require(verifiedUsers[msg.sender], "User verification required");
        }

        // Payment verification
        uint256 totalPrice = eventData.originalPrice * quantity;
        uint256 platformFeeAmount = (totalPrice * platformFee) / 10000;
        require(msg.value >= totalPrice + platformFeeAmount, "Insufficient payment");

        // Mint tickets
        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = _tokenIdCounter.current();
            _tokenIdCounter.increment();

            tickets[tokenId] = Ticket({
                eventId: eventId,
                originalPrice: eventData.originalPrice,
                hasAttended: false,
                purchaseTimestamp: block.timestamp,
                originalBuyer: msg.sender
            });

            _safeMint(msg.sender, tokenId);
            
            emit TicketMinted(tokenId, eventId, msg.sender, eventData.originalPrice);
        }

        // Update counters
        eventData.currentSupply += quantity;
        userTicketCount[eventId][msg.sender] += quantity;

        // Distribute payments
        platformWallet.transfer(platformFeeAmount);
        eventData.organizer.transfer(totalPrice);

        // Refund excess payment
        if (msg.value > totalPrice + platformFeeAmount) {
            payable(msg.sender).transfer(msg.value - totalPrice - platformFeeAmount);
        }
    }

    // ==============================================================================
    // CONTROLLED RESALE (Price Caps + Royalties)
    // ==============================================================================

    /**
     * @dev Resell ticket with automatic price cap and royalty enforcement
     * @param tokenId Ticket to resell
     * @param buyerAddress Address of the buyer
     */
    function resellTicket(uint256 tokenId, address buyerAddress) 
        public 
        payable 
        nonReentrant 
        whenNotPaused 
    {
        require(_exists(tokenId), "Ticket does not exist");
        require(ownerOf(tokenId) == msg.sender, "Not the ticket owner");
        
        Ticket storage ticket = tickets[tokenId];
        Event storage eventData = events[ticket.eventId];
        
        require(block.timestamp < eventData.eventDate, "Cannot resell after event");
        require(eventData.isActive, "Event is not active");

        // Calculate maximum allowed resale price
        uint256 maxPrice = (ticket.originalPrice * eventData.maxResaleMultiplier) / 100;
        require(msg.value <= maxPrice, "Price exceeds maximum resale limit");
        require(msg.value > 0, "Invalid sale price");

        // Calculate royalty for organizer
        uint256 royalty = (msg.value * eventData.royaltyPercentage) / 100;
        uint256 platformFeeAmount = (msg.value * platformFee) / 10000;
        uint256 sellerAmount = msg.value - royalty - platformFeeAmount;

        // Verify buyer can purchase (anti-scalping)
        if (eventData.requiresVerification) {
            require(verifiedUsers[buyerAddress], "Buyer verification required");
        }
        require(
            userTicketCount[ticket.eventId][buyerAddress] < eventData.maxTicketsPerUser,
            "Buyer exceeds maximum tickets per user"
        );

        // Execute transfer
        _transfer(msg.sender, buyerAddress, tokenId);
        
        // Update user ticket counts
        userTicketCount[ticket.eventId][msg.sender]--;
        userTicketCount[ticket.eventId][buyerAddress]++;

        // Distribute payments
        eventData.organizer.transfer(royalty);
        platformWallet.transfer(platformFeeAmount);
        payable(msg.sender).transfer(sellerAmount);

        emit TicketResold(tokenId, msg.sender, buyerAddress, msg.value, royalty);
    }

    // ==============================================================================
    // ATTENDANCE VERIFICATION (Proof of Attendance NFTs)
    // ==============================================================================

    /**
     * @dev Mark attendance for a ticket (called by venue scanner)
     * @param tokenId Ticket being scanned
     */
    function markAttendance(uint256 tokenId) public {
        require(_exists(tokenId), "Ticket does not exist");
        
        Ticket storage ticket = tickets[tokenId];
        Event storage eventData = events[ticket.eventId];
        
        require(msg.sender == eventData.organizer || msg.sender == owner(), "Not authorized");
        require(!ticket.hasAttended, "Attendance already marked");
        require(block.timestamp >= eventData.eventDate - 3600, "Too early to check in"); // 1 hour before
        require(block.timestamp <= eventData.eventDate + 86400, "Event check-in period ended"); // 24 hours after

        ticket.hasAttended = true;
        
        emit AttendanceMarked(tokenId, ticket.eventId, ownerOf(tokenId));
    }

    // ==============================================================================
    // DID VERIFICATION (Identity Management)
    // ==============================================================================

    /**
     * @dev Verify user identity (integration point for DID systems)
     * @param user Address to verify
     * @param verified Verification status
     */
    function setUserVerification(address user, bool verified) public onlyOwner {
        verifiedUsers[user] = verified;
        emit UserVerified(user, verified);
    }

    /**
     * @dev Batch verify multiple users (for DID integrations)
     * @param users Array of addresses to verify
     * @param verifiedStatus Array of verification statuses
     */
    function batchVerifyUsers(address[] memory users, bool[] memory verifiedStatus) public onlyOwner {
        require(users.length == verifiedStatus.length, "Arrays length mismatch");
        
        for (uint256 i = 0; i < users.length; i++) {
            verifiedUsers[users[i]] = verifiedStatus[i];
            emit UserVerified(users[i], verifiedStatus[i]);
        }
    }

    // ==============================================================================
    // FRAUD PREVENTION
    // ==============================================================================

    /**
     * @dev Report suspicious activity
     * @param suspiciousUser Address to report
     * @param reason Reason for the report
     */
    function reportFraud(address suspiciousUser, string memory reason) public {
        emit FraudAlert(suspiciousUser, reason, block.timestamp);
    }

    // ==============================================================================
    // VIEW FUNCTIONS (For Frontend Integration)
    // ==============================================================================

    function getEvent(uint256 eventId) public view returns (Event memory) {
        return events[eventId];
    }

    function getTicket(uint256 tokenId) public view returns (Ticket memory) {
        return tickets[tokenId];
    }

    function getUserTicketCount(uint256 eventId, address user) public view returns (uint256) {
        return userTicketCount[eventId][user];
    }

    function isUserVerified(address user) public view returns (bool) {
        return verifiedUsers[user];
    }

    function getMaxResalePrice(uint256 tokenId) public view returns (uint256) {
        Ticket memory ticket = tickets[tokenId];
        Event memory eventData = events[ticket.eventId];
        return (ticket.originalPrice * eventData.maxResaleMultiplier) / 100;
    }

    // ==============================================================================
    // ADMIN FUNCTIONS
    // ==============================================================================

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function setPlatformFee(uint256 newFee) public onlyOwner {
        require(newFee <= 500, "Platform fee cannot exceed 5%");
        platformFee = newFee;
    }

    function setPlatformWallet(address payable newWallet) public onlyOwner {
        platformWallet = newWallet;
    }

    function deactivateEvent(uint256 eventId) public {
        Event storage eventData = events[eventId];
        require(msg.sender == eventData.organizer || msg.sender == owner(), "Not authorized");
        eventData.isActive = false;
    }

    // ==============================================================================
    // REQUIRED OVERRIDES
    // ==============================================================================

    function _burn(uint256 tokenId) internal override(ERC721, ERC721URIStorage) {
        super._burn(tokenId);
    }

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    // ==============================================================================
    // EMERGENCY FUNCTIONS
    // ==============================================================================

    /**
     * @dev Emergency withdraw (only for stuck funds)
     */
    function emergencyWithdraw() public onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
}
