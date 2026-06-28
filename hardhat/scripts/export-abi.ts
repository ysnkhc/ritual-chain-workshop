import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Export the compiled AIJudge ABI into the web app as a typed TS module.
 *
 * Run AFTER `npx hardhat compile`:
 *   npx hardhat run scripts/export-abi.ts
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const artifactPath = path.join(
  here,
  "..",
  "artifacts",
  "contracts",
  "AIJudge.sol",
  "AIJudge.json",
);
const outPath = path.join(here, "..", "..", "web", "src", "abi", "AIJudge.ts");

async function main() {
  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as {
    abi: unknown[];
  };

  const body = `// AUTO-GENERATED from hardhat/contracts/AIJudge.sol (commit-reveal lifecycle).
// Regenerate with: npx hardhat run scripts/export-abi.ts
const abi = ${JSON.stringify(artifact.abi, null, 2)} as const;

export default abi;
`;

  await writeFile(outPath, body, "utf8");
  console.log(`Wrote ABI (${artifact.abi.length} entries) -> ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
