/** Financial calculations for the local Facts PoC. No database or model calls. */

const DAY = 86_400_000;
const MAX_CENTS = 1_000_000_000_000;

function dateParts(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Invalid ISO date.");
  }
  const date = new Date(value + "T00:00:00.000Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid calendar date.");
  }
  return date;
}
function positiveCents(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_CENTS) {
    throw new Error("Expected positive integer cents.");
  }
  return value;
}
function signedCents(value) {
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_CENTS) {
    throw new Error("Invalid balance cents.");
  }
  return value;
}
function id(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) {
    throw new Error("Invalid stable identifier.");
  }
  return value;
}
function add(a, b) {
  const result = a + b;
  if (!Number.isSafeInteger(result) || Math.abs(result) > MAX_CENTS) {
    throw new Error("Money arithmetic overflow.");
  }
  return result;
}
function shiftedMonth(original, offset) {
  const date = dateParts(original);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + offset;
  const first = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(date.getUTCDate(), lastDay)))
    .toISOString().slice(0, 10);
}
function occurrenceDates(event, asOf, through) {
  const start = dateParts(event.date).toISOString().slice(0, 10);
  if (event.repeat == null) return start > asOf && start <= through ? [start] : [];
  if (event.repeat !== "monthly") throw new Error("Unsupported recurrence.");
  if (typeof event.until !== "string") throw new Error("Recurring event requires an end date.");
  const until = dateParts(event.until).toISOString().slice(0, 10);
  if (until < start) throw new Error("Recurrence ends before it starts.");
  const dates = [];
  const startDate = dateParts(start);
  const referenceDate = dateParts(asOf);
  const monthIndex = Math.max(0, (referenceDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
    referenceDate.getUTCMonth() - startDate.getUTCMonth() - 1);
  for (let month = monthIndex; month <= monthIndex + 26; month++) {
    const date = shiftedMonth(start, month);
    if (date > until || date > through) break;
    if (date > asOf) dates.push(date);
  }
  return dates;
}

/**
 * A transfer match is only a hypothesis. Equal amount and date are never
 * authorization to settle or reclassify a transaction.
 * Only posted records belonging to the same owner and different accounts enter.
 */
export function findTransferCandidates(rows) {
  if (!Array.isArray(rows) || rows.length > 5_000) throw new Error("Invalid ledger.");
  const seen = new Set();
  const items = rows.map(row => {
    if (!row || typeof row !== "object") throw new Error("Invalid ledger record.");
    const record = {
      id: id(row.id), ownerId: id(row.ownerId), accountId: id(row.accountId),
      date: dateParts(row.date).toISOString().slice(0, 10),
      amountCents: positiveCents(row.amountCents),
      direction: row.direction, status: row.status,
    };
    if (!["incoming", "outgoing"].includes(record.direction) ||
        !["POSTED", "PENDING"].includes(record.status)) {
      throw new Error("Invalid ledger direction or status.");
    }
    const key = record.ownerId + ":" + record.id;
    if (seen.has(key)) throw new Error("Duplicate ledger transaction.");
    seen.add(key);
    return record;
  }).filter(row => row.status === "POSTED");
  const incomingByAmount = new Map();
  for (const row of items) {
    if (row.direction !== "incoming") continue;
    const key = row.ownerId + ":" + row.amountCents;
    const values = incomingByAmount.get(key) ?? [];
    values.push(row);
    incomingByAmount.set(key, values);
  }
  const possibilities = [];
  const reuse = new Map();
  for (const outgoing of items) {
    if (outgoing.direction !== "outgoing") continue;
    const incoming = (incomingByAmount.get(outgoing.ownerId + ":" + outgoing.amountCents) ?? [])
      .filter(row => row.accountId !== outgoing.accountId &&
        Math.abs((dateParts(row.date) - dateParts(outgoing.date)) / DAY) <= 1);
    if (!incoming.length) continue;
    for (const row of incoming) {
      const key = row.ownerId + ":" + row.id;
      reuse.set(key, (reuse.get(key) ?? 0) + 1);
    }
    possibilities.push({
      outgoingId: outgoing.id, incomingIds: incoming.map(row => row.id).sort(), ownerId: outgoing.ownerId,
      amountCents: outgoing.amountCents, date: outgoing.date,
    });
  }
  return possibilities.map(pair => ({
    outgoingId: pair.outgoingId, incomingIds: pair.incomingIds,
    amountCents: pair.amountCents, date: pair.date,
    status: pair.incomingIds.length > 1 ||
      pair.incomingIds.some(item => (reuse.get(pair.ownerId + ":" + item) ?? 0) > 1) ? "ambiguous" : "candidate",
    confirmed: false,
  }));
}

/**
 * A projection is conditional on *all* provided bank balances being verified
 * on the same date. Past posted transactions are already reflected in balances
 * and must not be replayed. Expected income is never treated as guaranteed.
 */
export function projectCash({ currency, asOf, through, accounts, commitments }) {
  if (currency !== "BRL") throw new Error("Only explicitly BRL-denominated balances are supported.");
  const asOfDate = dateParts(asOf);
  const throughDate = dateParts(through);
  const days = (throughDate - asOfDate) / DAY;
  if (days < 1 || days > 730) throw new Error("Forecast horizon must be 1 to 730 days.");
  if (!Array.isArray(accounts) || accounts.length > 10 ||
      !Array.isArray(commitments) || commitments.length > 100) {
    throw new Error("Invalid forecast inputs.");
  }
  const missing = () => ({
    status: "unavailable", reason: "verified_account_balances_required",
    currency, asOf, through, projected: [],
  });
  if (!accounts.length) return missing();

  const accountIds = new Set();
  const accountStates = new Map();
  let startingCents = 0;
  for (const account of accounts) {
    if (!account || typeof account !== "object") throw new Error("Invalid account.");
    const accountId = id(account.id);
    if (accountIds.has(accountId)) throw new Error("Duplicate account.");
    accountIds.add(accountId);
    // Unknown, stale or unverified balances cannot be used as a starting point.
    if (account.balanceVerified !== true || account.balanceAsOf !== asOf ||
        !Number.isSafeInteger(account.balanceCents)) return missing();
    const amount = signedCents(account.balanceCents);
    startingCents = add(startingCents, amount);
    accountStates.set(accountId, { id: accountId, confirmed: amount, conservative: amount, optimistic: amount });
  }

  const events = [];
  const commitmentIds = new Set();
  for (const item of commitments) {
    if (!item || typeof item !== "object") throw new Error("Invalid commitment.");
    const commitmentId = id(item.id);
    if (commitmentIds.has(commitmentId)) throw new Error("Duplicate commitment.");
    commitmentIds.add(commitmentId);
    const amountCents = positiveCents(item.amountCents);
    if (!["confirmed", "expected"].includes(item.confidence)) throw new Error("Invalid commitment confidence.");
    if (!["income", "expense", "internal_transfer"].includes(item.kind)) throw new Error("Invalid commitment kind.");
    if (item.kind === "internal_transfer") {
      if (!accountIds.has(id(item.fromAccountId)) ||
          !accountIds.has(id(item.toAccountId)) || item.fromAccountId === item.toAccountId) {
        throw new Error("Internal transfer needs two distinct tracked accounts.");
      }
    } else if (!accountIds.has(id(item.accountId))) {
      throw new Error("Commitment references an unknown account.");
    }
    const dates = occurrenceDates(item, asOf, through);
    for (const date of dates) {
      events.push({ date, id: commitmentId, kind: item.kind,
        confidence: item.confidence, amountCents,
        accountId: item.accountId, fromAccountId: item.fromAccountId, toAccountId: item.toAccountId });
    }
    if (events.length > 1_000) throw new Error("Too many projected events.");
  }
  events.sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  let confirmedCents = startingCents;
  let conservativeCents = startingCents;
  let optimisticCents = startingCents;
  const projected = [];
  let firstKnownDeficitDate = startingCents < 0 ? asOf : null;
  let firstAccountDeficit = [...accountStates.values()].find(state => state.conservative < 0);
  firstAccountDeficit = firstAccountDeficit ? { date: asOf, accountId: firstAccountDeficit.id } : null;
  for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
    const event = events[eventIndex];
    if (event.kind !== "internal_transfer") {
      const delta = event.kind === "income" ? event.amountCents : -event.amountCents;
      if (event.confidence === "confirmed") {
        confirmedCents = add(confirmedCents, delta);
        conservativeCents = add(conservativeCents, delta);
        optimisticCents = add(optimisticCents, delta);
      } else if (event.kind === "expense") {
        conservativeCents = add(conservativeCents, delta);
      } else {
        optimisticCents = add(optimisticCents, delta);
      }
    }
    if (event.kind === "internal_transfer") {
      // Unconfirmed transfers are not assumed to happen in either account.
      if (event.confidence === "confirmed") {
        const source = accountStates.get(event.fromAccountId);
        const target = accountStates.get(event.toAccountId);
        for (const field of ["confirmed", "conservative", "optimistic"]) {
          source[field] = add(source[field], -event.amountCents);
          target[field] = add(target[field], event.amountCents);
        }
      }
    } else {
      const state = accountStates.get(event.accountId);
      const delta = event.kind === "income" ? event.amountCents : -event.amountCents;
      if (event.confidence === "confirmed") {
        for (const field of ["confirmed", "conservative", "optimistic"]) {
          state[field] = add(state[field], delta);
        }
      } else if (event.kind === "expense") {
        state.conservative = add(state.conservative, delta);
      } else {
        state.optimistic = add(state.optimistic, delta);
      }
    }
    projected.push({
      date: event.date, sourceId: event.id, kind: event.kind,
      confidence: event.confidence, confirmedOnlyCents: confirmedCents,
      conservativeKnownCents: conservativeCents,
      optimisticKnownCents: optimisticCents,
    });
    // End-of-day risk: an outgoing and incoming on the same day must net first.
    if (eventIndex === events.length - 1 || events[eventIndex + 1].date !== event.date) {
      if (firstKnownDeficitDate === null && conservativeCents < 0) {
        firstKnownDeficitDate = event.date;
      }
      if (firstAccountDeficit === null) {
        const atRisk = [...accountStates.values()].find(state => state.conservative < 0);
        if (atRisk) firstAccountDeficit = { date: event.date, accountId: atRisk.id };
      }
    }
  }
  return {
    status: "indicative", currency, asOf, through, startingCents,
    explanation: "Scenarios include only entered commitments, not unknown future expenses or income.",
    projected,
    firstKnownDeficitDate,
    firstAccountDeficit,
    finalAccounts: [...accountStates.values()].map(state => ({
      id: state.id, confirmedOnlyCents: state.confirmed,
      conservativeKnownCents: state.conservative,
      optimisticKnownCents: state.optimistic,
    })),
  };
}
