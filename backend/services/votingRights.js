const { sql, poolPromise } = require("../db");

function normalizeWallet(address) {
  if (!address) return null;
  return address.toLowerCase();
}

async function addVotingRightSnapshots(blockchainElectionId, addresses, hasRight) {
  if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
    return;
  }

  const pool = await poolPromise;

  for (const addr of addresses) {
    const walletHash = normalizeWallet(addr);
    if (!walletHash) continue;

    const request = pool.request();
    await request
      .input("blockchainElectionId", sql.BigInt, Number(blockchainElectionId))
      .input("walletHash", sql.NVarChar(200), walletHash)
      .input("hasRight", sql.Bit, hasRight ? 1 : 0)
      .query(`
        INSERT INTO VotingRightSnapshots (BlockchainElectionId, WalletHash, HasRight)
        VALUES (@blockchainElectionId, @walletHash, @hasRight);
      `);
  }
}

async function addGrantedVotingRights(blockchainElectionId, addresses) {
  return addVotingRightSnapshots(blockchainElectionId, addresses, true);
}

async function addRevokedVotingRights(blockchainElectionId, addresses) {
  return addVotingRightSnapshots(blockchainElectionId, addresses, false);
}

module.exports = {
  addVotingRightSnapshots,
  addGrantedVotingRights,
  addRevokedVotingRights,
  normalizeWallet,
};
