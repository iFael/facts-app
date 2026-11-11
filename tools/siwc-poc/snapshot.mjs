function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function name(value) {
  if (typeof value !== "string") throw new Error("Nome inválido.");
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120 || /[\u0000-\u001f]/.test(trimmed)) {
    throw new Error("Nome inválido.");
  }
  return trimmed;
}

function amount(value, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 1_000_000_000_000) {
    throw new Error("Valor monetário inválido (informe centavos inteiros).");
  }
  return value;
}

function transactions(value, planned) {
  if (!Array.isArray(value) || value.length > 100) throw new Error("Lista financeira inválida.");
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) || !validDate(item.date)) {
      throw new Error("Data de movimentação inválida.");
    }
    if (!["incoming", "outgoing"].includes(item.direction)) {
      throw new Error("Direção financeira inválida.");
    }
    const row = {
      date: item.date,
      description: name(item.description),
      direction: item.direction,
      amountCents: amount(item.amountCents),
    };
    if (planned) {
      if (!["confirmed", "expected"].includes(item.confidence)) {
        throw new Error("Previsão precisa de grau de confirmação.");
      }
      row.confidence = item.confidence;
    }
    return row;
  });
}

/** Read-only, allowlisted and bounded input for the local proof of concept. */
export function parseFinancialSnapshot(text) {
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !validDate(value.asOf) || value.currency !== "BRL") {
    throw new Error("Resumo financeiro inválido.");
  }
  if (!Array.isArray(value.accounts) || value.accounts.length > 10) {
    throw new Error("Contas inválidas.");
  }
  return {
    asOf: value.asOf,
    currency: "BRL",
    accounts: value.accounts.map(account => ({
      institution: name(account?.institution),
      balanceCents: amount(account?.balanceCents, true),
    })),
    executed: transactions(value.executed ?? [], false),
    planned: transactions(value.planned ?? [], true),
  };
}
