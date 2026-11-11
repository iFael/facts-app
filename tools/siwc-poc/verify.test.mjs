import test from "node:test";
import assert from "node:assert/strict";
import { createWindowsCredentialEncryption } from "./dpapi.mjs";
import { parseFinancialSnapshot } from "./snapshot.mjs";

const sample = {
  asOf: "2026-11-06",
  currency: "BRL",
  accounts: [{ institution: "Conta A", balanceCents: 15_000 }],
  executed: [{ date: "2026-11-05", description: "Compra", direction: "outgoing", amountCents: 1_200 }],
  planned: [{ date: "2026-11-10", description: "Parcela", direction: "outgoing", amountCents: 3_500, confidence: "confirmed" }],
};

test("financial context accepts valid cents and dates", () => {
  assert.deepEqual(parseFinancialSnapshot(JSON.stringify(sample)), sample);
});

test("unrecognized/private fields never enter the model input", () => {
  const actual = parseFinancialSnapshot(JSON.stringify({
    ...sample, secret: "NO-SEND",
    accounts: [{ ...sample.accounts[0], accountNumber: "NO-SEND" }],
    executed: [{ ...sample.executed[0], secret: "NO-SEND" }],
  }));
  assert.equal(JSON.stringify(actual).includes("NO-SEND"), false);
});

test("invalid amounts, dates or missing forecast confidence fail closed", () => {
  for (const input of [
    { ...sample, accounts: [{ institution: "Conta A", balanceCents: 0.01 }] },
    { ...sample, executed: [{ ...sample.executed[0], date: "2026-02-30" }] },
    { ...sample, planned: [{ ...sample.planned[0], confidence: undefined }] },
    { ...sample, executed: [{ ...sample.executed[0], amountCents: -1 }] },
  ]) {
    assert.throws(() => parseFinancialSnapshot(JSON.stringify(input)));
  }
});

test("DPAPI protects and restores local credentials", { skip: process.platform !== "win32" }, async () => {
  const provider = createWindowsCredentialEncryption();
  assert.equal(await provider.isAvailable(), true);
  const original = "facts-local-credential-test";
  const protectedBytes = await provider.encrypt(original);
  assert.ok(protectedBytes.length > 0);
  assert.equal(Buffer.from(protectedBytes).toString("utf8").includes(original), false);
  assert.equal(await provider.decrypt(protectedBytes), original);
});
