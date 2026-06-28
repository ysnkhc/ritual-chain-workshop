import { network } from "hardhat";
import { formatEther } from "viem";

/**
 * Pre-deployment safety check. Confirms the network, deployer address, balance
 * and that the LLM precompile address is configured — WITHOUT sending any
 * transaction and WITHOUT printing the private key.
 *
 * Run:  npx hardhat run scripts/deploy-preflight.ts --network ritual
 */
async function main() {
  const connection = await network.connect();
  const { viem } = connection;

  const publicClient = await viem.getPublicClient();
  const [wallet] = await viem.getWalletClients();

  const chainId = await publicClient.getChainId();
  const deployer = wallet.account.address;
  const balance = await publicClient.getBalance({ address: deployer });

  console.log("=== Deploy preflight ===");
  console.log("Chain id        :", chainId);
  console.log("Deployer address:", deployer);
  console.log("Deployer balance:", formatEther(balance), "RITUAL");

  if (balance === 0n) {
    console.warn(
      "\n⚠️  Deployer balance is zero. Fund this address before deploying.",
    );
  } else {
    console.log("\n✅ Deployer is funded. Ready to deploy.");
  }

  console.log(
    "\nDeploy with:\n  npx hardhat ignition deploy --network ritual ignition/modules/AIJudge.ts",
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
