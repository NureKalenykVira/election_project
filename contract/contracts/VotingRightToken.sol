// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract VotingRightToken is ERC1155, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    event VotingRightGranted(uint256 indexed electionId, address indexed account);
    event VotingRightRevoked(uint256 indexed electionId, address indexed account);

    constructor() ERC1155("") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function grantBatch(uint256 electionId, address[] calldata accounts)
        external
        onlyRole(MINTER_ROLE)
    {
        uint256 length = accounts.length;
        require(length > 0, "No accounts");

        for (uint256 i = 0; i < length; i++) {
            address account = accounts[i];
            if (balanceOf(account, electionId) == 0) {
                _mint(account, electionId, 1, "");
                emit VotingRightGranted(electionId, account);
            }
        }
    }

    function revokeBatch(uint256 electionId, address[] calldata accounts)
        external
        onlyRole(MINTER_ROLE)
    {
        uint256 length = accounts.length;
        require(length > 0, "No accounts");

        for (uint256 i = 0; i < length; i++) {
            address account = accounts[i];
            if (balanceOf(account, electionId) > 0) {
                _burn(account, electionId, 1);
                emit VotingRightRevoked(electionId, account);
            }
        }
    }

    function hasRight(address account, uint256 electionId) external view returns (bool) {
        return balanceOf(account, electionId) > 0;
    }

    function setApprovalForAll(address, bool) public pure override {
        revert("SBT: approvals disabled");
    }

    function safeTransferFrom(
        address,
        address,
        uint256,
        uint256,
        bytes memory
    ) public pure override {
        revert("SBT: transfer disabled");
    }

    function safeBatchTransferFrom(
        address,
        address,
        uint256[] memory,
        uint256[] memory,
        bytes memory
    ) public pure override {
        revert("SBT: transfer disabled");
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}