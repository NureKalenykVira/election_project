process.env.NODE_ENV = "test";
process.env.ADMIN_API_KEY = "test-admin-key";

jest.mock("../services/logger", () => ({
  logRequest: jest.fn(),
  logSecurityEvent: jest.fn(),
}));

jest.mock("../services/eventListener", () => ({
  startEventListeners: jest.fn(),
}));

const mockElectionManager = {
  createElection: jest.fn().mockResolvedValue("0xcreate"),
  finalize: jest.fn().mockResolvedValue("0xfinalize"),
  grantBatch: jest.fn().mockResolvedValue("0xgrant"),
  commitVote: jest.fn().mockResolvedValue("0xcommit"),
  revealVote: jest.fn().mockResolvedValue("0xreveal"),
  getElection: jest
    .fn()
    .mockResolvedValue([
      1,
      "Test election",
      ["Alice", "Bob"],
      "commit",
      1700000000,
      1700003600,
    ]),
  getTally: jest
    .fn()
    .mockResolvedValue([
      ["Alice", 10],
      ["Bob", 5],
    ]),
  hasRightToVote: jest.fn().mockResolvedValue(true),
};

const mockVotingRightToken = {
  grantBatch: jest.fn().mockResolvedValue("0xgrant"),
  hasRightToVote: jest.fn().mockResolvedValue(true),
};

jest.mock("../services/contracts", () => ({
  getElectionManager: jest.fn(() => mockElectionManager),
  getVotingRightToken: jest.fn(() => mockVotingRightToken),
}));

jest.mock("../db", () => ({
  query: jest.fn(),
}));

global.__mocks = { mockElectionManager, mockVotingRightToken };
