// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IVotingRightToken {
    function hasRight(address account, uint256 electionId) external view returns (bool);
}

contract ElectionManager {
    struct Election {
        string name;
        uint64 startTime;
        uint64 commitDeadline;
        uint64 revealDeadline;
        bool finalized;
        uint256[] candidateIds;
        bool gatingEnabled;
    }

    IVotingRightToken public votingToken;
    uint256 public electionsCount;

    mapping(uint256 => Election) public elections;
    mapping(uint256 => mapping(address => bytes32)) public commits;
    mapping(uint256 => mapping(address => bool)) public revealed;
    mapping(uint256 => mapping(uint256 => uint256)) public tally;

    event ElectionCreated(
        uint256 indexed id,
        string name,
        uint64 startTime,
        uint64 commitDeadline,
        uint64 revealDeadline,
        uint256[] candidateIds,
        bool gatingEnabled
    );

    event VoteCommitted(uint256 indexed id, address indexed voter, bytes32 commitHash);
    event VoteRevealed(uint256 indexed id, address indexed voter, uint256 candidateId);
    event ElectionFinalized(uint256 indexed id);

    constructor(address votingToken_) {
        votingToken = IVotingRightToken(votingToken_);
    }

    function createElection(
        string memory name,
        uint64 startTime,
        uint64 commitDeadline,
        uint64 revealDeadline,
        uint256[] memory candidateIds,
        bool gatingEnabled
    ) external returns (uint256 id) {
        require(bytes(name).length > 0, "Empty name");
        require(candidateIds.length > 0, "No candidates");
        require(startTime < commitDeadline, "Times order");
        require(commitDeadline < revealDeadline, "Times order");

        id = ++electionsCount;

        Election storage e = elections[id];
        e.name = name;
        e.startTime = startTime;
        e.commitDeadline = commitDeadline;
        e.revealDeadline = revealDeadline;
        e.candidateIds = candidateIds;
        e.gatingEnabled = gatingEnabled;

        emit ElectionCreated(
            id,
            name,
            startTime,
            commitDeadline,
            revealDeadline,
            candidateIds,
            gatingEnabled
        );
    }

    function commitVote(uint256 id, bytes32 commitHash) external {
        Election storage e = elections[id];
        require(bytes(e.name).length > 0, "No election");
        require(block.timestamp >= e.startTime, "Too early");
        require(block.timestamp <= e.commitDeadline, "Commit phase over");
        require(commits[id][msg.sender] == 0, "Already committed");
        if (e.gatingEnabled) {
            require(votingToken.hasRight(msg.sender, id), "No voting right");
        }
        require(commitHash != bytes32(0), "Empty commit");

        commits[id][msg.sender] = commitHash;
        emit VoteCommitted(id, msg.sender, commitHash);
    }

    function revealVote(
        uint256 id,
        uint256 candidateId,
        bytes32 salt
    ) external {
        Election storage e = elections[id];
        require(bytes(e.name).length > 0, "No election");
        require(block.timestamp > e.commitDeadline, "Commit phase");
        require(block.timestamp <= e.revealDeadline, "Reveal phase over");

        bytes32 storedCommit = commits[id][msg.sender];
        require(storedCommit != bytes32(0), "No commit");
        require(!revealed[id][msg.sender], "Already revealed");

        bytes32 computed = keccak256(abi.encode(candidateId, salt));
        require(computed == storedCommit, "Invalid reveal");

        tally[id][candidateId] += 1;
        revealed[id][msg.sender] = true;

        emit VoteRevealed(id, msg.sender, candidateId);
    }

    function finalize(uint256 id) external {
        Election storage e = elections[id];
        require(bytes(e.name).length > 0, "No election");
        require(block.timestamp > e.revealDeadline, "Reveal not over");
        require(!e.finalized, "Already finalized");

        e.finalized = true;
        emit ElectionFinalized(id);
    }

    function getCandidateIds(uint256 id) external view returns (uint256[] memory) {
        return elections[id].candidateIds;
    }

    function getTimes(uint256 id)
        external
        view
        returns (uint64 startTime, uint64 commitDeadline, uint64 revealDeadline, bool finalized)
    {
        Election storage e = elections[id];
        return (e.startTime, e.commitDeadline, e.revealDeadline, e.finalized);
    }

    function getTally(uint256 id, uint256 candidateId) external view returns (uint256) {
        return tally[id][candidateId];
    }
}