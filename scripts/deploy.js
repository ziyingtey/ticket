const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  console.log("🚀 Starting FairPass deployment...");
  
  // Get the contract factory
  const FairPassTicket = await ethers.getContractFactory("FairPassTicket");
  
  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log("📝 Deploying contracts with account:", deployer.address);
  
  // Get account balance
  const balance = await deployer.getBalance();
  console.log("💰 Account balance:", ethers.utils.formatEther(balance), "ETH");
  
  // Deploy the contract
  console.log("🔄 Deploying FairPassTicket contract...");
  const fairPassTicket = await FairPassTicket.deploy();
  
  // Wait for deployment
  await fairPassTicket.deployed();
  
  console.log("✅ FairPassTicket deployed to:", fairPassTicket.address);
  console.log("🔗 Network:", hre.network.name);
  console.log("⛽ Gas used:", (await fairPassTicket.deployTransaction.wait()).gasUsed.toString());
  
  // Create a sample event for demonstration
  console.log("\n🎪 Creating sample event...");
  
  const eventDate = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days from now
  const ticketPrice = ethers.utils.parseEther("0.01"); // 0.01 MATIC
  const maxResalePrice = ethers.utils.parseEther("0.02"); // 0.02 MATIC max resale
  
  const createEventTx = await fairPassTicket.createEvent(
    "FairFest 2025 - Web3 Music Festival",
    "MetaVerse Stadium",
    eventDate,
    ticketPrice,
    1000, // max tickets
    maxResalePrice,
    true // sustainability tracking enabled
  );
  
  await createEventTx.wait();
  console.log("✅ Sample event created successfully!");
  
  // Save deployment info
  const deploymentInfo = {
    network: hre.network.name,
    contractAddress: fairPassTicket.address,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    transactionHash: fairPassTicket.deployTransaction.hash,
    blockNumber: fairPassTicket.deployTransaction.blockNumber,
    gasUsed: (await fairPassTicket.deployTransaction.wait()).gasUsed.toString(),
    sampleEventCreated: true
  };
  
  console.log("\n📋 Deployment Summary:");
  console.log("=====================================");
  console.table(deploymentInfo);
  
  // Save to file
  const fs = require('fs');
  const path = require('path');
  
  const deploymentsDir = path.join(__dirname, '../deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  const deploymentFile = path.join(deploymentsDir, `${hre.network.name}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  
  console.log(`💾 Deployment info saved to: ${deploymentFile}`);
  
  // Verification instructions
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log("\n🔍 Contract Verification:");
    console.log("=====================================");
    console.log("Run the following command to verify the contract:");
    console.log(`npx hardhat verify --network ${hre.network.name} ${fairPassTicket.address}`);
    console.log("\nOR use the verify script:");
    console.log(`npm run verify -- --network ${hre.network.name} --contract-address ${fairPassTicket.address}`);
  }
  
  // Frontend setup instructions
  console.log("\n🌐 Frontend Setup:");
  console.log("=====================================");
  console.log("Add the following to your .env file:");
  console.log(`NEXT_PUBLIC_CONTRACT_ADDRESS=${fairPassTicket.address}`);
  console.log(`NEXT_PUBLIC_NETWORK_ID=${hre.network.config.chainId || 'unknown'}`);
  console.log(`NEXT_PUBLIC_NETWORK_NAME=${hre.network.name}`);
  
  console.log("\n🎉 FairPass deployment completed successfully!");
  console.log("=====================================");
  
  return fairPassTicket.address;
}

// Error handling
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });
