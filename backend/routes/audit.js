const express = require("express");
const router = express.Router();
const { poolPromise, sql } = require("../db");

// GET /audit?limit=100
router.get("/", async (req, res) => {
  try {
    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 100;

    const pool = await poolPromise;
    const request = pool.request();
    request.input("Limit", sql.Int, limit);

    const result = await request.query(`
      SELECT TOP (@Limit)
        Id,
        EventType,
        BlockchainElectionId,
        VoterAddress,
        CandidateId,
        TxHash,
        BlockNumber,
        ChainId,
        LogIndex,
        Payload,
        CreatedAt
      FROM AuditLog
      ORDER BY Id DESC;
    `);

    res.json(result.recordset);
  } catch (err) {
    console.error("GET /audit error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /audit/election/8 
router.get("/election/:electionId", async (req, res) => {
  try {
    const electionId = Number(req.params.electionId);
    if (!Number.isFinite(electionId)) {
      return res.status(400).json({ error: "Invalid electionId" });
    }

    const pool = await poolPromise;
    const request = pool.request();
    request.input("ElectionId", sql.BigInt, electionId);

    const result = await request.query(`
      SELECT
        Id,
        EventType,
        BlockchainElectionId,
        VoterAddress,
        CandidateId,
        TxHash,
        BlockNumber,
        ChainId,
        LogIndex,
        Payload,
        CreatedAt
      FROM AuditLog
      WHERE BlockchainElectionId = @ElectionId
      ORDER BY Id DESC;
    `);

    res.json(result.recordset);
  } catch (err) {
    console.error("GET /audit/election/:electionId error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /audit/export 
router.get("/export", async (req, res) => {
  try {
    const pool = await poolPromise;
    const request = pool.request();

    const result = await request.query(`
      SELECT
        Id,
        EventType,
        BlockchainElectionId,
        VoterAddress,
        CandidateId,
        TxHash,
        BlockNumber,
        ChainId,
        LogIndex,
        Payload,
        CreatedAt
      FROM AuditLog
      ORDER BY Id ASC;
    `);

    res.json({
      count: result.recordset.length,
      items: result.recordset,
    });
  } catch (err) {
    console.error("GET /audit/export error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
