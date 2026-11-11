import { test } from "node:test";
import assert from "node:assert/strict";
import { findTransferCandidates, projectCash } from "./financial-core.mjs";

const entry = (id, accountId, direction, amountCents = 126000, options = {}) => ({
  id, accountId, direction, amountCents, ownerId: "owner1",
  date: "2026-10-20", status: "POSTED", ...options,
});
const start = () => ({
  currency: "BRL", asOf: "2026-11-10", through: "2027-03-31",
  accounts: [
    { id: "mp", balanceCents: 100_000, balanceAsOf: "2026-11-10", balanceVerified: true },
    { id: "itau", balanceCents: 20_000, balanceAsOf: "2026-11-10", balanceVerified: true },
  ],
  commitments: [],
});

test("a matching bank transfer is a suggestion, never an automatic confirmation", () => {
  const matches = findTransferCandidates([
    entry("mp-out", "mp", "outgoing"),
    entry("mp-in", "mp", "incoming"),
    entry("itau-in", "itau", "incoming"),
  ]);
  assert.deepEqual(matches, [{
    outgoingId: "mp-out", incomingIds: ["itau-in"], amountCents: 126000,
    date: "2026-10-20", status: "candidate", confirmed: false,
  }]);
});

test("ambiguous transfer candidates require review", () => {
  const matches = findTransferCandidates([
    entry("out-1", "mp", "outgoing"),
    entry("out-2", "mp", "outgoing"),
    entry("in-1", "itau", "incoming"),
    entry("in-2", "other", "incoming"),
  ]);
  assert.equal(matches.length, 2);
  assert.ok(matches.every(row => row.status === "ambiguous" && !row.confirmed));
});

test("does not match across users, accounts, pending or unrelated amounts", () => {
  assert.deepEqual(findTransferCandidates([
    entry("a", "mp", "outgoing"),
    entry("b", "itau", "incoming", 126000, { ownerId: "owner2" }),
    entry("c", "mp", "incoming"),
    entry("d", "itau", "incoming", 126000, { status: "PENDING" }),
    entry("e", "itau", "incoming", 125999),
  ]), []);
});

test("shared IDs across distinct owners cannot make unrelated matches ambiguous", () => {
  const matches = findTransferCandidates([
    entry("out", "mp", "outgoing", 126000, { ownerId: "a" }),
    entry("in", "itau", "incoming", 126000, { ownerId: "a" }),
    entry("out", "mp", "outgoing", 126000, { ownerId: "b" }),
    entry("in", "itau", "incoming", 126000, { ownerId: "b" }),
  ]);
  assert.equal(matches.length, 2);
  assert.ok(matches.every(pair => pair.status === "candidate"));
});

test("missing or stale account balances block numeric forecasts", () => {
  assert.equal(projectCash({ ...start(), accounts: [] }).status, "unavailable");
  const input = start();
  input.accounts[0].balanceVerified = false;
  assert.equal(projectCash(input).status, "unavailable");
  const old = start();
  old.accounts[1].balanceAsOf = "2026-11-09";
  assert.equal(projectCash(old).status, "unavailable");
});

test("confirmed and expected movements produce explicitly conditional scenarios", () => {
  const result = projectCash({
    ...start(), through: "2026-11-30",
    commitments: [
      { id: "salary", accountId: "itau", date: "2026-11-11", kind: "income", amountCents: 50_000, confidence: "confirmed" },
      { id: "bill", accountId: "mp", date: "2026-11-15", kind: "expense", amountCents: 20_000, confidence: "confirmed" },
      { id: "possible-income", accountId: "itau", date: "2026-11-16", kind: "income", amountCents: 15_000, confidence: "expected" },
      { id: "possible-expense", accountId: "mp", date: "2026-11-20", kind: "expense", amountCents: 10_000, confidence: "expected" },
      { id: "move-money", fromAccountId: "mp", toAccountId: "itau", date: "2026-11-22", kind: "internal_transfer", amountCents: 60_000, confidence: "confirmed" },
    ],
  });
  assert.equal(result.status, "indicative");
  assert.equal(result.currency, "BRL");
  assert.equal(result.startingCents, 120_000);
  assert.deepEqual(result.projected.at(-1), {
    date: "2026-11-22", sourceId: "move-money", kind: "internal_transfer",
    confidence: "confirmed", confirmedOnlyCents: 150_000,
    conservativeKnownCents: 140_000, optimisticKnownCents: 165_000,
  });
});

test("monthly recurrence respects original day 31 and explicit end date", () => {
  const result = projectCash({
    ...start(),
    commitments: [
      { id: "pay", accountId: "mp", date: "2027-01-31", repeat: "monthly",
        until: "2027-03-31", kind: "expense", confidence: "confirmed", amountCents: 1000 },
    ],
  });
  assert.deepEqual(result.projected.map(row => row.date), [
    "2027-01-31", "2027-02-28", "2027-03-31",
  ]);
  assert.equal(result.projected.at(-1).confirmedOnlyCents, 117_000);
});

test("past and current-day events are not subtracted again from anchored balances", () => {
  const result = projectCash({
    ...start(), through: "2026-12-01",
    commitments: [
      { id: "past", accountId: "mp", date: "2026-11-01", kind: "expense", confidence: "confirmed", amountCents: 10_000 },
      { id: "now", accountId: "mp", date: "2026-11-10", kind: "expense", confidence: "confirmed", amountCents: 10_000 },
    ],
  });
  assert.equal(result.startingCents, 120_000);
  assert.deepEqual(result.projected, []);
  assert.equal(result.status, "indicative");
});

test("reject duplicate, invalid reference, recurrence and malformed money", () => {
  for (const input of [
    { ...start(), accounts: [start().accounts[0], start().accounts[0]] },
    { ...start(), commitments: [
      { id: "x", accountId: "missing", date: "2026-11-11", kind: "expense", confidence: "confirmed", amountCents: 100 },
    ] },
    { ...start(), commitments: [
      { id: "x", accountId: "mp", date: "2026-11-11", kind: "expense", confidence: "confirmed", amountCents: 0.01 },
    ] },
    { ...start(), commitments: [
      { id: "x", accountId: "mp", date: "2026-11-31", kind: "expense", confidence: "confirmed", amountCents: 100 },
    ] },
    { ...start(), commitments: [
      { id: "x", accountId: "mp", date: "2026-11-11", repeat: "monthly", kind: "expense", confidence: "confirmed", amountCents: 100 },
    ] },
    { ...start(), commitments: [
      { id: "x", fromAccountId: "mp", toAccountId: "external", date: "2026-11-11", kind: "internal_transfer", confidence: "confirmed", amountCents: 100 },
    ] },
  ]) assert.throws(() => projectCash(input));
});

test("long-lived recurring commitments continue beyond the first 24 months", () => {
  const result = projectCash({
    ...start(), through: "2026-12-31",
    commitments: [{
      id: "old-plan", accountId: "mp", date: "2024-01-31",
      repeat: "monthly", until: "2027-01-31",
      kind: "expense", confidence: "confirmed", amountCents: 100,
    }],
  });
  assert.deepEqual(result.projected.map(row => row.date), ["2026-11-30", "2026-12-31"]);
});

test("known deficit is a scenario warning, not a guaranteed future", () => {
  const result = projectCash({
    ...start(), through: "2026-11-30",
    commitments: [
      { id: "rent", accountId: "mp", date: "2026-11-15", kind: "expense", confidence: "confirmed", amountCents: 125_000 },
    ],
  });
  assert.equal(result.firstKnownDeficitDate, "2026-11-15");
  assert.equal(result.projected.at(-1).confirmedOnlyCents, -5_000);
  assert.equal(result.status, "indicative");
});

test("per-account overdraft can occur even when consolidated balance is positive", () => {
  const result = projectCash({
    ...start(), through: "2026-11-30",
    commitments: [{ id: "move", fromAccountId: "itau", toAccountId: "mp",
      kind: "internal_transfer", date: "2026-11-15", amountCents: 50_000, confidence: "confirmed" }],
  });
  assert.equal(result.firstKnownDeficitDate, null);
  assert.deepEqual(result.firstAccountDeficit, {date: "2026-11-15", accountId: "itau"});
  assert.equal(result.finalAccounts.find(item => item.id === "itau")?.confirmedOnlyCents, -30_000);
  assert.equal(result.projected.at(-1).confirmedOnlyCents, 120_000);
});

test("end-of-day netting avoids false same-day deficit alerts", () => {
  const result = projectCash({
    ...start(), through: "2026-11-30",
    commitments: [
      { id: "a-expense", accountId: "mp", kind: "expense", date: "2026-11-15", amountCents: 130_000, confidence: "confirmed" },
      { id: "b-income", accountId: "mp", kind: "income", date: "2026-11-15", amountCents: 130_000, confidence: "confirmed" },
    ],
  });
  assert.equal(result.firstKnownDeficitDate, null);
  assert.equal(result.firstAccountDeficit, null);
});

test("currency is explicit and mismatched currencies fail closed", () => {
  assert.throws(() => projectCash({ ...start(), currency: undefined }));
  assert.throws(() => projectCash({ ...start(), currency: "USD" }));
});

test("transfer pairs reject duplicate IDs and invalid dates", () => {
  assert.throws(() => findTransferCandidates([entry("x", "mp", "outgoing"), entry("x", "itau", "incoming")]));
  assert.throws(() => findTransferCandidates([entry("x", "mp", "outgoing", 100, { date: "2026-02-30" })]));
});
