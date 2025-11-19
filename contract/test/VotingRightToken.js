const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("VotingRightToken", function () {
  let admin;
  let minter;
  let user1;
  let user2;
  let user3;
  let votingToken;
  let MINTER_ROLE;

  beforeEach(async function () {
    [admin, minter, user1, user2, user3] = await ethers.getSigners();

    const VotingRightToken = await ethers.getContractFactory("VotingRightToken");
    votingToken = await VotingRightToken.connect(admin).deploy();
    await votingToken.waitForDeployment();

    MINTER_ROLE = await votingToken.MINTER_ROLE();

    // робимо minter власником ролі MINTER_ROLE
    await votingToken.connect(admin).grantRole(MINTER_ROLE, minter.address);
  });

  it("мінтер може видати права голосу батчем, баланси і hasRight оновлюються, події емитяться", async function () {
    const electionId = 1;
    const accounts = [user1.address, user2.address];

    const tx = await votingToken.connect(minter).grantBatch(electionId, accounts);

    await expect(tx)
      .to.emit(votingToken, "VotingRightGranted")
      .withArgs(electionId, user1.address);
    await expect(tx)
      .to.emit(votingToken, "VotingRightGranted")
      .withArgs(electionId, user2.address);

    const b1 = await votingToken.balanceOf(user1.address, electionId);
    const b2 = await votingToken.balanceOf(user2.address, electionId);

    expect(b1).to.equal(1);
    expect(b2).to.equal(1);

    expect(await votingToken.hasRight(user1.address, electionId)).to.equal(true);
    expect(await votingToken.hasRight(user2.address, electionId)).to.equal(true);
  });

  it("grantBatch вимагає непорожній список accounts", async function () {
    await expect(
      votingToken.connect(minter).grantBatch(1, [])
    ).to.be.revertedWith("No accounts");
  });

  it("grantBatch не дублює токени, якщо викликано повторно для того самого акаунта", async function () {
    const electionId = 1;

    await votingToken.connect(minter).grantBatch(electionId, [user1.address]);

    const bBefore = await votingToken.balanceOf(user1.address, electionId);
    expect(bBefore).to.equal(1);

    // друга спроба: токен не має збільшитись
    const tx = await votingToken.connect(minter).grantBatch(electionId, [user1.address, user2.address]);

    // подія гарантовано буде лише для user2
    await expect(tx)
      .to.emit(votingToken, "VotingRightGranted")
      .withArgs(electionId, user2.address);

    const b1 = await votingToken.balanceOf(user1.address, electionId);
    const b2 = await votingToken.balanceOf(user2.address, electionId);

    expect(b1).to.equal(1); // не змінилось
    expect(b2).to.equal(1); // новий токен
  });

  it("revokeBatch спалює токени і емитить події", async function () {
    const electionId = 1;
    await votingToken.connect(minter).grantBatch(electionId, [user1.address, user2.address]);

    const tx = await votingToken.connect(minter).revokeBatch(electionId, [user1.address, user2.address]);

    await expect(tx)
      .to.emit(votingToken, "VotingRightRevoked")
      .withArgs(electionId, user1.address);
    await expect(tx)
      .to.emit(votingToken, "VotingRightRevoked")
      .withArgs(electionId, user2.address);

    const b1 = await votingToken.balanceOf(user1.address, electionId);
    const b2 = await votingToken.balanceOf(user2.address, electionId);

    expect(b1).to.equal(0);
    expect(b2).to.equal(0);

    expect(await votingToken.hasRight(user1.address, electionId)).to.equal(false);
    expect(await votingToken.hasRight(user2.address, electionId)).to.equal(false);
  });

  it("revokeBatch не приймає порожній список accounts", async function () {
    await expect(
      votingToken.connect(minter).revokeBatch(1, [])
    ).to.be.revertedWith("No accounts");
  });

  it("revokeBatch не падає, якщо токена вже немає (баланс 0)", async function () {
    const electionId = 1;
    // видаємо та одразу відкликаємо
    await votingToken.connect(minter).grantBatch(electionId, [user1.address]);
    await votingToken.connect(minter).revokeBatch(electionId, [user1.address]);

    // друга спроба відкликати не має падати (if balance > 0)
    await expect(
      votingToken.connect(minter).revokeBatch(electionId, [user1.address])
    ).to.not.be.reverted;
  });

  it("коректно працює hasRight для різних виборів", async function () {
    await votingToken.connect(minter).grantBatch(1, [user1.address]);
    await votingToken.connect(minter).grantBatch(2, [user2.address]);

    expect(await votingToken.hasRight(user1.address, 1)).to.equal(true);
    expect(await votingToken.hasRight(user1.address, 2)).to.equal(false);

    expect(await votingToken.hasRight(user2.address, 1)).to.equal(false);
    expect(await votingToken.hasRight(user2.address, 2)).to.equal(true);
  });

  it("не дозволяє grantBatch без ролі MINTER_ROLE", async function () {
    const electionId = 1;
    await expect(
      votingToken.connect(user1).grantBatch(electionId, [user2.address])
    ).to.be.reverted; // AccessControl-реверт, не прив'язуємось до конкретного тексту
  });

  it("не дозволяє revokeBatch без ролі MINTER_ROLE", async function () {
    const electionId = 1;
    await votingToken.connect(minter).grantBatch(electionId, [user1.address]);

    await expect(
      votingToken.connect(user1).revokeBatch(electionId, [user1.address])
    ).to.be.reverted;
  });

  it("забороняє setApprovalForAll (soulbound логіка)", async function () {
    await expect(
      votingToken.connect(user1).setApprovalForAll(user2.address, true)
    ).to.be.revertedWith("SBT: approvals disabled");
  });

  it("забороняє safeTransferFrom (soulbound логіка)", async function () {
    await expect(
      votingToken
        .connect(user1)
        .safeTransferFrom(user1.address, user2.address, 1, 1, "0x")
    ).to.be.revertedWith("SBT: transfer disabled");
  });

  it("забороняє safeBatchTransferFrom (soulbound логіка)", async function () {
    await expect(
      votingToken
        .connect(user1)
        .safeBatchTransferFrom(
          user1.address,
          user2.address,
          [1, 2],
          [1, 1],
          "0x"
        )
    ).to.be.revertedWith("SBT: transfer disabled");
  });

  it("supportsInterface повертає true для IERC1155 і IAccessControl", async function () {
    // IERC1155
    const IERC1155_ID = "0xd9b67a26";
    // IAccessControl
    const IAccessControl_ID = "0x7965db0b";

    expect(await votingToken.supportsInterface(IERC1155_ID)).to.equal(true);
    expect(await votingToken.supportsInterface(IAccessControl_ID)).to.equal(true);
  });
});
