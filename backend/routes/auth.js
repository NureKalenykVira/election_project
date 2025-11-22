const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { poolPromise, sql } = require("../db");
const authUser = require("../middleware/authUser");

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";

function signToken(user) {
  return jwt.sign(
    {
      sub: user.Id,
      role: user.Role,
      email: user.Email,
      walletAddress: user.WalletAddress || null,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// POST /auth/register  body: { email, password, walletAddress? }
router.post("/register", async (req, res) => {
  try {
    const { email, password, walletAddress } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Email і пароль є обов'язковими" });
    }

    const pool = await poolPromise;
    const request = pool.request();

    request.input("Email", sql.NVarChar(256), email);
    const existing = await request.query(`
      SELECT Id FROM [Users] WHERE Email = @Email;
    `);

    if (existing.recordset.length > 0) {
      return res.status(409).json({ error: "Користувач з таким email вже існує" });
    }

    const hash = await bcrypt.hash(password, 10);

    const insertReq = pool.request();
    insertReq.input("Email", sql.NVarChar(256), email);
    insertReq.input("PasswordHash", sql.NVarChar(512), hash);
    insertReq.input("Role", sql.NVarChar(50), "voter");
    insertReq.input("WalletAddress", sql.NVarChar(100), walletAddress || null);

    const insertResult = await insertReq.query(`
        INSERT INTO [Users] (Email, PasswordHash, Role, WalletAddress)
        VALUES (@Email, @PasswordHash, @Role, @WalletAddress);

        SELECT Id, Email, Role, WalletAddress
        FROM [Users]
        WHERE Id = SCOPE_IDENTITY();
    `);

    const user = insertResult.recordset[0];

    const token = signToken(user);

    res.status(201).json({
      token,
      user: {
        id: user.Id,
        email: user.Email,
        role: user.Role,
        walletAddress: user.WalletAddress,
      },
    });
  } catch (err) {
    console.error("POST /auth/register error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /auth/login body: { email, password }
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Email і пароль є обов'язковими" });
    }

    const pool = await poolPromise;
    const request = pool.request();
    request.input("Email", sql.NVarChar(256), email);

    const result = await request.query(`
      SELECT Id, Email, PasswordHash, Role, WalletAddress
      FROM [Users]
      WHERE Email = @Email;
    `);

    if (result.recordset.length === 0) {
      return res.status(401).json({ error: "Невірний email або пароль" });
    }

    const user = result.recordset[0];

    const passwordOk = await bcrypt.compare(password, user.PasswordHash);
    if (!passwordOk) {
      return res.status(401).json({ error: "Невірний email або пароль" });
    }

    const token = signToken(user);

    res.json({
      token,
      user: {
        id: user.Id,
        email: user.Email,
        role: user.Role,
        walletAddress: user.WalletAddress,
      },
    });
  } catch (err) {
    console.error("POST /auth/login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /auth/me
router.get("/me", authUser, async (req, res) => {
  try {
    const pool = await poolPromise;
    const request = pool.request();
    request.input("Id", sql.BigInt, req.user.id);

    const result = await request.query(`
      SELECT Id, Email, Role, WalletAddress, CreatedAt, UpdatedAt
      FROM [Users]
      WHERE Id = @Id;
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Користувача не знайдено" });
    }

    const user = result.recordset[0];

    res.json({
      id: user.Id,
      email: user.Email,
      role: user.Role,
      walletAddress: user.WalletAddress,
      createdAt: user.CreatedAt,
      updatedAt: user.UpdatedAt,
    });
  } catch (err) {
    console.error("GET /auth/me error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/become-organizer", authUser, async (req, res) => {
  try {
    const userId = req.user.id;

    const pool = await poolPromise;

    const updateReq = pool.request();
    updateReq.input("Id", sql.BigInt, userId);
    updateReq.input("Role", sql.NVarChar(50), "organizer");

    const updateResult = await updateReq.query(`
        UPDATE [Users]
        SET Role = @Role
        WHERE Id = @Id;

        SELECT Id, Email, Role, WalletAddress
        FROM [Users]
        WHERE Id = @Id;
    `);

    if (updateResult.recordset.length === 0) {
        return res.status(404).json({ error: "Користувача не знайдено" });
    }

    const user = updateResult.recordset[0];

    const token = jwt.sign(
      {
        sub: user.Id,
        role: user.Role,
        email: user.Email,
        walletAddress: user.WalletAddress || null,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      token,
      user: {
        id: user.Id,
        email: user.Email,
        role: user.Role,
        walletAddress: user.WalletAddress,
      },
    });
  } catch (err) {
    console.error("POST /auth/become-organizer error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;