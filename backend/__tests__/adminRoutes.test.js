const request = require("supertest");

const mockElectionManager = {
  createElection: jest.fn(),
  finalize: jest.fn(),
  target: "0xmanager",
};

const mockVotingRightToken = {
  grantBatch: jest.fn(),
  revokeBatch: jest.fn(),
  target: "0xtoken",
};

jest.mock("../services/contracts", () => ({
  electionManager: mockElectionManager,
  votingRightToken: mockVotingRightToken,
}));

jest.mock("../services/logger", () => ({
  logRequest: jest.fn(),
  logSecurityEvent: jest.fn(),
}));

jest.mock("../middleware/authAdmin", () => (req, res, next) => {
  req.user = { role: "admin" };
  next();
});

const { app } = require("../index");

let consoleErrorSpy;

beforeAll(() => {
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(() => {
  if (consoleErrorSpy) {
    consoleErrorSpy.mockRestore();
  }
});

describe("Admin routes", () => {
  describe("POST /admin/elections", () => {
    test("створює вибори, відправляє транзакцію та повертає 202 + txHash", async () => {
      const tx = {
        hash: "0xcreate",
        wait: jest.fn().mockResolvedValue({
          blockNumber: 123,
        }),
      };

      mockElectionManager.createElection.mockResolvedValue(tx);

      const body = {
        name: "Student Council Election",
        startTime: 1000,
        commitDeadline: 2000,
        revealDeadline: 3000,
        candidateIds: [1, 2, 3],
        gatingEnabled: true,
      };

      const res = await request(app).post("/admin/elections").send(body);

      expect(mockElectionManager.createElection).toHaveBeenCalledWith(
        body.name,
        body.startTime,
        body.commitDeadline,
        body.revealDeadline,
        body.candidateIds,
        body.gatingEnabled
      );
      expect(tx.wait).toHaveBeenCalled();

      expect(res.statusCode).toBe(202);
      expect(res.body).toEqual({
        success: true,
        message:
          "Election transaction sent. It will appear in the list after confirmation.",
        txHash: "0xcreate",
        contractAddress: "0xmanager",
        tokenAddress: "0xtoken",
      });
    });

    test("повертає 500, якщо createElection кидає помилку", async () => {
      mockElectionManager.createElection.mockRejectedValue(
        new Error("Create failed")
      );

      const body = {
        name: "Broken election",
        startTime: 1000,
        commitDeadline: 2000,
        revealDeadline: 3000,
        candidateIds: [1],
        gatingEnabled: false,
      };

      const res = await request(app).post("/admin/elections").send(body);

      expect(res.statusCode).toBe(500);
      expect(res.body).toHaveProperty("error", "Create failed");
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls[0][0]).toContain(
        "Error creating election:"
      );
    });
  });

  describe("POST /admin/elections/:id/voters/grant", () => {
    test("grantBatch викликається і повертається success + txHash (успішний сценарій)", async () => {
      const tx = {
        hash: "0xgrant",
        wait: jest.fn().mockResolvedValue({ blockNumber: 123 }),
      };

      mockVotingRightToken.grantBatch.mockResolvedValue(tx);

      const res = await request(app)
        .post("/admin/elections/1/voters/grant")
        .send({ addresses: ["0xAAA", "0xBBB"] });

      expect(mockVotingRightToken.grantBatch).toHaveBeenCalledWith("1", [
        "0xAAA",
        "0xBBB",
      ]);
      expect(tx.wait).toHaveBeenCalled();

      expect(res.statusCode).toBe(202);
      expect(res.body).toEqual({ success: true, txHash: "0xgrant" });
    });

    test("повертає 500, якщо grantBatch кидає помилку", async () => {
      mockVotingRightToken.grantBatch.mockRejectedValue(
        new Error("Grant failed")
      );

      const res = await request(app)
        .post("/admin/elections/1/voters/grant")
        .send({ addresses: ["0xAAA"] });

      expect(res.statusCode).toBe(500);
      expect(res.body).toHaveProperty("error", "Grant failed");
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls[0][0]).toContain(
        "Error granting voting rights:"
      );
    });
  });

  describe("POST /admin/elections/:id/voters/revoke", () => {
    test("revokeBatch викликається і повертається success + txHash (успішний сценарій)", async () => {
      const tx = {
        hash: "0xrevoke",
        wait: jest.fn().mockResolvedValue({ blockNumber: 321 }),
      };

      mockVotingRightToken.revokeBatch.mockResolvedValue(tx);

      const res = await request(app)
        .post("/admin/elections/1/voters/revoke")
        .send({ addresses: ["0xAAA", "0xBBB"] });

      expect(mockVotingRightToken.revokeBatch).toHaveBeenCalledWith("1", [
        "0xAAA",
        "0xBBB",
      ]);
      expect(tx.wait).toHaveBeenCalled();

      expect(res.statusCode).toBe(202);
      expect(res.body).toEqual({ success: true, txHash: "0xrevoke" });
    });

    test("повертає 500, якщо revokeBatch кидає помилку", async () => {
      mockVotingRightToken.revokeBatch.mockRejectedValue(
        new Error("Revoke failed")
      );

      const res = await request(app)
        .post("/admin/elections/1/voters/revoke")
        .send({ addresses: ["0xAAA"] });

      expect(res.statusCode).toBe(500);
      expect(res.body).toHaveProperty("error", "Revoke failed");
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls[0][0]).toContain(
        "Error revoking voting rights:"
      );
    });
  });

  describe("POST /admin/elections/:id/finalize", () => {
    test("finalize викликається і повертається success + txHash (успішний сценарій)", async () => {
      const tx = {
        hash: "0xfinal",
        wait: jest.fn().mockResolvedValue({ blockNumber: 999 }),
      };

      mockElectionManager.finalize.mockResolvedValue(tx);

      const res = await request(app).post("/admin/elections/10/finalize");

      expect(mockElectionManager.finalize).toHaveBeenCalledWith("10");
      expect(tx.wait).toHaveBeenCalled();

      expect(res.statusCode).toBe(202);
      expect(res.body).toEqual({ success: true, txHash: "0xfinal" });
    });

    test("повертає 500, якщо finalize кидає помилку", async () => {
      mockElectionManager.finalize.mockRejectedValue(
        new Error("Finalize failed")
      );

      const res = await request(app).post("/admin/elections/10/finalize");

      expect(res.statusCode).toBe(500);
      expect(res.body).toHaveProperty("error", "Finalize failed");
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls[0][0]).toContain(
        "Error finalizing election:"
      );
    });
  });
});
і