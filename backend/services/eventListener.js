const { electionManager } = require("./contracts");
const { logEvent } = require("./auditLogService");
const { poolPromise, sql } = require("../db");

const ENABLE_ML_AUTO =
  process.env.ENABLE_ML_AUTO === "true" ||
  process.env.ENABLE_ML_AUTO === "1";

let runAllAnalyses = null;
try {
  ({ runAllAnalyses } = require("./mlRunner"));
} catch (e) {
  console.warn("[ML] mlRunner not found, automatic analyses disabled:", e.message);
}

async function upsertElectionFromEvent(args) {
  const {
    id,
    name,
    startTime,
    commitDeadline,
    revealDeadline,
    candidateIds,
    gatingEnabled,
  } = args;

  const blockchainElectionId = Number(id);

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    const request = new sql.Request(tx);

    request.input("BlockchainElectionId", sql.BigInt, blockchainElectionId);
    request.input("Name", sql.NVarChar(200), name);
    request.input("StartTimeUnix", sql.BigInt, Number(startTime));
    request.input("CommitDeadlineUnix", sql.BigInt, Number(commitDeadline));
    request.input("RevealDeadlineUnix", sql.BigInt, Number(revealDeadline));
    request.input("GatingEnabled", sql.Bit, gatingEnabled);

    await request.query(`
      IF NOT EXISTS (
        SELECT 1 FROM Elections WHERE BlockchainElectionId = @BlockchainElectionId
      )
      BEGIN
        INSERT INTO Elections (
          BlockchainElectionId, Name,
          StartTimeUnix, CommitDeadlineUnix, RevealDeadlineUnix,
          GatingEnabled
        )
        VALUES (
          @BlockchainElectionId, @Name,
          @StartTimeUnix, @CommitDeadlineUnix, @RevealDeadlineUnix,
          @GatingEnabled
        );
      END
    `);

    const requestDel = new sql.Request(tx);
    requestDel.input("BlockchainElectionId", sql.BigInt, blockchainElectionId);
    await requestDel.query(`
      DELETE FROM Candidates
      WHERE ElectionId IN (
        SELECT Id FROM Elections WHERE BlockchainElectionId = @BlockchainElectionId
      );
    `);

    const requestSel = new sql.Request(tx);
    requestSel.input("BlockchainElectionId", sql.BigInt, blockchainElectionId);
    const res = await requestSel.query(`
      SELECT Id FROM Elections WHERE BlockchainElectionId = @BlockchainElectionId;
    `);
    const electionRow = res.recordset[0];
    if (!electionRow) {
      throw new Error("Election row not found after insert");
    }
    const electionDbId = electionRow.Id;

    for (const cid of candidateIds) {
      const r = new sql.Request(tx);
      r.input("ElectionId", sql.Int, electionDbId);
      r.input("CandidateId", sql.BigInt, Number(cid));
      await r.query(`
        INSERT INTO Candidates (ElectionId, CandidateId)
        VALUES (@ElectionId, @CandidateId);
      `);
    }

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    console.error("Failed to upsert election:", err);
  }
}

async function markElectionFinalized(blockchainElectionId) {
  const pool = await poolPromise;
  const request = pool.request();
  request.input("BlockchainElectionId", sql.BigInt, blockchainElectionId);
  await request.query(`
    UPDATE Elections
    SET Finalized = 1
    WHERE BlockchainElectionId = @BlockchainElectionId;
  `);
}

function startEventListeners(chainIdFromEnv) {
  const chainId = chainIdFromEnv ? Number(chainIdFromEnv) : null;

  electionManager.on(
    "ElectionCreated",
    async (id, name, startTime, commitDeadline, revealDeadline, candidateIds, gatingEnabled, event) => {
      const log = event.log ?? event;
      const txHash = log.transactionHash;
      const blockNumber = log.blockNumber;
      const logIndex = log.index ?? log.logIndex ?? null;

      if (!txHash) {
        console.error("ElectionCreated: missing txHash in event", event);
        return;
      }

      await upsertElectionFromEvent({
        id,
        name,
        startTime,
        commitDeadline,
        revealDeadline,
        candidateIds,
        gatingEnabled,
      });

      const payload = JSON.stringify({
        name,
        startTime: Number(startTime),
        commitDeadline: Number(commitDeadline),
        revealDeadline: Number(revealDeadline),
        candidateIds: candidateIds.map(Number),
        gatingEnabled,
      });

      await logEvent({
        eventType: "ElectionCreated",
        blockchainElectionId: Number(id),
        voterAddress: null,
        candidateId: null,
        txHash: txHash,
        blockNumber,
        chainId,
        logIndex,
        payload,
      });

      console.log("ElectionCreated logged:", Number(id));
    }
  );

  electionManager.on(
    "VoteCommitted",
    async (id, voter, commitHash, event) => {
      const log = event.log ?? event;
      const txHash = log.transactionHash;
      const blockNumber = log.blockNumber;
      const logIndex = log.index ?? log.logIndex ?? null;

      if (!txHash) {
        console.error("VoteCommitted: missing txHash in event", event);
        return;
      }

      const payload = JSON.stringify({
        commitHash,
      });

      await logEvent({
        eventType: "VoteCommitted",
        blockchainElectionId: Number(id),
        voterAddress: voter,
        candidateId: null,
        txHash: txHash,
        blockNumber,
        chainId,
        logIndex,
        payload,
      });

      console.log("VoteCommitted logged:", Number(id), voter);
    }
  );

  electionManager.on(
    "VoteRevealed",
    async (id, voter, candidateId, event) => {
      const log = event.log ?? event;
      const txHash = log.transactionHash;
      const blockNumber = log.blockNumber;
      const logIndex = log.index ?? log.logIndex ?? null;

      if (!txHash) {
        console.error("VoteRevealed: missing txHash in event", event);
        return;
      }

      const payload = JSON.stringify({
        candidateId: Number(candidateId),
      });

      await logEvent({
        eventType: "VoteRevealed",
        blockchainElectionId: Number(id),
        voterAddress: voter,
        candidateId: Number(candidateId),
        txHash: txHash,
        blockNumber,
        chainId,
        logIndex,
        payload,
      });

      console.log("VoteRevealed logged:", Number(id), voter, Number(candidateId));
    }
  );

  electionManager.on(
    "ElectionFinalized",
    async (id, event) => {
      const log = event.log ?? event;
      const txHash = log.transactionHash;
      const blockNumber = log.blockNumber;
      const logIndex = log.index ?? log.logIndex ?? null;
      const eid = Number(id);

      if (!txHash) {
        console.error("ElectionFinalized: missing txHash in event", event);
        return;
      }

      await markElectionFinalized(eid);

      await logEvent({
        eventType: "ElectionFinalized",
        blockchainElectionId: eid,
        voterAddress: null,
        candidateId: null,
        txHash: txHash,
        blockNumber,
        chainId,
        logIndex,
        payload: null,
      });

      console.log("ElectionFinalized logged:", eid);

      if (ENABLE_ML_AUTO && typeof runAllAnalyses === "function") {
        runAllAnalyses()
          .then(() => {
            console.log("[ML] Analyses finished after finalize");
          })
          .catch((err) => {
            console.error("[ML] Error while running analyses after finalize:", err);
          });
      } else {
        console.log("[ML] Auto analyses skipped (disabled or mlRunner missing)");
      }
    }
  );

  console.log("Event listeners for ElectionManager started");
}

module.exports = {
  startEventListeners,
};
