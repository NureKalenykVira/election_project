const express = require("express");
const router = express.Router();
const { poolPromise, sql } = require("../db");

/**
 * GET /ml/anomalies
 *   /ml/anomalies
 *   /ml/anomalies?electionId=8
 *   /ml/anomalies?method=IsolationForest
 */
router.get("/anomalies", async (req, res) => {
  try {
    const electionId = req.query.electionId ? Number(req.query.electionId) : null;
    const method = req.query.method || null;

    const pool = await poolPromise;
    const request = pool.request();

    let where = "1 = 1";

    if (Number.isFinite(electionId)) {
      where += " AND a.BlockchainElectionId = @ElectionId";
      request.input("ElectionId", sql.BigInt, electionId);
    }

    if (method) {
      where += " AND f.Model = @Method";
      request.input("Method", sql.NVarChar(100), method);
    }

    const result = await request.query(`
      SELECT
        f.Id,
        f.Model               AS DetectionMethod,  -- щоб у JSON було detectionMethod
        f.Score,
        f.Label,
        f.Details,
        f.CreatedAt,
        f.AuditLogId,
        a.EventType,
        a.BlockchainElectionId,
        a.VoterAddress,
        a.CandidateId,
        a.TxHash,
        a.BlockNumber,
        a.ChainId,
        a.LogIndex,
        a.Payload,
        a.CreatedAt AS AuditCreatedAt
      FROM AnomalyFlags f
      JOIN AuditLog a ON a.Id = f.AuditLogId
      WHERE ${where}
      ORDER BY f.Id DESC;
    `);

    res.json(result.recordset);
  } catch (err) {
    console.error("GET /ml/anomalies error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /ml/anomalies
 * body:
 * {
 *   "items": [
 *     {
 *       "auditLogId": 15,
 *       "detectionMethod": "IsolationForest", // або "model"
 *       "score": 0.97,
 *       "label": "anomaly",
 *       "details": { ... }
 *     }
 *   ]
 * }
 */
router.post("/anomalies", async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0) {
      return res.status(400).json({ error: "items[] is required" });
    }

    const pool = await poolPromise;
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      for (const item of items) {
        const {
          auditLogId,
          detectionMethod,
          model,
          score,
          label,
          details,
        } = item;

        const method = detectionMethod || model; // підтримуємо обидві назви
        if (!auditLogId || !method || !label) {
          throw new Error("auditLogId, detectionMethod/model and label are required for each item");
        }

        const r = new sql.Request(tx);
        r.input("AuditLogId", sql.BigInt, auditLogId);
        r.input("Model", sql.NVarChar(100), method);
        r.input("Score", sql.Float, score ?? null);
        r.input("Label", sql.NVarChar(50), label);
        r.input("Details", sql.NVarChar(sql.MAX), details ? JSON.stringify(details) : null);

        await r.query(`
          INSERT INTO AnomalyFlags (
            AuditLogId, Model, Score, Label, Details
          )
          VALUES (
            @AuditLogId, @Model, @Score, @Label, @Details
          );
        `);
      }

      await tx.commit();
      res.status(201).json({ inserted: items.length });
    } catch (err) {
      await tx.rollback();
      console.error("POST /ml/anomalies tx error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  } catch (err) {
    console.error("POST /ml/anomalies error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
