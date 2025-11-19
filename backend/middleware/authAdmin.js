const dotenv = require("dotenv");
dotenv.config();

const { logSecurityEvent } = require("../services/logger");

function authAdmin(req, res, next) {
  const token = req.header("x-admin-token");

  if (!token || token !== process.env.ADMIN_API_KEY) {
    const ip = req.ip || req.connection.remoteAddress;
    const path = req.originalUrl || req.url;

    logSecurityEvent({
      message: "Invalid or missing admin token",
      ip,
      path,
      statusCode: 401,
    });

    return res.status(401).json({ error: "Unauthorized: admin token is missing or invalid" });
  }

  req.user = { role: "admin" };
  next();
}

module.exports = authAdmin;
