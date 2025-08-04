// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

contract FairPassTicket is ERC721, ERC721URIStorage, Ownable, ReentrancyGuard {
    using Counters for Counters.Counter;
    
    Counters.Counter private _tokenIds;
    Counters.Counter private _eventIds;
    
    struct Event {
        uint256 id;
        string name;
        string venue;
        uint256 eventDate;
        uint256 ticketPrice;
        uint256 maxTickets;
        uint256 ticketsSold;
        uint256 maxResalePrice;
        bool requiresDID;
        address organizer;
        bool isActive;
        uint256 sustainabilityTracking; // CO2 offset in grams
    }
    
    struct Ticket {
        uint256 eventId;
        address originalBuyer;
        uint256 purchasePrice;
        bool isUsed;
        uint256 purchaseTimestamp;
        string didVerification;
    }
    
    // Mappings
    mapping(uint256 => Event) public events;
    mapping(uint256 => Ticket) public tickets;
    mapping(uint256 => bool) public eventExists;
    mapping(address => mapping(uint256 => uint256)) public ticketCountForEvent; // address => eventId => count
    mapping(address => uint256[]) public userTickets; // user's ticket IDs
    
    // Events
    event EventCreated(uint256 indexed eventId, string name, address indexed organizer);
    event TicketMinted(uint256 indexed tokenId, uint256 indexed eventId, address indexed buyer, string did);
    event TicketUsed(uint256 indexed tokenId, uint256 indexed eventId);
    event TicketResold(uint256 indexed tokenId, address indexed from, address indexed to, uint256 price);
    
    constructor() ERC721("FairPass Ticket", "FAIRPASS") {}

    function _burn(uint256 tokenId) internal override(ERC721, ERC721URIStorage) {
        super._burn(tokenId);
    }

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
    
    /**
     * @dev Create a new event
     */
    function createEvent(
        string memory _name,
        string memory _venue,
        uint256 _eventDate,
        uint256 _ticketPrice,
        uint256 _maxTickets,
        uint256 _maxResalePrice,
        bool _requiresDID,
        uint256 _sustainabilityTracking
    ) external returns (uint256) {
        require(_eventDate > block.timestamp, "Event date must be in the future");
        require(_maxTickets > 0, "Max tickets must be greater than 0");
        require(_maxResalePrice >= _ticketPrice, "Max resale price must be >= ticket price");
        
        _eventIds.increment();
        uint256 eventId = _eventIds.current();
        
        events[eventId] = Event({
            id: eventId,
            name: _name,
            venue: _venue,
            eventDate: _eventDate,
            ticketPrice: _ticketPrice,
            maxTickets: _maxTickets,
            ticketsSold: 0,
            organizer: msg.sender,
            isActive: true,
            requiresDID: _requiresDID,
            maxResalePrice: _maxResalePrice,
            sustainabilityTracking: _sustainabilityTracking
        });
        
        eventExists[eventId] = true;
        
        emit EventCreated(eventId, _name, msg.sender);
        return eventId;
    }
    
    /**
     * @dev Mint tickets for an event with DID verification (supports multiple tickets)
     */
    function mintTickets(
        uint256 _eventId,
        uint256 _quantity,
        string memory _tokenURI,
        string memory _didHash
    ) external payable nonReentrant returns (uint256[] memory) {
        require(eventExists[_eventId], "Event does not exist");
        require(events[_eventId].isActive, "Event is not active");
        require(_quantity > 0 && _quantity <= 10, "Quantity must be 1-10"); // Limit per transaction
        require(events[_eventId].ticketsSold + _quantity <= events[_eventId].maxTickets, "Not enough tickets available");
        require(msg.value >= events[_eventId].ticketPrice * _quantity, "Insufficient payment");
        require(events[_eventId].eventDate > block.timestamp, "Event has already occurred");
        
        uint256[] memory tokenIds = new uint256[](_quantity);
        
        for (uint256 i = 0; i < _quantity; i++) {
            _tokenIds.increment();
            uint256 tokenId = _tokenIds.current();
            tokenIds[i] = tokenId;
            
            _safeMint(msg.sender, tokenId);
            _setTokenURI(tokenId, _tokenURI);
            
            tickets[tokenId] = Ticket({
                eventId: _eventId,
                originalBuyer: msg.sender,
                purchasePrice: events[_eventId].ticketPrice,
                isUsed: false,
                purchaseTimestamp: block.timestamp,
                didVerification: _didHash
            });
            
            userTickets[msg.sender].push(tokenId);
            
            emit TicketMinted(tokenId, _eventId, msg.sender, _didHash);
        }
        
        events[_eventId].ticketsSold += _quantity;
        ticketCountForEvent[msg.sender][_eventId] += _quantity;
        
        return tokenIds;
    }
    
    /**
     * @dev Legacy single ticket mint function (for backward compatibility)
     */
    function mintTicket(
        uint256 _eventId,
        string memory _tokenURI,
        string memory _didHash
    ) external payable nonReentrant returns (uint256) {
        uint256[] memory tokenIds = this.mintTickets{value: msg.value}(_eventId, 1, _tokenURI, _didHash);
        return tokenIds[0];
    }
    
    /**
     * @dev Use a ticket at the event
     */
    function useTicket(uint256 _tokenId) external {
        require(_exists(_tokenId), "Ticket does not exist");
        require(ownerOf(_tokenId) == msg.sender, "Not ticket owner");
        require(!tickets[_tokenId].isUsed, "Ticket already used");
        
        uint256 eventId = tickets[_tokenId].eventId;
        require(events[eventId].isActive, "Event is not active");
        
        // Allow ticket usage 1 hour before event start
        require(
            block.timestamp >= (events[eventId].eventDate - 1 hours) &&
            block.timestamp <= (events[eventId].eventDate + 6 hours),
            "Ticket can only be used during event window"
        );
        
        tickets[_tokenId].isUsed = true;
        emit TicketUsed(_tokenId, eventId);
    }
    
    /**
     * @dev Safe transfer with anti-scalping protection
     */
    function safeTransferWithPriceLimit(
        address from,
        address to,
        uint256 tokenId,
        uint256 price
    ) external payable nonReentrant {
        require(_exists(tokenId), "Ticket does not exist");
        require(ownerOf(tokenId) == from, "Not ticket owner");
        require(from == msg.sender || getApproved(tokenId) == msg.sender, "Not authorized");
        require(!tickets[tokenId].isUsed, "Cannot transfer used ticket");
        
        uint256 eventId = tickets[tokenId].eventId;
        require(price <= events[eventId].maxResalePrice, "Price exceeds maximum resale price");
        require(msg.value >= price, "Insufficient payment");
        
        // Transfer ticket
        _safeTransfer(from, to, tokenId, "");
        
        // Update mappings
        ticketCountForEvent[from][eventId]--;
        ticketCountForEvent[to][eventId]++;
        
        // Update user tickets arrays
        _removeTicketFromUser(from, tokenId);
        userTickets[to].push(tokenId);
        
        // Handle payment
        if (price > 0) {
            payable(from).transfer(price);
            if (msg.value > price) {
                payable(msg.sender).transfer(msg.value - price);
            }
        }
        
        emit TicketResold(tokenId, from, to, price);
    }
    
    /**
     * @dev Helper function to remove ticket from user's array
     */
    function _removeTicketFromUser(address user, uint256 tokenId) internal {
        uint256[] storage tickets_array = userTickets[user];
        for (uint256 i = 0; i < tickets_array.length; i++) {
            if (tickets_array[i] == tokenId) {
                tickets_array[i] = tickets_array[tickets_array.length - 1];
                tickets_array.pop();
                break;
            }
        }
    }
    
    /**
     * @dev Get user's tickets for an event
     */
    function getUserTicketsForEvent(address user, uint256 eventId) external view returns (uint256[] memory) {
        uint256[] memory allUserTickets = userTickets[user];
        uint256 count = 0;
        
        // Count tickets for this event
        for (uint256 i = 0; i < allUserTickets.length; i++) {
            if (tickets[allUserTickets[i]].eventId == eventId) {
                count++;
            }
        }
        
        // Create result array
        uint256[] memory eventTickets = new uint256[](count);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allUserTickets.length; i++) {
            if (tickets[allUserTickets[i]].eventId == eventId) {
                eventTickets[index] = allUserTickets[i];
                index++;
            }
        }
        
        return eventTickets;
    }
    
    /**
     * @dev Get all user's tickets
     */
    function getUserTickets(address user) external view returns (uint256[] memory) {
        return userTickets[user];
    }
    
    /**
     * @dev Get event details
     */
    function getEvent(uint256 _eventId) external view returns (Event memory) {
        require(eventExists[_eventId], "Event does not exist");
        return events[_eventId];
    }
    
    /**
     * @dev Get ticket details
     */
    function getTicket(uint256 _tokenId) external view returns (Ticket memory) {
        require(_exists(_tokenId), "Ticket does not exist");
        return tickets[_tokenId];
    }
    
    /**
     * @dev Verify ticket authenticity and status
     */
    function verifyTicket(uint256 _tokenId) external view returns (
        bool exists,
        bool isValid,
        bool isUsed,
        uint256 eventId,
        address owner
    ) {
        exists = _exists(_tokenId);
        if (exists) {
            isValid = !tickets[_tokenId].isUsed && events[tickets[_tokenId].eventId].isActive;
            isUsed = tickets[_tokenId].isUsed;
            eventId = tickets[_tokenId].eventId;
            owner = ownerOf(_tokenId);
        }
    }
    
    /**
     * @dev Get total CO2 offset for sustainability tracking
     */
    function getTotalCO2Offset() external view returns (uint256) {
        uint256 totalOffset = 0;
        for (uint256 i = 1; i <= _eventIds.current(); i++) {
            if (eventExists[i]) {
                totalOffset += events[i].sustainabilityTracking * events[i].ticketsSold;
            }
        }
        return totalOffset;
    }
}
