const express = require("express");
const router = express.Router();
const { ethers } = require("ethers");
const { electionManager } = require("../services/contracts");

// POST /vote/commit
router.post("/commit", async (req, res) => {
    try {
        const { electionId, commitHash } = req.body;

        if (!electionId || !commitHash) {
            return res.status(400).json({ error: "electionId and commitHash are required" });
        }

        const tx = await electionManager.commitVote(electionId, commitHash);
        const receipt = await tx.wait();

        res.json({
            success: true,
            txHash: receipt.hash
        });
    } catch (err) {
        console.error("Error during vote commit:", err);
        res.status(500).json({ error: err.reason || err.message });
    }
});

// POST /vote/reveal
router.post("/reveal", async (req, res) => {
    try {
        const { electionId, candidateId, salt } = req.body;

        if (!electionId || !candidateId || !salt) {
            return res.status(400).json({ error: "electionId, candidateId, and salt are required" });
        }

        const tx = await electionManager.revealVote(electionId, candidateId, salt);
        const receipt = await tx.wait();

        res.json({ success: true, txHash: receipt.hash });
    } catch (err) {
        console.error("Error revealing vote:", err);
        res.status(500).json({ error: err.reason || err.message });
    }
});

module.exports = router;
