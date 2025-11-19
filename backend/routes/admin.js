const express = require("express");
const router = express.Router();
const { electionManager, votingRightToken } = require("../services/contracts");

// POST /admin/elections
router.post("/elections", async (req, res) => {
    try {
        const { name, startTime, commitDeadline, revealDeadline, candidateIds, gatingEnabled } = req.body;
        const tx = await electionManager.createElection(name, startTime, commitDeadline, revealDeadline, candidateIds, gatingEnabled);
        const receipt = await tx.wait();

        const event = receipt.logs.find(log => log.fragment?.name === "ElectionCreated");
        const electionId = event?.args?.id?.toString() || "unknown";

        res.json({
            success: true,
            electionId,
            txHash: receipt.hash,
            contractAddress: electionManager.target,
            tokenAddress: votingRightToken.target
        });
    } catch (err) {
        console.error("Error creating election:", err);
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/elections/:id/voters/grant
router.post("/elections/:id/voters/grant", async (req, res) => {
    try {
        const electionId = req.params.id;
        const { addresses } = req.body;
        const tx = await votingRightToken.grantBatch(electionId, addresses);
        const receipt = await tx.wait();
        res.json({ success: true, txHash: receipt.hash });
    } catch (err) {
        console.error("Error granting voting rights:", err);
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/elections/:id/voters/revoke
router.post("/elections/:id/voters/revoke", async (req, res) => {
    try {
        const electionId = req.params.id;
        const { addresses } = req.body;
        const tx = await votingRightToken.revokeBatch(electionId, addresses);
        const receipt = await tx.wait();
        res.json({ success: true, txHash: receipt.hash });
    } catch (err) {
        console.error("Error revoking voting rights:", err);
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/elections/:id/finalize
router.post("/elections/:id/finalize", async (req, res) => {
  try {
    const id = req.params.id;
    const tx = await electionManager.finalize(id);
    const receipt = await tx.wait();
    res.json({ success: true, txHash: receipt.hash });
  } catch (err) {
    console.error("Error finalizing election:", err);
    res.status(500).json({ error: err.reason || err.message });
  }
});

module.exports = router;