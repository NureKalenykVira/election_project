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

const { startEventListeners } = require("./services/eventListener");
const authAdmin = require("./middleware/authAdmin");
const { logRequest, logSecurityEvent } = require("./services/logger"); // новий логер
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

// Глобальний ліміт для всіх запитів
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 хвилина
  max: 200,            // не більше 200 запитів/хв з одного IP
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

// Ліміт для /vote (захист від спаму голосів)
const voteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 хвилина
  max: 20,             // до 20 запитів/хв на голосування з одного IP
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
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

// Ліміт для адмінських ендпоінтів (захист від brute-force)
const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 хвилина
  max: 10,             // до 10 admin-запитів/хв із одного IP
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const path = req.originalUrl || req.url;

    logSecurityEvent({
      message: "Admin endpoint rate limit exceeded",
      ip,
      path,
      statusCode: 429,
    });

    return res.status(429).json({ error: "Too many requests on admin endpoints" });
  },
});

app.use("/admin", adminLimiter, authAdmin, adminRoutes);
app.use("/ml", adminLimiter, authAdmin, mlRoutes);
app.use("/audit", adminLimiter, authAdmin, auditRoutes);
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

module.exports = { app };
