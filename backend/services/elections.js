const crypto = require("crypto");
const { poolPromise, sql } = require("../db");

async function createOffchainElection({
  blockchainElectionId,
  organizerUserId,
  name,
  startTime,
  commitDeadline,
  revealDeadline,
  gatingEnabled,
}) {
  const pool = await poolPromise;
  const r = pool.request();

  console.log("DEBUG createOffchainElection params:", {
    blockchainElectionId,
    organizerUserId,
    name,
  });

  r.input("BlockchainElectionId", sql.BigInt, Number(blockchainElectionId));
  r.input("OrganizerUserId", sql.Int, Number(organizerUserId)); // 👈 важливо: int
  r.input("Name", sql.NVarChar(400), name);
  r.input("StartTimeUnix", sql.BigInt, Number(startTime));
  r.input("CommitDeadlineUnix", sql.BigInt, Number(commitDeadline));
  r.input("RevealDeadlineUnix", sql.BigInt, Number(revealDeadline));
  r.input("GatingEnabled", sql.Bit, gatingEnabled ? 1 : 0);

  const result = await r.query(`
    INSERT INTO dbo.Elections (
      BlockchainElectionId,
      OrganizerUserId,
      Name,
      StartTimeUnix,
      CommitDeadlineUnix,
      RevealDeadlineUnix,
      GatingEnabled
    )
    VALUES (
      @BlockchainElectionId,
      @OrganizerUserId,
      @Name,
      @StartTimeUnix,
      @CommitDeadlineUnix,
      @RevealDeadlineUnix,
      @GatingEnabled
    );

    SELECT TOP 1
      Id,
      BlockchainElectionId,
      OrganizerUserId,
      Name
    FROM dbo.Elections
    WHERE BlockchainElectionId = @BlockchainElectionId
    ORDER BY Id DESC;
  `);

  return result.recordset[0];
}

async function userOwnsElection(organizerUserId, blockchainElectionId) {
  const pool = await poolPromise;
  const r = pool.request();

  r.input("OrganizerUserId", sql.Int, Number(organizerUserId));
  r.input("BlockchainElectionId", sql.BigInt, Number(blockchainElectionId));

  const result = await r.query(`
    SELECT TOP 1 Id
    FROM dbo.Elections
    WHERE OrganizerUserId = @OrganizerUserId
      AND BlockchainElectionId = @BlockchainElectionId;
  `);

  return result.recordset.length > 0;
}

async function getElectionsForOrganizer(organizerUserId) {
  const pool = await poolPromise;
  const r = pool.request();

  r.input("OrganizerUserId", sql.Int, Number(organizerUserId));

  const result = await r.query(`
    SELECT
      Id,
      BlockchainElectionId,
      OrganizerUserId,
      Name,
      StartTimeUnix,
      CommitDeadlineUnix,
      RevealDeadlineUnix,
      Finalized,
      GatingEnabled,
      CreatedAt,
      UpdatedAt
    FROM dbo.Elections
    WHERE OrganizerUserId = @OrganizerUserId
    ORDER BY CreatedAt DESC;
  `);

  return result.recordset;
}

function hashWallet(address) {
  if (!address) return null;
  return crypto
    .createHash("sha256")
    .update(address.toLowerCase())
    .digest("hex");
}

async function getElectionsForVoter(walletAddress) {
  if (!walletAddress) {
    return [];
  }

  const walletHash = hashWallet(walletAddress);

  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("walletHash", sql.NVarChar(128), walletHash)
    .query(`
      SELECT DISTINCT e.*
      FROM dbo.Elections e
      INNER JOIN dbo.VotingRightSnapshots v
        ON v.BlockchainElectionId = e.BlockchainElectionId
      WHERE v.WalletHash = @walletHash
        AND v.HasRight = 1
      ORDER BY e.StartTimeUnix DESC;
    `);

  return result.recordset;
}

module.exports = {
  createOffchainElection,
  userOwnsElection,
  getElectionsForOrganizer,
  getElectionsForVoter,
};
