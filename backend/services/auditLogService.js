const { sql, poolPromise } = require("../db");

// Запис події в AuditLog
async function logEvent({
  eventType,
  blockchainElectionId = null,
  voterAddress = null,
  candidateId = null,
  txHash,
  blockNumber,
  chainId = null,
  logIndex = null,
  payload = null, // JSON 
}) {
  const pool = await poolPromise;
  const request = pool.request();

  request.input("EventType", sql.NVarChar(50), eventType);
  request.input("BlockchainElectionId", sql.BigInt, blockchainElectionId);
  request.input("VoterAddress", sql.VarChar(42), voterAddress);
  request.input("CandidateId", sql.BigInt, candidateId);
  request.input("TxHash", sql.VarChar(66), txHash);
  request.input("BlockNumber", sql.BigInt, blockNumber);
  request.input("ChainId", sql.Int, chainId);
  request.input("LogIndex", sql.Int, logIndex);
  request.input("Payload", sql.NVarChar(sql.MAX), payload);

  await request.query(`
    INSERT INTO AuditLog (
      EventType,
      BlockchainElectionId,
      VoterAddress,
      CandidateId,
      TxHash,
      BlockNumber,
      ChainId,
      LogIndex,
      Payload
    )
    VALUES (
      @EventType,
      @BlockchainElectionId,
      @VoterAddress,
      @CandidateId,
      @TxHash,
      @BlockNumber,
      @ChainId,
      @LogIndex,
      @Payload
    );
  `);
}

// Отримати всі логи (з обмеженням)
async function getLogs(limit = 500) {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("Limit", sql.Int, limit)
    .query(`
      SELECT TOP (@Limit) *
      FROM AuditLog
      ORDER BY Id DESC;
    `);
  return result.recordset;
}

// Логи по конкретних виборах
async function getLogsByElection(blockchainElectionId, limit = 500) {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("ElectionId", sql.BigInt, blockchainElectionId)
    .input("Limit", sql.Int, limit)
    .query(`
      SELECT TOP (@Limit) *
      FROM AuditLog
      WHERE BlockchainElectionId = @ElectionId
      ORDER BY Id DESC;
    `);
  return result.recordset;
}

module.exports = {
  logEvent,
  getLogs,
  getLogsByElection,
};
