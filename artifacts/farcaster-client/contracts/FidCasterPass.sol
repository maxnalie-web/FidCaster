// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * FidCasterPass — ERC-721 access pass. Free mint (server pays gas). Unlimited supply.
 */

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
}

contract FidCasterPass {
    string public name     = "FidCaster Pass";
    string public symbol   = "FCPASS";

    address public owner;
    uint256 private _totalSupply;
    string  private _baseTokenURI;
    bool    public  mintingEnabled = true;

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed tokenOwner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed tokenOwner, address indexed operator, bool approved);
    event OwnershipTransferred(address indexed prev, address indexed next);

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }

    constructor(address _owner, string memory baseURI) {
        owner = _owner;
        _baseTokenURI = baseURI;
        emit OwnershipTransferred(address(0), _owner);
    }

    // ERC-165
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x80ac58cd   // ERC721
            || id == 0x5b5e139f   // ERC721Metadata
            || id == 0x01ffc9a7;  // ERC165
    }

    // ERC-721 Metadata
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(_owners[tokenId] != address(0), "Nonexistent token");
        return string(abi.encodePacked(_baseTokenURI, _str(tokenId)));
    }

    // ERC-721 core
    function balanceOf(address addr) external view returns (uint256) {
        require(addr != address(0), "Zero address");
        return _balances[addr];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address o = _owners[tokenId];
        require(o != address(0), "Nonexistent token");
        return o;
    }

    function approve(address to, uint256 tokenId) external {
        address o = ownerOf(tokenId);
        require(msg.sender == o || _operatorApprovals[o][msg.sender], "Not authorized");
        _tokenApprovals[tokenId] = to;
        emit Approval(o, to, tokenId);
    }

    function getApproved(uint256 tokenId) public view returns (address) {
        require(_owners[tokenId] != address(0), "Nonexistent token");
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address o, address operator) public view returns (bool) {
        return _operatorApprovals[o][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(_isApprovedOrOwner(msg.sender, tokenId), "Not authorized");
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        _safeTransfer(from, to, tokenId, bytes(""));
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external {
        _transfer(from, to, tokenId);
        _checkReceiver(msg.sender, from, to, tokenId, data);
    }

    // Mint — server wallet calls this on behalf of users
    function mint(address to) external returns (uint256) {
        require(mintingEnabled, "Minting disabled");
        require(to != address(0), "Zero address");
        uint256 tokenId = _totalSupply++;
        _owners[tokenId] = to;
        unchecked { _balances[to]++; }
        emit Transfer(address(0), to, tokenId);
        return tokenId;
    }

    function totalSupply() external view returns (uint256) { return _totalSupply; }

    // Admin
    function setBaseURI(string calldata newURI) external onlyOwner { _baseTokenURI = newURI; }
    function setMintingEnabled(bool v) external onlyOwner { mintingEnabled = v; }
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // Internal
    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view returns (bool) {
        address o = ownerOf(tokenId);
        return spender == o || isApprovedForAll(o, spender) || getApproved(tokenId) == spender;
    }

    function _transfer(address from, address to, uint256 tokenId) internal {
        require(ownerOf(tokenId) == from, "Wrong owner");
        require(to != address(0), "Zero address");
        delete _tokenApprovals[tokenId];
        unchecked { _balances[from]--; _balances[to]++; }
        _owners[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function _safeTransfer(address from, address to, uint256 tokenId, bytes memory data) internal {
        _transfer(from, to, tokenId);
        _checkReceiver(msg.sender, from, to, tokenId, data);
    }

    function _checkReceiver(address operator, address from, address to, uint256 tokenId, bytes memory data) internal {
        if (to.code.length > 0) {
            try IERC721Receiver(to).onERC721Received(operator, from, tokenId, data) returns (bytes4 ret) {
                require(ret == IERC721Receiver.onERC721Received.selector, "Unsafe receiver");
            } catch { revert("Receiver rejected"); }
        }
    }

    function _str(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 t = v; uint256 d;
        while (t != 0) { d++; t /= 10; }
        bytes memory b = new bytes(d);
        while (v != 0) { d--; b[d] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(b);
    }
}
