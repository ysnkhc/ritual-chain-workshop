import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

// Load `.env` into process.env (if present) so `configVariable(...)` can read
// secrets like DEPLOYER_PRIVATE_KEY from it. `.env` is gitignored; secrets are
// never committed. Falls back silently to the keystore / shell env when absent.
try {
  process.loadEnvFile(new URL("./.env", import.meta.url));
} catch {
  /* no .env file — use hardhat-keystore or shell environment variables */
}

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.24",
      },
      production: {
        version: "0.8.24",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
    ritual: {
      type: "http",
      chainType: "l1",
      url: "https://rpc.ritualfoundation.org",
      chainId: 1979,
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
  },
});
