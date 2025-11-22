const request = require("supertest");
const express = require("express");

jest.mock("../services/contracts", () => ({
  electionManager: {
    createElection: jest.fn(),
    finalize: jest.fn(),
  },
  votingRightToken: {
    grantBatch: jest.fn(),
    revokeBatch: jest.fn(),
  },
}));

jest.mock("../services/elections", () => ({
  createOffchainElection: jest.fn(),
  userOwnsElection: jest.fn(),
  getElectionsForOrganizer: jest.fn(),
}));

const organizerRouter = require("../routes/organizer");
const { electionManager, votingRightToken } = require("../services/contracts");
const {
  createOffchainElection,
  userOwnsElection,
  getElectionsForOrganizer,
} = require("../services/elections");

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
    consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {}); // щоб не засмічувати вивід тестів
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

    test("створює вибори ончейн і офчейн, повертає success", async () => {
      const app = createAppWithUser({ id: 1, role: "organizer" });

      const receipt = {
        hash: "0xtxhash",
        logs: [
          {
            fragment: { name: "ElectionCreated" },
            args: { id: 11n },
          },
        ],
      };

      const waitMock = jest.fn().mockResolvedValue(receipt);
      electionManager.createElection.mockResolvedValue({ wait: waitMock });

      const res = await request(app)
        .post("/organizer/elections")
        .send(body)
        .expect(200);

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
        blockchainElectionId: 11,
        organizerUserId: 1,
        name: body.name,
        startTime: body.startTime,
        commitDeadline: body.commitDeadline,
        revealDeadline: body.revealDeadline,
        gatingEnabled: body.gatingEnabled,
      });

      expect(res.body).toEqual({
        success: true,
        electionId: "11",
        txHash: receipt.hash,
        contractAddress: electionManager.target,
        tokenAddress: votingRightToken.target,
        organizerId: 1,
      });
    });

    test("якщо немає події ElectionCreated — офчейн не викликається, але 200", async () => {
      const app = createAppWithUser({ id: 1, role: "organizer" });

      const receipt = {
        hash: "0xtxhash",
        logs: [], // без події
      };

      electionManager.createElection.mockResolvedValue({
        wait: jest.fn().mockResolvedValue(receipt),
      });

      const res = await request(app)
        .post("/organizer/elections")
        .send(body)
        .expect(200);

      expect(createOffchainElection).not.toHaveBeenCalled();
      expect(res.body.success).toBe(true);
      expect(res.body.electionId).toBe("unknown");
    });

    test("якщо createOffchainElection падає — запит все одно 200", async () => {
      const app = createAppWithUser({ id: 1, role: "organizer" });

      const receipt = {
        hash: "0xtxhash",
        logs: [
          {
            fragment: { name: "ElectionCreated" },
            args: { id: 11n },
          },
        ],
      };

      electionManager.createElection.mockResolvedValue({
        wait: jest.fn().mockResolvedValue(receipt),
      });

      createOffchainElection.mockRejectedValue(new Error("DB error"));

      const res = await request(app)
        .post("/organizer/elections")
        .send(body)
        .expect(200);

      expect(createOffchainElection).toHaveBeenCalled();
      expect(res.body.success).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    test("якщо electionManager.createElection падає — повертається 500", async () => {
      const app = createAppWithUser({ id: 1, role: "organizer" });

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

    test("успіх, коли користувач є організатором", async () => {
      const app = createAppWithUser({ id: 1, role: "organizer" });

      userOwnsElection.mockResolvedValue(true);
      votingRightToken.grantBatch.mockResolvedValue({
        wait: jest.fn().mockResolvedValue({ hash: "0xgrant" }),
      });

      const res = await request(app)
        .post("/organizer/elections/11/voters/grant")
        .send({ addresses })
        .expect(200);

      expect(userOwnsElection).toHaveBeenCalledWith(1, "11");
      expect(votingRightToken.grantBatch).toHaveBeenCalledWith("11", addresses);
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
      expect(res.body).toEqual({
        error: "You are not the organizer of this election",
      });
    });

    test("admin може керувати будь-якими виборами (userOwnsElection не викликається)", async () => {
      const app = createAppWithUser({ id: 99, role: "admin" });

      votingRightToken.grantBatch.mockResolvedValue({
        wait: jest.fn().mockResolvedValue({ hash: "0xgrant" }),
      });

      const res = await request(app)
        .post("/organizer/elections/11/voters/grant")
        .send({ addresses })
        .expect(200);

      expect(userOwnsElection).not.toHaveBeenCalled();
      expect(votingRightToken.grantBatch).toHaveBeenCalled();
      expect(res.body.success).toBe(true);
    });
  });

  describe("POST /organizer/elections/:id/voters/revoke", () => {
    test("успіх при ownership", async () => {
      const app = createAppWithUser({ id: 1, role: "organizer" });

      userOwnsElection.mockResolvedValue(true);
      votingRightToken.revokeBatch.mockResolvedValue({
        wait: jest.fn().mockResolvedValue({ hash: "0xrevoke" }),
      });

      const res = await request(app)
        .post("/organizer/elections/11/voters/revoke")
        .send({ addresses: ["0x1"] })
        .expect(200);

      expect(userOwnsElection).toHaveBeenCalledWith(1, "11");
      expect(votingRightToken.revokeBatch).toHaveBeenCalledWith("11", [
        "0x1",
      ]);
      expect(res.body).toEqual({ success: true, txHash: "0xrevoke" });
    });
  });

  describe("POST /organizer/elections/:id/finalize", () => {
    test("успіх при ownership", async () => {
      const app = createAppWithUser({ id: 1, role: "organizer" });

      userOwnsElection.mockResolvedValue(true);
      electionManager.finalize.mockResolvedValue({
        wait: jest.fn().mockResolvedValue({ hash: "0xfinal" }),
      });

      const res = await request(app)
        .post("/organizer/elections/11/finalize")
        .expect(200);

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
