const express = require("express");
const router = express.Router();
const { electionManager, votingRightToken } = require("../services/contracts");
const {
  addGrantedVotingRights,
  addRevokedVotingRights,
} = require("../services/votingRights");

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

    console.log("[/admin/elections] creating election...", {
      name,
      startTime,
      commitDeadline,
      revealDeadline,
      candidateIds,
      gatingEnabled,
    });

    const t0 = Date.now();
    const tx = await electionManager.createElection(
      name,
      startTime,
      commitDeadline,
      revealDeadline,
      candidateIds,
      gatingEnabled
    );
    const t1 = Date.now();

    console.log(
      "[/admin/elections] tx sent:",
      tx.hash,
      "sendTime =",
      t1 - t0,
      "ms"
    );

    tx.wait()
      .then((receipt) => {
        console.log(
          "[/admin/elections] tx mined:",
          tx.hash,
          "block",
          receipt.blockNumber
        );
      })
      .catch((err) => {
        console.error("[/admin/elections] tx failed:", tx.hash, err);
      });

    res.status(202).json({
      success: true,
      message:
        "Election transaction sent. It will appear in the list after confirmation.",
      txHash: tx.hash,
      contractAddress: electionManager.target,
      tokenAddress: votingRightToken.target,
    });
  } catch (err) {
    console.error("Error creating election:", err);
    res.status(500).json({ error: err.message || "Unknown error" });
  }
});

router.post("/elections/:id/voters/grant", async (req, res) => {
  try {
    const electionId = req.params.id;
    const { addresses } = req.body;

    const t0 = Date.now();
    const tx = await votingRightToken.grantBatch(electionId, addresses);
    const t1 = Date.now();

    console.log(
      "[/admin/grant] tx sent:",
      tx.hash,
      "sendTime =",
      t1 - t0,
      "ms"
    );

    try {
      await addGrantedVotingRights(electionId, addresses);
      console.log(
        "[/admin/grant] offchain snapshots saved",
        electionId,
        addresses.length
      );
    } catch (dbErr) {
      console.error(
        "Error saving granted voting right snapshots:",
        dbErr
      );
    }

    tx.wait()
      .then((receipt) => {
        console.log(
          "[/admin/grant] tx mined:",
          tx.hash,
          "block",
          receipt.blockNumber
        );
      })
      .catch((err) => {
        console.error("[/admin/grant] tx.wait error:", tx.hash, err);
      });

    res.status(202).json({ success: true, txHash: tx.hash });
  } catch (err) {
    console.error("Error granting voting rights:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/elections/:id/voters/revoke", async (req, res) => {
  try {
    const electionId = req.params.id;
    const { addresses } = req.body;

    const t0 = Date.now();
    const tx = await votingRightToken.revokeBatch(electionId, addresses);
    const t1 = Date.now();

    console.log(
      "[/admin/revoke] tx sent:",
      tx.hash,
      "sendTime =",
      t1 - t0,
      "ms"
    );

    try {
      await addRevokedVotingRights(electionId, addresses);
      console.log(
        "[/admin/revoke] offchain snapshots saved",
        electionId,
        addresses.length
      );
    } catch (dbErr) {
      console.error(
        "Error saving revoked voting right snapshots:",
        dbErr
      );
    }

    tx.wait()
      .then((receipt) => {
        console.log(
          "[/admin/revoke] tx mined:",
          tx.hash,
          "block",
          receipt.blockNumber
        );
      })
      .catch((err) => {
        console.error("[/admin/revoke] tx.wait error:", tx.hash, err);
      });

    res.status(202).json({ success: true, txHash: tx.hash });
  } catch (err) {
    console.error("Error revoking voting rights:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/elections/:id/finalize", async (req, res) => {
  try {
    const id = req.params.id;

    const t0 = Date.now();
    const tx = await electionManager.finalize(id);
    const t1 = Date.now();

    console.log(
      "[/admin/finalize] tx sent:",
      tx.hash,
      "sendTime =",
      t1 - t0,
      "ms"
    );

    tx.wait()
      .then((receipt) => {
        console.log(
          "[/admin/finalize] tx mined:",
          tx.hash,
          "block",
          receipt.blockNumber
        );
      })
      .catch((err) => {
        console.error("[/admin/finalize] tx.wait error:", tx.hash, err);
      });

    res.status(202).json({ success: true, txHash: tx.hash });
  } catch (err) {
    console.error("Error finalizing election:", err);
    res.status(500).json({ error: err.reason || err.message });
  }
});

module.exports = router;
