const express = require("express");
const router = express.Router();
const { ethers } = require("ethers");

function buildCommitHash(electionId, candidateId, salt) {
  return ethers.solidityPackedKeccak256(
    ["uint256", "uint256", "string"],
    [Number(electionId), Number(candidateId), String(salt)]
  );
}

// POST /vote/commit-hash
router.post("/commit-hash", (req, res) => {
  try {
    const { electionId, candidateId, salt } = req.body;

    if (
      electionId === undefined ||
      candidateId === undefined ||
      salt === undefined
    ) {
      return res.status(400).json({
        error: "electionId, candidateId та salt є обов'язковими полями",
      });
    }

    const commitHash = buildCommitHash(electionId, candidateId, salt);

    return res.json({
      success: true,
      commitHash,
    });
  } catch (err) {
    console.error("Error building commit hash:", err);
    return res
      .status(500)
      .json({ error: err.reason || err.message || "Internal server error" });
  }
});

// POST /vote/verify
router.post("/verify", (req, res) => {
  try {
    const { electionId, candidateId, salt, commitHash } = req.body;

    if (
      electionId === undefined ||
      candidateId === undefined ||
      salt === undefined ||
      !commitHash
    ) {
      return res.status(400).json({
        error: "electionId, candidateId, salt та commitHash є обов'язковими полями",
      });
    }

    const expectedCommitHash = buildCommitHash(electionId, candidateId, salt);
    const matches =
      expectedCommitHash.toLowerCase() === commitHash.toLowerCase();

    return res.json({
      success: true,
      expectedCommitHash,
      matches,
    });
  } catch (err) {
    console.error("Error verifying commit hash:", err);
    return res
      .status(500)
      .json({ error: err.reason || err.message || "Internal server error" });
  }
});

module.exports = router;
