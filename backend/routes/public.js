const express = require("express");
const router = express.Router();
const { electionManager, votingRightToken } = require("../services/contracts");

// GET /elections/:id
router.get("/elections/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const [startTime, commitDeadline, revealDeadline, finalized] = await electionManager.getTimes(id);
        const candidateIds = await electionManager.getCandidateIds(id);
        const election = await electionManager.elections(id);

        res.json({
            id,
            name: election.name,
            startTime: Number(startTime),
            commitDeadline: Number(commitDeadline),
            revealDeadline: Number(revealDeadline),
            finalized,
            candidateIds: candidateIds.map(c => Number(c)),
            gatingEnabled: election.gatingEnabled
        });
    } catch (err) {
        console.error("Error fetching election info:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /elections/:id/tally
router.get("/elections/:id/tally", async (req, res) => {
    try {
        const id = req.params.id;
        const candidateIds = await electionManager.getCandidateIds(id);
        const results = {};

        for (const candidateId of candidateIds) {
            const count = await electionManager.getTally(id, candidateId);
            results[candidateId.toString()] = Number(count);
        }

        res.json(results);
    } catch (err) {
        console.error("Error fetching tally:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /elections/:id/voter/:address
router.get("/elections/:id/voter/:address", async (req, res) => {
    try {
        const { id, address } = req.params;
        const hasRight = await votingRightToken.hasRight(address, id);
        res.json({ address, hasRight });
    } catch (err) {
        console.error("Error checking voting right:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /elections/:id/times
router.get("/elections/:id/times", async (req, res) => {
  try {
    const id = req.params.id;
    const [startTime, commitDeadline, revealDeadline, finalized] = await electionManager.getTimes(id);

    res.json({
      startTime: startTime.toString(),
      commitDeadline: commitDeadline.toString(),
      revealDeadline: revealDeadline.toString(),
      finalized
    });
  } catch (err) {
    console.error("Error fetching times:", err);
    res.status(500).json({ error: err.reason || err.message });
  }
});

// GET /elections/:id/candidates
router.get("/elections/:id/candidates", async (req, res) => {
  try {
    const id = req.params.id;
    const candidates = await electionManager.getCandidateIds(id);
    res.json({ candidateIds: candidates.map(c => c.toString()) });
  } catch (err) {
    console.error("Error fetching candidates:", err);
    res.status(500).json({ error: err.reason || err.message });
  }
});

// GET /elections/:id/tally/:candidateId
router.get("/elections/:id/tally/:candidateId", async (req, res) => {
  try {
    const { id, candidateId } = req.params;
    const tally = await electionManager.getTally(id, candidateId);
    res.json({ votes: tally.toString() });
  } catch (err) {
    console.error("Error fetching tally:", err);
    res.status(500).json({ error: err.reason || err.message });
  }
});

// GET /elections/:id/status
router.get("/elections/:id/status", async (req, res) => {
  try {
    const id = req.params.id;
    const [startTime, commitDeadline, revealDeadline, finalized] = await electionManager.getTimes(id);
    res.json({ electionId: id, finalized });
  } catch (err) {
    console.error("Error getting status:", err);
    res.status(500).json({ error: err.reason || err.message });
  }
});

// GET /elections/:id/committed/:address
router.get("/elections/:id/committed/:address", async (req, res) => {
  try {
    const { id, address } = req.params;
    const hash = await electionManager.commits(id, address);
    const committed = hash !== "0x0000000000000000000000000000000000000000000000000000000000000000";
    res.json({ address, electionId: id, committed });
  } catch (err) {
    console.error("Error checking committed:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /elections/:id/revealed/:address
router.get("/elections/:id/revealed/:address", async (req, res) => {
  try {
    const { id, address } = req.params;
    const revealed = await electionManager.revealed(id, address);
    res.json({ address, electionId: id, revealed });
  } catch (err) {
    console.error("Error checking revealed:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
