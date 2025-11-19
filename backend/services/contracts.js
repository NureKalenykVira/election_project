const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const electionManagerAbi = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../abi/ElectionManager.json"), "utf8")
).abi;

const votingRightTokenAbi = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../abi/VotingRightToken.json"), "utf8")
).abi;

const electionManager = new ethers.Contract(
    process.env.ELECTION_MANAGER_ADDRESS,
    electionManagerAbi,
    wallet
);

const votingRightToken = new ethers.Contract(
    process.env.VOTING_TOKEN_ADDRESS,
    votingRightTokenAbi,
    wallet
);

module.exports = {
    provider,
    wallet,
    electionManager,
    votingRightToken,
};