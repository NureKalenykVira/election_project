const request = require("supertest");
const dotenv = require("dotenv");

dotenv.config();

jest.mock("../services/logger", () => ({
  logRequest: jest.fn(),
  logError: jest.fn(),
  logSecurityEvent: jest.fn(),
}));

jest.mock("../services/eventListener", () => ({
  startEventListeners: jest.fn(),
}));

const mockElectionManager = {
  commitVote: jest.fn(),
  revealVote: jest.fn(),
};

jest.mock("../services/contracts", () => ({
  electionManager: mockElectionManager,
}));

const { electionManager } = require("../services/contracts");
const { app } = require("../index");

let consoleErrorSpy;

beforeAll(() => {
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});

beforeEach(() => {
  if (consoleErrorSpy) {
    consoleErrorSpy.mockClear();
  }
});

afterAll(() => {
  if (consoleErrorSpy) {
    consoleErrorSpy.mockRestore();
  }
});

describe("Vote routes (commit/reveal)", () => {
  beforeAll(() => {
    process.env.CHAIN_ID = process.env.CHAIN_ID || "1337";
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // POST /vote/commit

  test("POST /vote/commit — 400, якщо не передано electionId", async () => {
    const res = await request(app)
      .post("/vote/commit")
      .send({ commitHash: "0xHASH" });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty(
      "error",
      "electionId and commitHash are required"
    );
    expect(electionManager.commitVote).not.toHaveBeenCalled();
  });

  test("POST /vote/commit — 400, якщо не передано commitHash", async () => {
    const res = await request(app)
      .post("/vote/commit")
      .send({ electionId: "1" });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty(
      "error",
      "electionId and commitHash are required"
    );
    expect(electionManager.commitVote).not.toHaveBeenCalled();
  });

  test("POST /vote/commit — 200, успіх: викликає commitVote і повертає txHash", async () => {
    const mockTx = {
      wait: jest.fn().mockResolvedValue({ hash: "0xcommit" }),
    };
    electionManager.commitVote.mockResolvedValue(mockTx);

    const body = { electionId: "1", commitHash: "0xHASH" };

    const res = await request(app).post("/vote/commit").send(body);

    expect(electionManager.commitVote).toHaveBeenCalledWith(
      "1",
      "0xHASH"
    );
    expect(mockTx.wait).toHaveBeenCalledTimes(1);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      txHash: "0xcommit",
    });
  });

  test("POST /vote/commit — 500, якщо commitVote кидає помилку", async () => {
    electionManager.commitVote.mockRejectedValue(
      new Error("Commit failed")
    );

    const res = await request(app)
      .post("/vote/commit")
      .send({ electionId: "1", commitHash: "0xHASH" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toHaveProperty("error", "Commit failed");
  });

  test("POST /vote/commit — 500, якщо tx.wait кидає помилку", async () => {
    const mockTx = {
      wait: jest.fn().mockRejectedValue(new Error("Wait failed")),
    };
    electionManager.commitVote.mockResolvedValue(mockTx);

    const res = await request(app)
      .post("/vote/commit")
      .send({ electionId: "1", commitHash: "0xHASH" });

    expect(electionManager.commitVote).toHaveBeenCalledWith(
      "1",
      "0xHASH"
    );
    expect(mockTx.wait).toHaveBeenCalledTimes(1);

    expect(res.statusCode).toBe(500);
    expect(res.body).toHaveProperty("error", "Wait failed");
  });

  // POST /vote/reveal

  test("POST /vote/reveal — 400, якщо не передано electionId", async () => {
    const res = await request(app)
      .post("/vote/reveal")
      .send({ candidateId: "2", salt: "secret" });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty(
      "error",
      "electionId, candidateId, and salt are required"
    );
    expect(electionManager.revealVote).not.toHaveBeenCalled();
  });

  test("POST /vote/reveal — 400, якщо не передано candidateId", async () => {
    const res = await request(app)
      .post("/vote/reveal")
      .send({ electionId: "1", salt: "secret" });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty(
      "error",
      "electionId, candidateId, and salt are required"
    );
    expect(electionManager.revealVote).not.toHaveBeenCalled();
  });

  test("POST /vote/reveal — 400, якщо не передано salt", async () => {
    const res = await request(app)
      .post("/vote/reveal")
      .send({ electionId: "1", candidateId: "2" });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty(
      "error",
      "electionId, candidateId, and salt are required"
    );
    expect(electionManager.revealVote).not.toHaveBeenCalled();
  });

  test("POST /vote/reveal — 200, успіх: викликає revealVote і повертає txHash", async () => {
    const mockTx = {
      wait: jest.fn().mockResolvedValue({ hash: "0xreveal" }),
    };
    electionManager.revealVote.mockResolvedValue(mockTx);

    const body = {
      electionId: "1",
      candidateId: "2",
      salt: "secret",
    };

    const res = await request(app).post("/vote/reveal").send(body);

    expect(electionManager.revealVote).toHaveBeenCalledWith(
      "1",
      "2",
      "secret"
    );
    expect(mockTx.wait).toHaveBeenCalledTimes(1);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      txHash: "0xreveal",
    });
  });

  test("POST /vote/reveal — 500, якщо revealVote кидає помилку", async () => {
    electionManager.revealVote.mockRejectedValue(
      new Error("Reveal failed")
    );

    const res = await request(app)
      .post("/vote/reveal")
      .send({ electionId: "1", candidateId: "2", salt: "secret" });

    expect(res.statusCode).toBe(500);
    expect(res.body).toHaveProperty("error", "Reveal failed");
  });

  test("POST /vote/reveal — 500, якщо tx.wait кидає помилку", async () => {
    const mockTx = {
      wait: jest.fn().mockRejectedValue(new Error("Wait failed")),
    };
    electionManager.revealVote.mockResolvedValue(mockTx);

    const res = await request(app)
      .post("/vote/reveal")
      .send({ electionId: "1", candidateId: "2", salt: "secret" });

    expect(electionManager.revealVote).toHaveBeenCalledWith(
      "1",
      "2",
      "secret"
    );
    expect(mockTx.wait).toHaveBeenCalledTimes(1);

    expect(res.statusCode).toBe(500);
    expect(res.body).toHaveProperty("error", "Wait failed");
  });
});
