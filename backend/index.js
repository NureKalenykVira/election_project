const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

dotenv.config();

const adminRoutes = require("./routes/admin");
const voteRoutes = require("./routes/vote");
const publicRoutes = require("./routes/public");
const auditRoutes = require("./routes/audit");
const mlRoutes = require("./routes/ml");
const authRoutes = require("./routes/auth");
const organizerRoutes = require("./routes/organizer");

const { startEventListeners } = require("./services/eventListener");
const authAdmin = require("./middleware/authAdmin");
const authUser = require("./middleware/authUser");
const requireRole = authUser.requireRole;
const { logRequest, logSecurityEvent } = require("./services/logger");

require("./db");

const app = express();

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  const ip = req.ip || req.connection.remoteAddress;
  const path = req.originalUrl || req.url;

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const userRole = req.user?.role || null;

    logRequest({
      method: req.method,
      path,
      statusCode: res.statusCode,
      durationMs,
      ip,
      userRole,
    });
  });

  next();
});

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

const voteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    const path = req.originalUrl || req.url;

    logSecurityEvent({
      message: "Vote endpoint rate limit exceeded",
      ip,
      path,
      statusCode: 429,
    });

    return res.status(429).json({ error: "Too many requests on /vote" });
  },
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    const path = req.originalUrl || req.url;

    logSecurityEvent({
      message: "Admin endpoint rate limit exceeded",
      ip,
      path,
      statusCode: 429,
    });

    return res
      .status(429)
      .json({ error: "Too many requests on admin endpoints" });
  },
});

app.use(globalLimiter);

app.use("/admin", adminLimiter, authAdmin, adminRoutes);
app.use("/ml", adminLimiter, authAdmin, mlRoutes);
app.use("/audit", adminLimiter, authAdmin, auditRoutes);
app.use("/auth", authRoutes);
app.use("/organizer", authUser, requireRole("organizer"), organizerRoutes);
app.use("/vote", voteLimiter, voteRoutes);
app.use("/", publicRoutes);

const PORT = process.env.PORT || 5000;

function startServer() {
  const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    startEventListeners(process.env.CHAIN_ID);
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
