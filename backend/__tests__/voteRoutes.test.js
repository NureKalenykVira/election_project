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

jest.mock("../middleware/authUser", () => {
  const mockAuthUser = (req, res, next) => {
    req.user = {
      id: 123,
      role: "voter",
      email: "test@example.com",
    };
    next();
  };

  mockAuthUser.requireRole = () => (req, res, next) => next();

  return mockAuthUser;
});

jest.mock("../middleware/requireRole", () => ({
  requireRole: () => (req, res, next) => next(),
}));

const { app } = require("../index");

describe("Vote routes (commit-hash / verify)", () => {
  beforeAll(() => {
    process.env.CHAIN_ID = process.env.CHAIN_ID || "1337";
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // POST /vote/commit-hash
  test("POST /vote/commit-hash — 400, якщо не передано обов'язкові поля", async () => {
    const res = await request(app).post("/vote/commit-hash").send({});

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  test("POST /vote/commit-hash — 200, успіх: повертає success та commitHash", async () => {
    const body = {
      electionId: 15,
      candidateId: 1,
      salt: "secret_salt",
    };

    const res = await request(app).post("/vote/commit-hash").send(body);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.commitHash).toBe("string");
    expect(res.body.commitHash.startsWith("0x")).toBe(true);
  });

  // POST /vote/verify
  test("POST /vote/verify — 400, якщо не передано обов'язкові поля", async () => {
    const res = await request(app).post("/vote/verify").send({});

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  test("POST /vote/verify — 200, matches = true, якщо commitHash відповідає параметрам", async () => {
    const body = {
      electionId: 15,
      candidateId: 1,
      salt: "secret_salt",
    };

    const commitRes = await request(app)
      .post("/vote/commit-hash")
      .send(body)
      .expect(200);

    const { commitHash } = commitRes.body;

    const verifyRes = await request(app)
      .post("/vote/verify")
      .send({ ...body, commitHash });

    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.body.success).toBe(true);
    expect(verifyRes.body.matches).toBe(true);
  });

  test("POST /vote/verify — 200, matches = false, якщо commitHash не відповідає параметрам", async () => {
    const correctBody = {
      electionId: 15,
      candidateId: 1,
      salt: "secret_salt",
    };

    const wrongBody = {
      electionId: 15,
      candidateId: 2, 
      salt: "secret_salt",
    };

    const commitRes = await request(app)
      .post("/vote/commit-hash")
      .send(correctBody)
      .expect(200);

    const { commitHash } = commitRes.body;

    const verifyRes = await request(app)
      .post("/vote/verify")
      .send({ ...wrongBody, commitHash });

    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.body.success).toBe(true);
    expect(verifyRes.body.matches).toBe(false);
  });
});
