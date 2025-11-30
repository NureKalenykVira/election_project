const request = require("supertest");
const express = require("express");

jest.mock("../services/contracts", () => {
  const electionManager = {
    electionsCount: jest.fn().mockResolvedValue(0n),
    createElection: jest.fn(),
    finalize: jest.fn(),
    target: "0xmanager",
  };

  const votingRightToken = {
    grantBatch: jest.fn(),
    revokeBatch: jest.fn(),
    target: "0xtoken",
  };

  return { electionManager, votingRightToken };
});

jest.mock("../services/elections", () => ({
  createOffchainElection: jest.fn(),
  userOwnsElection: jest.fn(),
  getElectionsForOrganizer: jest.fn(),
}));

jest.mock("../services/votingRights", () => ({
  addGrantedVotingRights: jest.fn(),
  addRevokedVotingRights: jest.fn(),
}));

const organizerRouter = require("../routes/organizer");
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

function createAppWithUser(user) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = user;
    next();
  });
  app.use("/organizer", organizerRouter);
  return app;
}

function createAppWithoutUser() {
  const app = express();
  app.use(express.json());
  app.use("/organizer", organizerRouter);
  return app;
}

describe("Organizer routes", () => {
  let consoleErrorSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    electionManager.electionsCount.mockResolvedValue(0n);
    consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe("POST /organizer/elections", () => {
    const body = {
      name: "Test election",
      startTime: 1732300000,
      commitDeadline: 1732303600,
      revealDeadline: 1732307200,
      candidateIds: [1, 2, 3],
      gatingEnabled: true,
    };

    test("створює вибори ончейн і офчейн, повертає success (202)", async () => {
      const app = createAppWithUser({ id: 1, role: "organizer" });

      electionManager.electionsCount.mockResolvedValue(0n); // predictedId = 1

      const receipt = {
        blockNumber: 100,
      };
      const waitMock = jest.fn().mockResolvedValue(receipt);

      electionManager.createElection.mockResolvedValue({
        hash: "0xtxhash",
        wait: waitMock,
      });

      const res = await request(app)
        .post("/organizer/elections")
        .send(body)
        .expect(202);

      expect(electionManager.electionsCount).toHaveBeenCalled();
      expect(electionManager.createElection).toHaveBeenCalledWith(
        body.name,
        body.startTime,
        body.commitDeadline,
        body.revealDeadline,
        body.candidateIds,
        body.gatingEnabled
      );
      expect(waitMock).toHaveBeenCalled();

      expect(createOffchainElection).toHaveBeenCalledWith({
        blockchainElectionId: 1,
        organizerUserId: 1,
        name: body.name,
        startTime: body.startTime,
        commitDeadline: body.commitDeadline,
        revealDeadline: body.revealDeadline,
        gatingEnabled: body.gatingEnabled,
      });

      expect(res.body).toEqual({
        success: true,
        electionId: "1",
        txHash: "0xtxhash",
        contractAddress: electionManager.target,
        tokenAddress: votingRightToken.target,
        organizerId: 1,
      });
    });

    test("якщо createOffchainElection падає — запит все одно 202", async () => {
      const app = createAppWithUser({ id: 1, role: "organizer" });

      electionManager.electionsCount.mockResolvedValue(0n);

      const waitMock = jest.fn().mockResolvedValue({ blockNumber: 100 });
      electionManager.createElection.mockResolvedValue({
        hash: "0xtxhash",
        wait: waitMock,
      });

      createOffchainElection.mockRejectedValue(new Error("DB error"));

      const res = await request(app)
        .post("/organizer/elections")
        .send(body)
        .expect(202);

      expect(createOffchainElection).toHaveBeenCalled();
      expect(res.body.success).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    test("якщо electionManager.createElection падає — повертається 500", async () => {
      const app = createAppWithUser({ id: 1, role: "organizer" });

      electionManager.electionsCount.mockResolvedValue(0n);
      electionManager.createElection.mockRejectedValue(
        new Error("Onchain fail")
      );

      const res = await request(app)
        .post("/organizer/elections")
        .send(body)
        .expect(500);

      expect(createOffchainElection).not.toHaveBeenCalled();
      expect(res.body).toEqual({ error: "Onchain fail" });
    });
  });

  describe("POST /organizer/elections/:id/voters/grant", () => {
    const addresses = ["0x1", "0x2"];

    test("успіх, коли користувач є організатором (202)", async () => {
      const app = createAppWithUser({ id: 1, role: "organizer" });

      userOwnsElection.mockResolvedValue(true);
      votingRightToken.grantBatch.mockResolvedValue({
        hash: "0xgrant",
        wait: jest.fn().mockResolvedValue({ blockNumber: 50 }),
      });

      const res = await request(app)
        .post("/organizer/elections/11/voters/grant")
        .send({ addresses })
        .expect(202);

      expect(userOwnsElection).toHaveBeenCalledWith(1, "11");
      expect(votingRightToken.grantBatch).toHaveBeenCalledWith("11", addresses);
      expect(addGrantedVotingRights).toHaveBeenCalledWith("11", addresses);
      expect(res.body).toEqual({ success: true, txHash: "0xgrant" });
    });

    test("403, якщо користувач не організатор", async () => {
      const app = createAppWithUser({ id: 1, role: "organizer" });

      userOwnsElection.mockResolvedValue(false);

      const res = await request(app)
        .post("/organizer/elections/11/voters/grant")
        .send({ addresses })
        .expect(403);

      expect(votingRightToken.grantBatch).not.toHaveBeenCalled();
      expect(addGrantedVotingRights).not.toHaveBeenCalled();
      expect(res.body).toEqual({
        error: "You are not the organizer of this election",
      });
    });

    test("admin може керувати будь-якими виборами (userOwnsElection не викликається)", async () => {
      const app = createAppWithUser({ id: 99, role: "admin" });

      votingRightToken.grantBatch.mockResolvedValue({
        hash: "0xgrant",
        wait: jest.fn().mockResolvedValue({ blockNumber: 51 }),
      });

      const res = await request(app)
        .post("/organizer/elections/11/voters/grant")
        .send({ addresses })
        .expect(202);

      expect(userOwnsElection).not.toHaveBeenCalled();
      expect(votingRightToken.grantBatch).toHaveBeenCalled();
      expect(addGrantedVotingRights).toHaveBeenCalledWith("11", addresses);
      expect(res.body.success).toBe(true);
    });
  });

  describe("POST /organizer/elections/:id/voters/revoke", () => {
    test("успіх при ownership (202)", async () => {
      const app = createAppWithUser({ id: 1, role: "organizer" });

      userOwnsElection.mockResolvedValue(true);
      votingRightToken.revokeBatch.mockResolvedValue({
        hash: "0xrevoke",
        wait: jest.fn().mockResolvedValue({ blockNumber: 60 }),
      });

      const res = await request(app)
        .post("/organizer/elections/11/voters/revoke")
        .send({ addresses: ["0x1"] })
        .expect(202);

      expect(userOwnsElection).toHaveBeenCalledWith(1, "11");
      expect(votingRightToken.revokeBatch).toHaveBeenCalledWith("11", ["0x1"]);
      expect(addRevokedVotingRights).toHaveBeenCalledWith("11", ["0x1"]);
      expect(res.body).toEqual({ success: true, txHash: "0xrevoke" });
    });
  });

  describe("POST /organizer/elections/:id/finalize", () => {
    test("успіх при ownership (202)", async () => {
      const app = createAppWithUser({ id: 1, role: "organizer" });

      userOwnsElection.mockResolvedValue(true);
      electionManager.finalize.mockResolvedValue({
        hash: "0xfinal",
        wait: jest.fn().mockResolvedValue({ blockNumber: 70 }),
      });

      const res = await request(app)
        .post("/organizer/elections/11/finalize")
        .expect(202);

      expect(userOwnsElection).toHaveBeenCalledWith(1, "11");
      expect(electionManager.finalize).toHaveBeenCalledWith("11");
      expect(res.body).toEqual({ success: true, txHash: "0xfinal" });
    });

    test("403, якщо немає права", async () => {
      const app = createAppWithUser({ id: 1, role: "organizer" });

      userOwnsElection.mockResolvedValue(false);

      const res = await request(app)
        .post("/organizer/elections/11/finalize")
        .expect(403);

      expect(electionManager.finalize).not.toHaveBeenCalled();
      expect(res.body).toEqual({
        error: "You are not the organizer of this election",
      });
    });
  });

  describe("GET /organizer/my-elections", () => {
    test("повертає список виборів організатора", async () => {
      const app = createAppWithUser({ id: 5, role: "organizer" });

      const mockElections = [
        { Id: 1, Name: "E1" },
        { Id: 2, Name: "E2" },
      ];
      getElectionsForOrganizer.mockResolvedValue(mockElections);

      const res = await request(app)
        .get("/organizer/my-elections")
        .expect(200);

      expect(getElectionsForOrganizer).toHaveBeenCalledWith(5);
      expect(res.body).toEqual(mockElections);
    });

    test("401, якщо користувач не аутентифікований", async () => {
      const app = createAppWithoutUser();

      const res = await request(app)
        .get("/organizer/my-elections")
        .expect(401);

      expect(getElectionsForOrganizer).not.toHaveBeenCalled();
      expect(res.body).toEqual({ error: "Unauthorized" });
    });
  });
});
