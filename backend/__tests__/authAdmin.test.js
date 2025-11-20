jest.mock("../services/logger", () => ({
  logSecurityEvent: jest.fn(),
  logRequest: jest.fn(),
}));

const { logSecurityEvent } = require("../services/logger");
const authAdmin = require("../middleware/authAdmin");

describe("authAdmin middleware", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, ADMIN_API_KEY: "test-admin-key" };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  function makeRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  }

  test("повертає 401, якщо заголовок x-admin-token відсутній", () => {
    const req = {
      header: jest.fn().mockReturnValue(undefined),
      ip: "127.0.0.1",
      originalUrl: "/admin/elections",
    };
    const res = makeRes();
    const next = jest.fn();

    authAdmin(req, res, next);

    expect(req.header).toHaveBeenCalledWith("x-admin-token");
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Unauthorized: admin token is missing or invalid",
    });
    expect(next).not.toHaveBeenCalled();

    expect(logSecurityEvent).toHaveBeenCalledTimes(1);
    const arg = logSecurityEvent.mock.calls[0][0];
    expect(arg).toMatchObject({
      message: "Invalid or missing admin token",
      statusCode: 401,
      path: "/admin/elections",
    });
  });

  test("повертає 401, якщо токен невірний", () => {
    const req = {
      header: jest.fn().mockReturnValue("wrong-key"),
      ip: "10.0.0.5",
      originalUrl: "/admin/elections/1",
    };
    const res = makeRes();
    const next = jest.fn();

    authAdmin(req, res, next);

    expect(req.header).toHaveBeenCalledWith("x-admin-token");
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Unauthorized: admin token is missing or invalid",
    });
    expect(next).not.toHaveBeenCalled();

    expect(logSecurityEvent).toHaveBeenCalledTimes(1);
    const arg = logSecurityEvent.mock.calls[0][0];
    expect(arg).toMatchObject({
      message: "Invalid or missing admin token",
      statusCode: 401,
      path: "/admin/elections/1",
    });
  });

  test("пропускає запит і виставляє req.user при валідному токені", () => {
    const req = {
      header: jest.fn().mockReturnValue("test-admin-key"),
      ip: "192.168.0.10",
      originalUrl: "/admin/elections",
    };
    const res = makeRes();
    const next = jest.fn();

    authAdmin(req, res, next);

    expect(req.header).toHaveBeenCalledWith("x-admin-token");
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();

    expect(req.user).toEqual({ role: "admin" });
    expect(next).toHaveBeenCalledTimes(1);

    expect(logSecurityEvent).not.toHaveBeenCalled();
  });
});
