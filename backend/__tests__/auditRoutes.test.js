const request = require("supertest");

const mockRequest = {
  input: jest.fn(),
  query: jest.fn(),
};

mockRequest.input.mockReturnValue(mockRequest);

const mockPool = {
  request: jest.fn(() => mockRequest),
};

jest.mock("../db", () => ({
  poolPromise: Promise.resolve(mockPool),
  sql: {
    Int: jest.fn(), 
    BigInt: jest.fn(),
  },
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
  mockRequest.input.mockClear();
  mockRequest.query.mockClear();
  mockPool.request.mockClear();
});

afterAll(() => {
  if (consoleErrorSpy) {
    consoleErrorSpy.mockRestore();
  }
});

describe("Audit routes", () => {
  describe("GET /audit (список логів з лімітом)", () => {
    test("без параметра limit використовує значення 100 і повертає записи", async () => {
      mockRequest.query.mockResolvedValue({
        recordset: [{ Id: 1 }, { Id: 2 }],
      });

      const res = await request(app).get("/audit");

      expect(mockPool.request).toHaveBeenCalled();
      expect(mockRequest.input).toHaveBeenCalledWith(
        "Limit",
        expect.anything(), // sql.Int
        100
      );
      expect(mockRequest.query).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual([{ Id: 1 }, { Id: 2 }]);
    });

    test("із параметром limit=5 використовує значення 5", async () => {
      mockRequest.query.mockResolvedValue({
        recordset: [{ Id: 10 }],
      });

      const res = await request(app).get("/audit?limit=5");

      expect(mockRequest.input).toHaveBeenCalledWith(
        "Limit",
        expect.anything(),
        5
      );
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual([{ Id: 10 }]);
    });

    test("при помилці БД повертає 500 і 'Internal server error'", async () => {
      mockRequest.query.mockRejectedValue(new Error("DB failed"));

      const res = await request(app).get("/audit");

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: "Internal server error" });
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls[0][0]).toContain("GET /audit error:");
    });
  });

  describe("GET /audit/election/:electionId", () => {
    test("з валідним electionId повертає записи для виборів", async () => {
      mockRequest.query.mockResolvedValue({
        recordset: [
          { Id: 1, BlockchainElectionId: 8 },
          { Id: 2, BlockchainElectionId: 8 },
        ],
      });

      const res = await request(app).get("/audit/election/8");

      expect(mockPool.request).toHaveBeenCalled();
      expect(mockRequest.input).toHaveBeenCalledWith(
        "ElectionId",
        expect.anything(), // sql.BigInt
        8
      );
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual([
        { Id: 1, BlockchainElectionId: 8 },
        { Id: 2, BlockchainElectionId: 8 },
      ]);
    });

    test("з нечисловим electionId повертає 400 'Invalid electionId' і не ходить у БД", async () => {
      const res = await request(app).get("/audit/election/abc");

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: "Invalid electionId" });

      expect(mockPool.request).not.toHaveBeenCalled();
      expect(mockRequest.query).not.toHaveBeenCalled();
    });

    test("при помилці БД повертає 500 і 'Internal server error'", async () => {
      mockRequest.query.mockRejectedValue(new Error("DB error"));

      const res = await request(app).get("/audit/election/5");

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: "Internal server error" });
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(
        consoleErrorSpy.mock.calls[0][0]
      ).toContain("GET /audit/election/:electionId error:");
    });
  });

  describe("GET /audit/export", () => {
    test("повертає count та items з усіх записів", async () => {
      const fakeRecords = [
        { Id: 1, EventType: "Commit" },
        { Id: 2, EventType: "Reveal" },
      ];

      mockRequest.query.mockResolvedValue({
        recordset: fakeRecords,
      });

      const res = await request(app).get("/audit/export");

      expect(mockPool.request).toHaveBeenCalled();
      expect(mockRequest.query).toHaveBeenCalledTimes(1);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        count: fakeRecords.length,
        items: fakeRecords,
      });
    });

    test("при помилці БД повертає 500 і 'Internal server error'", async () => {
      mockRequest.query.mockRejectedValue(new Error("Export failed"));

      const res = await request(app).get("/audit/export");

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: "Internal server error" });
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls[0][0]).toContain(
        "GET /audit/export error:"
      );
    });
  });
});
