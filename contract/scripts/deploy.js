const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // VotingRightToken
  const VotingRightToken = await ethers.getContractFactory("VotingRightToken");
  const votingToken = await VotingRightToken.deploy();
  await votingToken.waitForDeployment();
  const votingTokenAddress = await votingToken.getAddress();
  console.log("VotingRightToken deployed at:", votingTokenAddress);

  // ElectionManager
  const ElectionManager = await ethers.getContractFactory("ElectionManager");
  const electionManager = await ElectionManager.deploy(votingTokenAddress);
  await electionManager.waitForDeployment();
  const electionManagerAddress = await electionManager.getAddress();
  console.log("ElectionManager deployed at:", electionManagerAddress);

  // Мінтер-роль для ElectionManager
  const minterRole = await votingToken.MINTER_ROLE();
  const tx = await votingToken.grantRole(minterRole, electionManagerAddress);
  await tx.wait();
  console.log("MINTER_ROLE granted to ElectionManager");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
