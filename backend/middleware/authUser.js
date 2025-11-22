const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

function authUser(req, res, next) {
  const authHeader = req.header("Authorization") || req.header("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const token = authHeader.substring("Bearer ".length).trim();

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    req.user = {
      id: payload.sub,
      role: payload.role,
      email: payload.email,
      walletAddress: payload.walletAddress || null,
    };

    next();
  } catch (err) {
    console.error("authUser: invalid token", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

authUser.requireRole = requireRole;

module.exports = authUser;
