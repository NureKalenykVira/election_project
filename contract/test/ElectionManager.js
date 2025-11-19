const { expect } = require("chai");
const { ethers } = require("hardhat");

// Хелпер для перемотки часу в hardhat-мережі
async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

// Хелпер: отримати поточний timestamp блоку
async function latestTimestamp() {
  const block = await ethers.provider.getBlock("latest");
  return Number(block.timestamp);
}

describe("ElectionManager", function () {
  let owner;
  let voter1;
  let voter2;
  let other;
  let votingToken;      // MockVotingRightToken
  let electionManager;

  beforeEach(async function () {
    [owner, voter1, voter2, other] = await ethers.getSigners();

    // Деплоїмо мок токена прав голосу
    const VotingTokenMock = await ethers.getContractFactory("MockVotingRightToken");
    votingToken = await VotingTokenMock.deploy();
    await votingToken.waitForDeployment();

    const ElectionManager = await ethers.getContractFactory("ElectionManager");
    electionManager = await ElectionManager.deploy(await votingToken.getAddress());
    await electionManager.waitForDeployment();
  });

  it("створює вибори з правильними полями і інкрементує лічильник", async function () {
    const now = await latestTimestamp();
    const startTime = now + 60;
    const commitDeadline = startTime + 300;
    const revealDeadline = commitDeadline + 300;
    const candidateIds = [1, 2, 3];

    const tx = await electionManager.createElection(
      "Test election",
      startTime,
      commitDeadline,
      revealDeadline,
      candidateIds,
      false // gatingDisabled
    );

    await expect(tx).to.emit(electionManager, "ElectionCreated");

    const electionsCount = await electionManager.electionsCount();
    expect(Number(electionsCount)).to.equal(1);

    const id = 1;
    const e = await electionManager.elections(id);

    expect(e.name).to.equal("Test election");
    expect(Number(e.startTime)).to.equal(startTime);
    expect(Number(e.commitDeadline)).to.equal(commitDeadline);
    expect(Number(e.revealDeadline)).to.equal(revealDeadline);
    expect(e.finalized).to.equal(false);
    expect(e.gatingEnabled).to.equal(false);

    const storedCandidateIds = await electionManager.getCandidateIds(id);
    expect(storedCandidateIds.map(Number)).to.deep.equal(candidateIds);
  });

  it("не дозволяє створити вибори з порожньою назвою", async function () {
    const now = await latestTimestamp();
    const startTime = now + 10;
    const commitDeadline = startTime + 100;
    const revealDeadline = commitDeadline + 100;
    const candidateIds = [1];

    await expect(
      electionManager.createElection(
        "",
        startTime,
        commitDeadline,
        revealDeadline,
        candidateIds,
        false
      )
    ).to.be.revertedWith("Empty name");
  });

  it("не дозволяє створити вибори без кандидатів", async function () {
    const now = await latestTimestamp();
    const startTime = now + 10;
    const commitDeadline = startTime + 100;
    const revealDeadline = commitDeadline + 100;
    const candidateIds = [];

    await expect(
      electionManager.createElection(
        "No candidates",
        startTime,
        commitDeadline,
        revealDeadline,
        candidateIds,
        false
      )
    ).to.be.revertedWith("No candidates");
  });

  it("перевіряє порядок часів при створенні виборів", async function () {
    const now = await latestTimestamp();
    const startTime = now + 100;
    const commitDeadline = startTime - 10; // commit до startTime
    const revealDeadline = commitDeadline + 100;
    const candidateIds = [1];

    await expect(
      electionManager.createElection(
        "Wrong times",
        startTime,
        commitDeadline,
        revealDeadline,
        candidateIds,
        false
      )
    ).to.be.revertedWith("Times order");

    // ще раз: commit < reveal, але commit < startTime ок, а от commit >= reveal — ні
    const startTime2 = now + 10;
    const commitDeadline2 = startTime2 + 100;
    const revealDeadline2 = commitDeadline2 - 10;

    await expect(
      electionManager.createElection(
        "Wrong times 2",
        startTime2,
        commitDeadline2,
        revealDeadline2,
        [1],
        false
      )
    ).to.be.revertedWith("Times order");
  });

  it("дозволяє повний сценарій: create -> commit -> reveal -> finalize", async function () {
    const now = await latestTimestamp();
    const startTime = now + 10;
    const commitDeadline = startTime + 100;
    const revealDeadline = commitDeadline + 100;
    const candidateIds = [1, 2];

    await electionManager.createElection(
      "Full flow",
      startTime,
      commitDeadline,
      revealDeadline,
      candidateIds,
      false
    );

    const electionId = 1;
    const candidateId = 1;

    // Комітуємось у правильну фазу
    await increaseTime(20); // переходимо за startTime

    const salt = ethers.id("secret-salt");
    const commitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "bytes32"],
        [candidateId, salt]
      )
    );

    await expect(
      electionManager.connect(voter1).commitVote(electionId, commitment)
    )
      .to.emit(electionManager, "VoteCommitted")
      .withArgs(electionId, voter1.address, commitment);

    // Перемотка до reveal-фази (після commitDeadline, але до revealDeadline)
    const now2 = await latestTimestamp();
    const toRevealPhase = commitDeadline + 1 - now2;
    await increaseTime(toRevealPhase);

    await expect(
      electionManager.connect(voter1).revealVote(electionId, candidateId, salt)
    )
      .to.emit(electionManager, "VoteRevealed")
      .withArgs(electionId, voter1.address, candidateId);

    // tally
    const tally1 = await electionManager.getTally(electionId, candidateId);
    const tally2 = await electionManager.getTally(electionId, 2);
    expect(Number(tally1)).to.equal(1);
    expect(Number(tally2)).to.equal(0);

    // Перемотка за revealDeadline
    const now3 = await latestTimestamp();
    const toAfterReveal = revealDeadline + 1 - now3;
    await increaseTime(toAfterReveal);

    await expect(electionManager.finalize(electionId))
      .to.emit(electionManager, "ElectionFinalized")
      .withArgs(electionId);

    const times = await electionManager.getTimes(electionId);
    expect(times.finalized).to.equal(true);
  });

  it("не дозволяє commit до startTime", async function () {
    const now = await latestTimestamp();
    const startTime = now + 100;
    const commitDeadline = startTime + 100;
    const revealDeadline = commitDeadline + 100;
    const candidateIds = [1];

    await electionManager.createElection(
      "Too early",
      startTime,
      commitDeadline,
      revealDeadline,
      candidateIds,
      false
    );

    const electionId = 1;
    const salt = ethers.id("salt");
    const commitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "bytes32"],
        [1, salt]
      )
    );

    await expect(
      electionManager.connect(voter1).commitVote(electionId, commitment)
    ).to.be.revertedWith("Too early");
  });

  it("не дозволяє commit після commitDeadline", async function () {
    const now = await latestTimestamp();
    const startTime = now + 10;
    const commitDeadline = startTime + 50;
    const revealDeadline = commitDeadline + 100;

    await electionManager.createElection(
      "Late commit",
      startTime,
      commitDeadline,
      revealDeadline,
      [1],
      false
    );

    const electionId = 1;

    // перемотали одразу за commitDeadline
    const now2 = await latestTimestamp();
    const toAfterCommit = startTime + 60 - now2;
    await increaseTime(toAfterCommit);

    const salt = ethers.id("salt");
    const commitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "bytes32"],
        [1, salt]
      )
    );

    await expect(
      electionManager.connect(voter1).commitVote(electionId, commitment)
    ).to.be.revertedWith("Commit phase over");
  });

  it("не дозволяє комітнути порожній хеш", async function () {
    const now = await latestTimestamp();
    const startTime = now + 10;
    const commitDeadline = startTime + 50;
    const revealDeadline = commitDeadline + 100;

    await electionManager.createElection(
      "Empty commit",
      startTime,
      commitDeadline,
      revealDeadline,
      [1],
      false
    );

    const electionId = 1;

    await increaseTime(20); // доходимо до commit-фази

    await expect(
      electionManager.connect(voter1).commitVote(electionId, ethers.ZeroHash)
    ).to.be.revertedWith("Empty commit");
  });

  it("не дозволяє зробити commit двічі одним і тим самим адресом", async function () {
    const now = await latestTimestamp();
    const startTime = now + 10;
    const commitDeadline = startTime + 100;
    const revealDeadline = commitDeadline + 100;

    await electionManager.createElection(
      "Double commit",
      startTime,
      commitDeadline,
      revealDeadline,
      [1],
      false
    );

    const electionId = 1;

    await increaseTime(20);

    const salt = ethers.id("salt");
    const commitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "bytes32"],
        [1, salt]
      )
    );

    await electionManager.connect(voter1).commitVote(electionId, commitment);

    await expect(
      electionManager.connect(voter1).commitVote(electionId, commitment)
    ).to.be.revertedWith("Already committed");
  });

  it("не дозволяє reveal до початку reveal-фази (ще триває commit-фаза)", async function () {
    const now = await latestTimestamp();
    const startTime = now + 10;
    const commitDeadline = startTime + 100;
    const revealDeadline = commitDeadline + 100;

    await electionManager.createElection(
      "Reveal too early",
      startTime,
      commitDeadline,
      revealDeadline,
      [1],
      false
    );

    const electionId = 1;
    const salt = ethers.id("salt");
    const commitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "bytes32"],
        [1, salt]
      )
    );

    await increaseTime(20);
    await electionManager.connect(voter1).commitVote(electionId, commitment);

    // все ще до commitDeadline
    await expect(
      electionManager.connect(voter1).revealVote(electionId, 1, salt)
    ).to.be.revertedWith("Commit phase");
  });

  it("не дозволяє reveal після revealDeadline", async function () {
    const now = await latestTimestamp();
    const startTime = now + 10;
    const commitDeadline = startTime + 50;
    const revealDeadline = commitDeadline + 50;

    await electionManager.createElection(
      "Reveal too late",
      startTime,
      commitDeadline,
      revealDeadline,
      [1],
      false
    );

    const electionId = 1;
    const salt = ethers.id("salt");
    const commitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "bytes32"],
        [1, salt]
      )
    );

    await increaseTime(20);
    await electionManager.connect(voter1).commitVote(electionId, commitment);

    // Перемотаємо за revealDeadline
    const now2 = await latestTimestamp();
    const toAfterReveal = revealDeadline + 1 - now2;
    await increaseTime(toAfterReveal);

    await expect(
      electionManager.connect(voter1).revealVote(electionId, 1, salt)
    ).to.be.revertedWith("Reveal phase over");
  });

  it("не дозволяє reveal без commit", async function () {
    const now = await latestTimestamp();
    const startTime = now + 10;
    const commitDeadline = startTime + 50;
    const revealDeadline = commitDeadline + 50;

    await electionManager.createElection(
      "Reveal without commit",
      startTime,
      commitDeadline,
      revealDeadline,
      [1],
      false
    );

    const electionId = 1;

    // Перейдемо у reveal-фазу
    const now2 = await latestTimestamp();
    const toRevealPhase = revealDeadline - 10 - now2;
    await increaseTime(toRevealPhase);

    const salt = ethers.id("salt");

    await expect(
      electionManager.connect(voter1).revealVote(electionId, 1, salt)
    ).to.be.revertedWith("No commit");
  });

  it("не дозволяє reveal з неправильним salt/candidate (хеш не збігається)", async function () {
    const now = await latestTimestamp();
    const startTime = now + 10;
    const commitDeadline = startTime + 50;
    const revealDeadline = commitDeadline + 50;

    await electionManager.createElection(
      "Wrong reveal",
      startTime,
      commitDeadline,
      revealDeadline,
      [1],
      false
    );

    const electionId = 1;

    await increaseTime(20);

    const correctSalt = ethers.id("correct");
    const commitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "bytes32"],
        [1, correctSalt]
      )
    );

    await electionManager.connect(voter1).commitVote(electionId, commitment);

    const now2 = await latestTimestamp();
    const toRevealPhase = commitDeadline + 1 - now2;
    await increaseTime(toRevealPhase);

    const wrongSalt = ethers.id("wrong");

    await expect(
      electionManager.connect(voter1).revealVote(electionId, 1, wrongSalt)
    ).to.be.revertedWith("Invalid reveal");
  });

  it("не дозволяє зробити reveal двічі", async function () {
    const now = await latestTimestamp();
    const startTime = now + 10;
    const commitDeadline = startTime + 50;
    const revealDeadline = commitDeadline + 50;

    await electionManager.createElection(
      "Double reveal",
      startTime,
      commitDeadline,
      revealDeadline,
      [1],
      false
    );

    const electionId = 1;
    const salt = ethers.id("salt");
    const commitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "bytes32"],
        [1, salt]
      )
    );

    await increaseTime(20);
    await electionManager.connect(voter1).commitVote(electionId, commitment);

    const now2 = await latestTimestamp();
    const toRevealPhase = commitDeadline + 1 - now2;
    await increaseTime(toRevealPhase);

    await electionManager.connect(voter1).revealVote(electionId, 1, salt);

    await expect(
      electionManager.connect(voter1).revealVote(electionId, 1, salt)
    ).to.be.revertedWith("Already revealed");
  });

  it("не дозволяє фіналізувати до завершення reveal-фази", async function () {
    const now = await latestTimestamp();
    const startTime = now + 10;
    const commitDeadline = startTime + 50;
    const revealDeadline = commitDeadline + 50;

    await electionManager.createElection(
      "Early finalize",
      startTime,
      commitDeadline,
      revealDeadline,
      [1],
      false
    );

    const electionId = 1;

    await increaseTime(20);

    await expect(
      electionManager.finalize(electionId)
    ).to.be.revertedWith("Reveal not over");
  });

  it("не дозволяє фіналізувати двічі", async function () {
    const now = await latestTimestamp();
    const startTime = now + 10;
    const commitDeadline = startTime + 50;
    const revealDeadline = commitDeadline + 50;

    await electionManager.createElection(
      "Double finalize",
      startTime,
      commitDeadline,
      revealDeadline,
      [1],
      false
    );

    const electionId = 1;

    // Перемотаємо одразу за revealDeadline
    const now2 = await latestTimestamp();
    const toAfterReveal = revealDeadline + 1 - now2;
    await increaseTime(toAfterReveal);

    await electionManager.finalize(electionId);

    await expect(
      electionManager.finalize(electionId)
    ).to.be.revertedWith("Already finalized");
  });

  it("перевіряє gatingEnabled: без права голосу commit блокується, з правом — проходить", async function () {
    const now = await latestTimestamp();
    const startTime = now + 10;
    const commitDeadline = startTime + 100;
    const revealDeadline = commitDeadline + 100;

    await electionManager.createElection(
      "Gated election",
      startTime,
      commitDeadline,
      revealDeadline,
      [1],
      true // gatingEnabled = true
    );

    const electionId = 1;

    await increaseTime(20);

    const salt = ethers.id("salt");
    const commitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "bytes32"],
        [1, salt]
      )
    );

    // Спочатку немає права голосу
    await expect(
      electionManager.connect(voter1).commitVote(electionId, commitment)
    ).to.be.revertedWith("No voting right");

    // Дамо право голосу через мок
    await votingToken.setRight(voter1.address, electionId, true);

    await expect(
      electionManager.connect(voter1).commitVote(electionId, commitment)
    ).to.emit(electionManager, "VoteCommitted");
  });

  it("getTimes повертає коректні значення", async function () {
    const now = await latestTimestamp();
    const startTime = now + 10;
    const commitDeadline = startTime + 50;
    const revealDeadline = commitDeadline + 50;

    await electionManager.createElection(
      "Times test",
      startTime,
      commitDeadline,
      revealDeadline,
      [1],
      false
    );

    const electionId = 1;
    const times = await electionManager.getTimes(electionId);

    expect(Number(times.startTime)).to.equal(startTime);
    expect(Number(times.commitDeadline)).to.equal(commitDeadline);
    expect(Number(times.revealDeadline)).to.equal(revealDeadline);
    expect(times.finalized).to.equal(false);
  });

    it("коректно рахує голоси кількох виборців по різних кандидатах", async function () {
    const now = await latestTimestamp();
    const startTime = now + 10;
    const commitDeadline = startTime + 100;
    const revealDeadline = commitDeadline + 100;
    const candidateIds = [1, 2, 3];

    await electionManager.createElection(
      "Multi-voter election",
      startTime,
      commitDeadline,
      revealDeadline,
      candidateIds,
      false // gatingDisabled
    );

    const electionId = 1;

    // Переходимо в commit-фазу
    await increaseTime(20);

    const voters = [voter1, voter2, other]; // три різні адреси
    const votes = [1, 1, 2];               // два за кандидата 1, один за кандидата 2
    const salts = votes.map((_, i) => ethers.id("multi-salt-" + i));

    // Commit усіх трьох виборців
    for (let i = 0; i < voters.length; i++) {
      const candidateId = votes[i];
      const salt = salts[i];
      const commitment = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "bytes32"],
          [candidateId, salt]
        )
      );

      await expect(
        electionManager.connect(voters[i]).commitVote(electionId, commitment)
      ).to.emit(electionManager, "VoteCommitted");
    }

    // Переводимо час у reveal-фазу
    const now2 = await latestTimestamp();
    const toRevealPhase = commitDeadline + 1 - now2;
    await increaseTime(toRevealPhase);

    // Reveal усіх голосів
    for (let i = 0; i < voters.length; i++) {
      const candidateId = votes[i];
      const salt = salts[i];

      await expect(
        electionManager.connect(voters[i]).revealVote(electionId, candidateId, salt)
      ).to.emit(electionManager, "VoteRevealed");
    }

    // Перевіряємо підрахунок голосів
    const tally1 = await electionManager.getTally(electionId, 1);
    const tally2 = await electionManager.getTally(electionId, 2);
    const tally3 = await electionManager.getTally(electionId, 3);

    expect(Number(tally1)).to.equal(2); // два голоси за 1
    expect(Number(tally2)).to.equal(1); // один голос за 2
    expect(Number(tally3)).to.equal(0); // нуль голосів за 3
  });

  it("ізольовує стани декількох виборів з однаковими candidateIds", async function () {
    const now = await latestTimestamp();
    const startTime = now + 10;
    const commitDeadline = startTime + 50;
    const revealDeadline = commitDeadline + 50;
    const candidateIds = [1, 2];

    // Створюємо двоє виборів підряд
    await electionManager.createElection(
      "Election #1",
      startTime,
      commitDeadline,
      revealDeadline,
      candidateIds,
      false
    );
    await electionManager.createElection(
      "Election #2",
      startTime,
      commitDeadline,
      revealDeadline,
      candidateIds,
      false
    );

    const election1 = 1;
    const election2 = 2;

    // Переходимо в commit-фазу
    await increaseTime(20);

    // Виборець 1 голосує в перших виборах за кандидата 1
    const salt1 = ethers.id("e1-salt");
    const commit1 = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "bytes32"],
        [1, salt1]
      )
    );
    await electionManager.connect(voter1).commitVote(election1, commit1);

    // Виборець 2 голосує в других виборах за кандидата 2
    const salt2 = ethers.id("e2-salt");
    const commit2 = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "bytes32"],
        [2, salt2]
      )
    );
    await electionManager.connect(voter2).commitVote(election2, commit2);

    // Переходимо в reveal-фазу
    const now2 = await latestTimestamp();
    const toRevealPhase = commitDeadline + 1 - now2;
    await increaseTime(toRevealPhase);

    // Reveal у кожних виборах окремо
    await electionManager.connect(voter1).revealVote(election1, 1, salt1);
    await electionManager.connect(voter2).revealVote(election2, 2, salt2);

    // Перевіряємо, що стани не змішуються
    const e1c1 = await electionManager.getTally(election1, 1);
    const e1c2 = await electionManager.getTally(election1, 2);
    const e2c1 = await electionManager.getTally(election2, 1);
    const e2c2 = await electionManager.getTally(election2, 2);

    expect(Number(e1c1)).to.equal(1);
    expect(Number(e1c2)).to.equal(0);

    expect(Number(e2c1)).to.equal(0);
    expect(Number(e2c2)).to.equal(1);
  });
});
