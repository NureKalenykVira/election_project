const express = require("express");
const router = express.Router();
const { electionManager, votingRightToken } = require("../services/contracts");
const {
  createOffchainElection,
  userOwnsElection,
  getElectionsForOrganizer,
} = require("../services/elections");

router.post("/elections", async (req, res) => {
  try {
    const {
      name,
      startTime,
      commitDeadline,
      revealDeadline,
      candidateIds,
      gatingEnabled,
    } = req.body;

    const tx = await electionManager.createElection(
      name,
      startTime,
      commitDeadline,
      revealDeadline,
      candidateIds,
      gatingEnabled
    );
    const receipt = await tx.wait();

    const event = receipt.logs.find(
      (log) => log.fragment?.name === "ElectionCreated"
    );
    const electionId = event?.args?.id?.toString() || null;

    if (!electionId) {
      console.error("Organizer: ElectionCreated event not found in logs");
    } else {
      try {
        await createOffchainElection({
          blockchainElectionId: Number(electionId),
          organizerUserId: req.user.id,
          name,
          startTime,
          commitDeadline,
          revealDeadline,
          gatingEnabled,
        });
      } catch (err) {
        console.error("Organizer: Error saving offchain election:", err);
      }
    }

    res.json({
      success: true,
      electionId: electionId || "unknown",
      txHash: receipt.hash,
      contractAddress: electionManager.target,
      tokenAddress: votingRightToken.target,
      organizerId: req.user?.id || null,
    });
  } catch (err) {
    console.error("Organizer: Error creating election:", err);
    res.status(500).json({ error: err.message });
  }
});

async function ensureOwnershipOrAdmin(req, res) {
  const user = req.user;
  const electionId = req.params.id;

  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  if (user.role === "admin") {
    return true;
  }

  const owns = await userOwnsElection(user.id, electionId);
  if (!owns) {
    res
      .status(403)
      .json({ error: "You are not the organizer of this election" });
    return false;
  }

  return true;
}

router.post("/elections/:id/voters/grant", async (req, res) => {
  try {
    const ok = await ensureOwnershipOrAdmin(req, res);
    if (!ok) return;

    const electionId = req.params.id;
    const { addresses } = req.body;

    const tx = await votingRightToken.grantBatch(electionId, addresses);
    const receipt = await tx.wait();

    res.json({ success: true, txHash: receipt.hash });
  } catch (err) {
    console.error("Organizer: Error granting voting rights:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/elections/:id/voters/revoke", async (req, res) => {
  try {
    const ok = await ensureOwnershipOrAdmin(req, res);
    if (!ok) return;

    const electionId = req.params.id;
    const { addresses } = req.body;

    const tx = await votingRightToken.revokeBatch(electionId, addresses);
    const receipt = await tx.wait();

    res.json({ success: true, txHash: receipt.hash });
  } catch (err) {
    console.error("Organizer: Error revoking voting rights:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/elections/:id/finalize", async (req, res) => {
  try {
    const ok = await ensureOwnershipOrAdmin(req, res);
    if (!ok) return;

    const id = req.params.id;

    const tx = await electionManager.finalize(id);
    const receipt = await tx.wait();

    res.json({ success: true, txHash: receipt.hash });
  } catch (err) {
    console.error("Organizer: Error finalizing election:", err);
    res.status(500).json({ error: err.reason || err.message });
  }
});

router.get("/my-elections", async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const elections = await getElectionsForOrganizer(req.user.id);
    res.json(elections);
  } catch (err) {
    console.error("Organizer: Error fetching my elections:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
