const sql = require("mssql");

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: Number(process.env.DB_PORT) || 1433,
  options: {
    encrypt: process.env.DB_ENCRYPT === "true",
    trustServerCertificate: process.env.DB_TRUST_CERT === "true",
  },
};

const poolPromise = sql
  .connect(config)
  .then((pool) => {
    console.log("MSSQL connected");
    return pool;
  })
  .catch((err) => {
    console.error("MSSQL connection error:", err);
    throw err;
  });

module.exports = {
  sql,
  poolPromise,
};
