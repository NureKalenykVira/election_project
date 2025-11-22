const { poolPromise, sql } = require("../db");

async function writeLog({
  level,
  category,
  method,
  path,
  statusCode,
  durationMs,
  ip,
  userRole,
  message,
  context,
}) {
  try {
    const pool = await poolPromise;
    const request = pool.request();

    request.input("Level", sql.NVarChar(20), level || "INFO");
    request.input("Category", sql.NVarChar(50), category || null);
    request.input("Method", sql.NVarChar(10), method || null);
    request.input("Path", sql.NVarChar(300), path || null);
    request.input("StatusCode", sql.Int, statusCode ?? null);
    request.input("DurationMs", sql.Int, durationMs ?? null);
    request.input("Ip", sql.NVarChar(64), ip || null);
    request.input("UserRole", sql.NVarChar(32), userRole || null);
    request.input("Message", sql.NVarChar(4000), message || null);
    request.input("Context", sql.NVarChar(sql.MAX), context ? JSON.stringify(context) : null);

    await request.query(`
      INSERT INTO RequestLog (
        Level, Category, Method, Path, StatusCode,
        DurationMs, Ip, UserRole, Message, Context
      )
      VALUES (
        @Level, @Category, @Method, @Path, @StatusCode,
        @DurationMs, @Ip, @UserRole, @Message, @Context
      );
    `);
  } catch (err) {
    console.error("Failed to write log:", err);
  }
}

function logRequest(params) {
  return writeLog({
    level: "INFO",
    category: "http",
    ...params,
  });
}

function logSecurityEvent(params) {
  return writeLog({
    level: "SECURITY",
    category: params.category || "security",
    ...params,
  });
}

module.exports = {
  logRequest,
  logSecurityEvent,
};
