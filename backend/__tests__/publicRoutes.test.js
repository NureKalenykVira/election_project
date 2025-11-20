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
  getTimes: jest.fn(),
  getCandidateIds: jest.fn(),
  elections: jest.fn(),
  getTally: jest.fn(),
  commits: jest.fn(),
  revealed: jest.fn(),
};

const mockVotingRightToken = {
  hasRight: jest.fn(),
};

jest.mock("../services/contracts", () => ({
  electionManager: mockElectionManager,
  votingRightToken: mockVotingRightToken,
}));

const { electionManager, votingRightToken } = require("../services/contracts");
const { app } = require("../index");

describe("Public routes (читання стану виборів)", () => {
  let consoleErrorSpy;

  beforeAll(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    process.env.CHAIN_ID = process.env.CHAIN_ID || "1337";
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // 1) GET /elections/:id

  test("GET /elections/:id — повертає інформацію про вибори (200)", async () => {
    electionManager.getTimes.mockResolvedValue([1000, 2000, 3000, false]);
    electionManager.getCandidateIds.mockResolvedValue([1, 2, 3]);
    electionManager.elections.mockResolvedValue({
      name: "Test election",
      gatingEnabled: true,
    });

    const res = await request(app).get("/elections/1");

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      id: "1",
      name: "Test election",
      startTime: 1000,
      commitDeadline: 2000,
      revealDeadline: 3000,
      finalized: false,
      gatingEnabled: true,
    });
    expect(res.body.candidateIds).toEqual([1, 2, 3]);

    expect(electionManager.getTimes).toHaveBeenCalledWith("1");
    expect(electionManager.getCandidateIds).toHaveBeenCalledWith("1");
    expect(electionManager.elections).toHaveBeenCalledWith("1");
  });

  test("GET /elections/:id — 500, якщо getTimes кидає помилку", async () => {
    electionManager.getTimes.mockRejectedValue(new Error("No such election"));

    const res = await request(app).get("/elections/999");

    expect(res.statusCode).toBe(500);
    expect(res.body).toHaveProperty("error", "No such election");
  });

  // 2) GET /elections/:id/tally

  test("GET /elections/:id/tally — повертає об'єкт results (200)", async () => {
    electionManager.getCandidateIds.mockResolvedValue([1, 2]);
    electionManager.getTally
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(7);

    const res = await request(app).get("/elections/1/tally");

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      "1": 5,
      "2": 7,
    });

    expect(electionManager.getCandidateIds).toHaveBeenCalledWith("1");
    expect(electionManager.getTally).toHaveBeenCalledTimes(2);
    expect(electionManager.getTally).toHaveBeenNthCalledWith(1, "1", 1);
    expect(electionManager.getTally).toHaveBeenNthCalledWith(2, "1", 2);
  });

  test("GET /elections/:id/tally — 500, якщо getCandidateIds падає", async () => {
    electionManager.getCandidateIds.mockRejectedValue(
      new Error("Candidates error")
    );

    const res = await request(app).get("/elections/1/tally");

    expect(res.statusCode).toBe(500);
    expect(res.body).toHaveProperty("error", "Candidates error");
  });

  // 3) GET /elections/:id/voter/:address

  test("GET /elections/:id/voter/:address — hasRight = true", async () => {
    votingRightToken.hasRight.mockResolvedValue(true);

    const res = await request(app).get(
      "/elections/1/voter/0x1234567890abcdef"
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      address: "0x1234567890abcdef",
      hasRight: true,
    });

    expect(votingRightToken.hasRight).toHaveBeenCalledWith(
      "0x1234567890abcdef",
      "1"
    );
  });

  test("GET /elections/:id/voter/:address — hasRight = false", async () => {
    votingRightToken.hasRight.mockResolvedValue(false);

    const res = await request(app).get(
      "/elections/1/voter/0xABCDEFabcdef0000"
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      address: "0xABCDEFabcdef0000",
      hasRight: false,
    });
  });

  test("GET /elections/:id/voter/:address — 500, якщо hasRight падає", async () => {
    votingRightToken.hasRight.mockRejectedValue(new Error("RPC error"));

    const res = await request(app).get("/elections/1/voter/0xERR");

    expect(res.statusCode).toBe(500);
    expect(res.body).toHaveProperty("error", "RPC error");
  });

  // 4) GET /elections/:id/times

  test("GET /elections/:id/times — повертає строки з часовими межами (200)", async () => {
    electionManager.getTimes.mockResolvedValue([
      1111,
      2222,
      3333,
      true,
    ]);

    const res = await request(app).get("/elections/1/times");

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      startTime: "1111",
      commitDeadline: "2222",
      revealDeadline: "3333",
      finalized: true,
    });

    expect(electionManager.getTimes).toHaveBeenCalledWith("1");
  });

  test("GET /elections/:id/times — 500, якщо getTimes падає", async () => {
    electionManager.getTimes.mockRejectedValue(new Error("Times error"));

    const res = await request(app).get("/elections/1/times");

    expect(res.statusCode).toBe(500);
    expect(res.body).toHaveProperty("error", "Times error");
  });

  // 5) GET /elections/:id/candidates

  test("GET /elections/:id/candidates — повертає candidateIds як строки (200)", async () => {
    electionManager.getCandidateIds.mockResolvedValue([1, 2, 3]);

    const res = await request(app).get("/elections/1/candidates");

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      candidateIds: ["1", "2", "3"],
    });

    expect(electionManager.getCandidateIds).toHaveBeenCalledWith("1");
  });

  test("GET /elections/:id/candidates — 500, якщо getCandidateIds падає", async () => {
    electionManager.getCandidateIds.mockRejectedValue(
      new Error("Candidates error")
    );

    const res = await request(app).get("/elections/1/candidates");

    expect(res.statusCode).toBe(500);
    expect(res.body).toHaveProperty("error", "Candidates error");
  });

  // 6) GET /elections/:id/tally/:candidateId

  test("GET /elections/:id/tally/:candidateId — повертає votes як строку (200)", async () => {
    electionManager.getTally.mockResolvedValue(42);

    const res = await request(app).get("/elections/1/tally/7");

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ votes: "42" });

    expect(electionManager.getTally).toHaveBeenCalledWith("1", "7");
  });

  test("GET /elections/:id/tally/:candidateId — 500, якщо getTally падає", async () => {
    electionManager.getTally.mockRejectedValue(new Error("Tally error"));

    const res = await request(app).get("/elections/1/tally/7");

    expect(res.statusCode).toBe(500);
    expect(res.body).toHaveProperty("error", "Tally error");
  });

  // 7) GET /elections/:id/status

  test("GET /elections/:id/status — повертає electionId та finalized (200)", async () => {
    electionManager.getTimes.mockResolvedValue([
      1111,
      2222,
      3333,
      true,
    ]);

    const res = await request(app).get("/elections/1/status");

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      electionId: "1",
      finalized: true,
    });

    expect(electionManager.getTimes).toHaveBeenCalledWith("1");
  });

  test("GET /elections/:id/status — 500, якщо getTimes падає", async () => {
    electionManager.getTimes.mockRejectedValue(new Error("Status error"));

    const res = await request(app).get("/elections/1/status");

    expect(res.statusCode).toBe(500);
    expect(res.body).toHaveProperty("error", "Status error");
  });

  // 8) GET /elections/:id/committed/:address

  test("GET /elections/:id/committed/:address — committed = true, якщо хеш не нульовий (200)", async () => {
    electionManager.commits.mockResolvedValue(
      "0x1230000000000000000000000000000000000000000000000000000000000000"
    );

    const res = await request(app).get(
      "/elections/1/committed/0x1234567890abcdef"
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      address: "0x1234567890abcdef",
      electionId: "1",
      committed: true,
    });

    expect(electionManager.commits).toHaveBeenCalledWith(
      "1",
      "0x1234567890abcdef"
    );
  });

  test("GET /elections/:id/committed/:address — committed = false, якщо нульовий хеш", async () => {
    electionManager.commits.mockResolvedValue(
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    );

    const res = await request(app).get(
      "/elections/1/committed/0x0000000000000000000000000000000000000000"
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      address: "0x0000000000000000000000000000000000000000",
      electionId: "1",
      committed: false,
    });
  });

  test("GET /elections/:id/committed/:address — 500, якщо commits падає", async () => {
    electionManager.commits.mockRejectedValue(new Error("Commit error"));

    const res = await request(app).get("/elections/1/committed/0xERR");

    expect(res.statusCode).toBe(500);
    expect(res.body).toHaveProperty("error", "Commit error");
  });

  // 9) GET /elections/:id/revealed/:address

  test("GET /elections/:id/revealed/:address — revealed = true (200)", async () => {
    electionManager.revealed.mockResolvedValue(true);

    const res = await request(app).get(
      "/elections/1/revealed/0x1234567890abcdef"
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      address: "0x1234567890abcdef",
      electionId: "1",
      revealed: true,
    });

    expect(electionManager.revealed).toHaveBeenCalledWith(
      "1",
      "0x1234567890abcdef"
    );
  });

  test("GET /elections/:id/revealed/:address — revealed = false (200)", async () => {
    electionManager.revealed.mockResolvedValue(false);

    const res = await request(app).get(
      "/elections/1/revealed/0xABCDEFabcdef0000"
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      address: "0xABCDEFabcdef0000",
      electionId: "1",
      revealed: false,
    });
  });

  test("GET /elections/:id/revealed/:address — 500, якщо revealed падає", async () => {
    electionManager.revealed.mockRejectedValue(new Error("Reveal error"));

    const res = await request(app).get("/elections/1/revealed/0xERR");

    expect(res.statusCode).toBe(500);
    expect(res.body).toHaveProperty("error", "Reveal error");
  });
});
