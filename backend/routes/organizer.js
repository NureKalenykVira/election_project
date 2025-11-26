const express = require("express");
const router = express.Router();
const { electionManager, votingRightToken } = require("../services/contracts");
const {
  createOffchainElection,
  userOwnsElection,
  getElectionsForOrganizer,
} = require("../services/elections");
const {
  addGrantedVotingRights,
  addRevokedVotingRights,
} = require("../services/votingRights");

// Створення виборів
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

    // 1. Прогнозований id
    const currentCount = await electionManager.electionsCount();
    const predictedId = (currentCount + 1n).toString();

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
      "[organizer][createElection] tx sent",
      tx.hash,
      "sendTime =",
      t1 - t0,
      "ms"
    );

    // 2. Офчейн-запис для організатора (без очікування майнінгу)
    try {
      await createOffchainElection({
        blockchainElectionId: Number(predictedId),
        organizerUserId: req.user.id,
        name,
        startTime,
        commitDeadline,
        revealDeadline,
        gatingEnabled,
      });
      console.log(
        "[organizer][createElection] offchain saved (predictedId)",
        predictedId
      );
    } catch (err) {
      console.error(
        "Organizer: Error saving offchain election (predictedId):",
        err
      );
    }

    // 3. Фонове очікування майнінгу (опційно, для логів)
    tx.wait()
      .then((receipt) => {
        console.log(
          "[organizer][createElection] mined block",
          receipt.blockNumber,
          "tx:",
          tx.hash
        );
      })
      .catch((err) => {
        console.error(
          "[organizer][createElection] tx.wait error (background):",
          tx.hash,
          err
        );
      });

    // 4. Відповідь клієнту
    res.status(202).json({
      success: true,
      electionId: predictedId,
      txHash: tx.hash,
      contractAddress: electionManager.target,
      tokenAddress: votingRightToken.target,
      organizerId: req.user?.id || null,
    });
  } catch (err) {
    console.error("Organizer: Error creating election:", err);
    res.status(500).json({ error: err.message });
  }
});

// Перевірка права власності / адмін
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

// Видача прав голосу
router.post("/elections/:id/voters/grant", async (req, res) => {
  try {
    const ok = await ensureOwnershipOrAdmin(req, res);
    if (!ok) return;

    const electionId = req.params.id;
    const { addresses } = req.body;

    const t0 = Date.now();
    const tx = await votingRightToken.grantBatch(electionId, addresses);
    const t1 = Date.now();
    console.log(
      "[organizer][grant] tx sent",
      tx.hash,
      "sendTime =",
      t1 - t0,
      "ms"
    );

    // Офчейн-лог прав голосу — одразу, без очікування майнінгу
    try {
      await addGrantedVotingRights(electionId, addresses);
      console.log(
        "[organizer][grant] offchain snapshots saved",
        electionId,
        addresses.length
      );
    } catch (dbErr) {
      console.error(
        "Organizer: error saving granted voting right snapshots:",
        dbErr
      );
    }

    // Фонове очікування майнінгу
    tx.wait()
      .then((receipt) => {
        console.log(
          "[organizer][grant] mined block",
          receipt.blockNumber,
          "tx:",
          tx.hash
        );
      })
      .catch((err) => {
        console.error(
          "[organizer][grant] tx.wait error (background):",
          tx.hash,
          err
        );
      });

    res.status(202).json({ success: true, txHash: tx.hash });
  } catch (err) {
    console.error("Organizer: Error granting voting rights:", err);
    res.status(500).json({ error: err.message });
  }
});

// Відкликання прав голосу
router.post("/elections/:id/voters/revoke", async (req, res) => {
  try {
    const ok = await ensureOwnershipOrAdmin(req, res);
    if (!ok) return;

    const electionId = req.params.id;
    const { addresses } = req.body;

    const t0 = Date.now();
    const tx = await votingRightToken.revokeBatch(electionId, addresses);
    const t1 = Date.now();
    console.log(
      "[organizer][revoke] tx sent",
      tx.hash,
      "sendTime =",
      t1 - t0,
      "ms"
    );

    // Офчейн-лог відкликань — одразу
    try {
      await addRevokedVotingRights(electionId, addresses);
      console.log(
        "[organizer][revoke] offchain snapshots saved",
        electionId,
        addresses.length
      );
    } catch (dbErr) {
      console.error(
        "Organizer: error saving revoked voting right snapshots:",
        dbErr
      );
    }

    // Фоновий wait
    tx.wait()
      .then((receipt) => {
        console.log(
          "[organizer][revoke] mined block",
          receipt.blockNumber,
          "tx:",
          tx.hash
        );
      })
      .catch((err) => {
        console.error(
          "[organizer][revoke] tx.wait error (background):",
          tx.hash,
          err
        );
      });

    res.status(202).json({ success: true, txHash: tx.hash });
  } catch (err) {
    console.error("Organizer: Error revoking voting rights:", err);
    res.status(500).json({ error: err.message });
  }
});

// Фіналізація виборів
router.post("/elections/:id/finalize", async (req, res) => {
  try {
    const ok = await ensureOwnershipOrAdmin(req, res);
    if (!ok) return;

    const id = req.params.id;

    const t0 = Date.now();
    const tx = await electionManager.finalize(id);
    const t1 = Date.now();
    console.log(
      "[organizer][finalize] tx sent",
      tx.hash,
      "sendTime =",
      t1 - t0,
      "ms"
    );

    // markElectionFinalized + ML-аналіз робляться через event listener ElectionFinalized.
    tx.wait()
      .then((receipt) => {
        console.log(
          "[organizer][finalize] mined block",
          receipt.blockNumber,
          "tx:",
          tx.hash
        );
      })
      .catch((err) => {
        console.error(
          "[organizer][finalize] tx.wait error (background):",
          tx.hash,
          err
        );
      });

    res.status(202).json({ success: true, txHash: tx.hash });
  } catch (err) {
    console.error("Organizer: Error finalizing election:", err);
    res.status(500).json({ error: err.reason || err.message });
  }
});

// Список виборів організатора
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
