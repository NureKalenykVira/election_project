// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ElectionManager.sol";

contract MockVotingRightToken is IVotingRightToken {
    // electionId => (voter => hasRight)
    mapping(uint256 => mapping(address => bool)) public rights;

    function setRight(address account, uint256 electionId, bool value) external {
        rights[electionId][account] = value;
    }

    function hasRight(address account, uint256 electionId)
        external
        view
        override
        returns (bool)
    {
        return rights[electionId][account];
    }
}
