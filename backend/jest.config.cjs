module.exports = {
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["**/__tests__/**/*.test.js"],
  setupFilesAfterEnv: ["<rootDir>/test/setupEnv.js"],
};