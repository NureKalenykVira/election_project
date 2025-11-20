const request = require("supertest");

const mockRequest = {
  input: jest.fn(),
  query: jest.fn(),
};
mockRequest.input.mockReturnValue(mockRequest);

const mockPool = {
  request: jest.fn(() => mockRequest),
};

const mockTx = {
  begin: jest.fn(),
  commit: jest.fn(),
  rollback: jest.fn(),
};

const mockRequestTx = {
  input: jest.fn(),
  query: jest.fn(),
};
mockRequestTx.input.mockReturnValue(mockRequestTx);

jest.mock("../db", () => ({
  poolPromise: Promise.resolve(mockPool),
  sql: {
    Int: jest.fn(),
    BigInt: jest.fn(),
    NVarChar: jest.fn(), 
    Float: jest.fn(),
    MAX: -1,
    Transaction: jest.fn(() => mockTx),
    Request: jest.fn(() => mockRequestTx),
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
  mockRequest.input.mockClear();
  mockRequest.query.mockClear();
  mockPool.request.mockClear();

  mockTx.begin.mockClear();
  mockTx.commit.mockClear();
  mockTx.rollback.mockClear();

  mockRequestTx.input.mockClear();
  mockRequestTx.query.mockClear();

  if (consoleErrorSpy) {
    consoleErrorSpy.mockClear();
  }
});

afterAll(() => {
  if (consoleErrorSpy) {
    consoleErrorSpy.mockRestore();
  }
});

describe("ML anomalies routes", () => {
  describe("GET /ml/anomalies", () => {
    test("без фільтрів повертає список аномалій", async () => {
      const fakeRecords = [
        { Id: 1, DetectionMethod: "IsolationForest" },
        { Id: 2, DetectionMethod: "KMeans" },
      ];

      mockRequest.query.mockResolvedValue({ recordset: fakeRecords });

      const res = await request(app).get("/ml/anomalies");

      expect(mockPool.request).toHaveBeenCalled();
      expect(mockRequest.input).not.toHaveBeenCalled(); // без electionId/method
      expect(mockRequest.query).toHaveBeenCalledTimes(1);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(fakeRecords);
    });

    test("із electionId і method додає відповідні параметри в запит", async () => {
      const fakeRecords = [{ Id: 10, DetectionMethod: "IsolationForest" }];
      mockRequest.query.mockResolvedValue({ recordset: fakeRecords });

      const res = await request(app).get(
        "/ml/anomalies?electionId=8&method=IsolationForest"
      );

      expect(mockRequest.input).toHaveBeenCalledWith(
        "ElectionId",
        expect.anything(), // sql.BigInt(...)
        8
      );

      const methodCall = mockRequest.input.mock.calls.find(
        (c) => c[0] === "Method"
      );
      expect(methodCall).toBeDefined();
      expect(methodCall[0]).toBe("Method");
      expect(methodCall[2]).toBe("IsolationForest");

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(fakeRecords);
    });

    test("при помилці БД повертає 500 і Internal server error", async () => {
      mockRequest.query.mockRejectedValue(new Error("DB fail"));

      const res = await request(app).get("/ml/anomalies");

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: "Internal server error" });
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(
        consoleErrorSpy.mock.calls.map((c) => String(c[0])).some((m) =>
          m.includes("GET /ml/anomalies error:")
        )
      ).toBe(true);
    });
  });

  describe("POST /ml/anomalies", () => {
    test("якщо items[] відсутній або порожній — 400", async () => {
      const res = await request(app)
        .post("/ml/anomalies")
        .send({}); // items немає

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: "items[] is required" });
      expect(mockTx.begin).not.toHaveBeenCalled();
      expect(mockRequestTx.query).not.toHaveBeenCalled();
    });

    test("успішне вставлення одного елемента, викликає begin/commit і INSERT", async () => {
      mockTx.begin.mockResolvedValue();
      mockTx.commit.mockResolvedValue();
      mockRequestTx.query.mockResolvedValue({});

      const item = {
        auditLogId: 15,
        detectionMethod: "IsolationForest",
        score: 0.97,
        label: "anomaly",
        details: { reason: "too many commits" },
      };

      const res = await request(app)
        .post("/ml/anomalies")
        .send({ items: [item] });

      expect(mockTx.begin).toHaveBeenCalledTimes(1);
      expect(mockTx.commit).toHaveBeenCalledTimes(1);
      expect(mockTx.rollback).not.toHaveBeenCalled();

      const calls = mockRequestTx.input.mock.calls;

      const auditCall = calls.find((c) => c[0] === "AuditLogId");
      expect(auditCall[2]).toBe(15);

      const modelCall = calls.find((c) => c[0] === "Model");
      expect(modelCall).toBeDefined();
      expect(modelCall[2]).toBe("IsolationForest");

      const scoreCall = calls.find((c) => c[0] === "Score");
      expect(scoreCall[2]).toBe(0.97);

      const labelCall = calls.find((c) => c[0] === "Label");
      expect(labelCall[2]).toBe("anomaly");

      const detailsCall = calls.find((c) => c[0] === "Details");
      expect(detailsCall[2]).toBe(JSON.stringify(item.details));

      expect(mockRequestTx.query).toHaveBeenCalledTimes(1);

      expect(res.statusCode).toBe(201);
      expect(res.body).toEqual({ inserted: 1 });
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    test("якщо елемент не містить обовʼязкових полів — rollback і 500", async () => {
      mockTx.begin.mockResolvedValue();
      mockTx.rollback.mockResolvedValue();

      const badItem = {
        // auditLogId відсутній
        detectionMethod: null,
        label: null,
      };

      const res = await request(app)
        .post("/ml/anomalies")
        .send({ items: [badItem] });

      expect(mockTx.begin).toHaveBeenCalledTimes(1);
      expect(mockTx.rollback).toHaveBeenCalledTimes(1);
      expect(mockTx.commit).not.toHaveBeenCalled();
      expect(mockRequestTx.query).not.toHaveBeenCalled();

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: "Internal server error" });
      expect(consoleErrorSpy).toHaveBeenCalled();

      const msgs = consoleErrorSpy.mock.calls.map((c) => String(c[0]));
      expect(
        msgs.some((m) => m.includes("POST /ml/anomalies tx error:"))
      ).toBe(true);
    });

    test("якщо INSERT падає — rollback і 500", async () => {
      mockTx.begin.mockResolvedValue();
      mockTx.rollback.mockResolvedValue();
      mockRequestTx.query.mockRejectedValue(new Error("Insert failed"));

      const item = {
        auditLogId: 20,
        detectionMethod: "KMeans",
        score: 0.1,
        label: "normal",
        details: { cluster: 1 },
      };

      const res = await request(app)
        .post("/ml/anomalies")
        .send({ items: [item] });

      expect(mockTx.begin).toHaveBeenCalledTimes(1);
      expect(mockTx.rollback).toHaveBeenCalledTimes(1);
      expect(mockTx.commit).not.toHaveBeenCalled();
      expect(mockRequestTx.query).toHaveBeenCalledTimes(1);

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: "Internal server error" });
      expect(consoleErrorSpy).toHaveBeenCalled();

      const msgs = consoleErrorSpy.mock.calls.map((c) => String(c[0]));
      expect(
        msgs.some((m) => m.includes("POST /ml/anomalies tx error:"))
      ).toBe(true);
    });
  });
});
