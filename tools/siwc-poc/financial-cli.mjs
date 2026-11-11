import { findTransferCandidates, projectCash } from "./financial-core.mjs";

async function stdinJSON() {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.byteLength;
    if (length > 512_000) throw new Error("Input too large.");
    chunks.push(chunk);
  }
  if (!length) throw new Error("JSON input required.");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function main() {
  const operation = process.argv[2];
  if (!["forecast", "transfer-review"].includes(operation)) {
    console.log("Use: <json> | node tools/siwc-poc/financial-cli.mjs forecast|transfer-review");
    process.exitCode = 2;
    return;
  }
  const input = await stdinJSON();
  if (operation === "forecast") {
    const result = projectCash(input);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const matches = findTransferCandidates(input);
  console.log(JSON.stringify({
    totalPossiblePairs: matches.length,
    ambiguous: matches.filter(item => item.status === "ambiguous").length,
    candidates: matches.filter(item => item.status === "candidate").length,
    autoConfirmed: 0,
    note: "Suggestions are never settled, classified or booked without evidence and authorization.",
  }));
}

main().catch(() => {
  // Do not expose financial input, session contents or raw exception messages.
  console.error("Facts: entrada inválida ou operação não concluída.");
  process.exitCode = 1;
});
