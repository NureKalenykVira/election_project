jest.mock("../db", () => {
  const mockRequest = {
    input: jest.fn().mockReturnThis(),
    query: jest.fn(),
  };

  const mockPool = {
    request: jest.fn(() => mockRequest),
  };

  return {
    poolPromise: Promise.resolve(mockPool),
    sql: {
      NVarChar: jest.fn(),
      BigInt: jest.fn(),
    },
    __mock: {
      mockPool,
      mockRequest,
    },
  };
});

const request = require("supertest");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { app } = require("../index");
const { __mock } = require("../db");

const { mockRequest } = __mock;

describe("Auth routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("POST /auth/register – створює нового користувача", async () => {
    mockRequest.query
      .mockResolvedValueOnce({ recordset: [] }) // SELECT Users WHERE Email
      .mockResolvedValueOnce({
        recordset: [
          {
            Id: 1,
            Email: "test@example.com",
            Role: "voter",
            WalletAddress: "0xABC",
          },
        ],
      });

    const res = await request(app)
      .post("/auth/register")
      .send({
        email: "test@example.com",
        password: "secret123",
        walletAddress: "0xABC",
      });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty("token");
    expect(res.body.user).toEqual(
      expect.objectContaining({
        id: 1,
        email: "test@example.com",
        role: "voter",
        walletAddress: "0xABC",
      })
    );

    expect(mockRequest.query).toHaveBeenCalledTimes(2);
  });

  test("POST /auth/login – повертає токен при правильному паролі", async () => {
    const passwordHash = await bcrypt.hash("secret123", 10);

    mockRequest.query.mockResolvedValueOnce({
      recordset: [
        {
          Id: 1,
          Email: "test@example.com",
          Role: "voter",
          WalletAddress: null,
          PasswordHash: passwordHash,
        },
      ],
    });

    const res = await request(app)
      .post("/auth/login")
      .send({
        email: "test@example.com",
        password: "secret123",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("token");
    expect(res.body.user).toEqual(
      expect.objectContaining({
        id: 1,
        email: "test@example.com",
        role: "voter",
      })
    );
  });

  test("GET /auth/me – 401 без токена", async () => {
    const res = await request(app).get("/auth/me");

    expect(res.statusCode).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  test("GET /auth/me – повертає користувача при валідному токені", async () => {
    const verifySpy = jest
      .spyOn(jwt, "verify")
      .mockReturnValue({
        sub: 1,
        role: "voter",
        email: "test@example.com",
        walletAddress: null,
      });

    mockRequest.query.mockResolvedValueOnce({
      recordset: [
        {
          Id: 1,
          Email: "test@example.com",
          Role: "voter",
          WalletAddress: null,
          CreatedAt: "2025-01-01T00:00:00Z",
          UpdatedAt: "2025-01-01T00:00:00Z",
        },
      ],
    });

    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", "Bearer fake.jwt.token");

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        id: 1,
        email: "test@example.com",
        role: "voter",
      })
    );

    verifySpy.mockRestore();
  });
});