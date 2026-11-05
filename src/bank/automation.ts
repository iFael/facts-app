export type BankTransferPurpose = 'pensao' | 'adicional';
export type BankMatchSource = 'receiver' | 'description';
export type ReviewReason =
  | 'pension_outside_window' | 'pension_duplicate_month'
  | 'agata_outgoing_other' | 'agata_incoming' | 'possible_noah_expense';

export type BankFeedTransaction = {
  id: string; itemId: string; accountId: string; amount: number; originalAmount: number | null;
  chargeDate: string; type: string | null; status: string | null; category: string | null;
  operationType: string | null; description: string; descriptionRaw: string | null;
  merchantName: string | null; counterpartyName: string | null;
  counterpartyKind: 'person' | 'business' | null;
  paymentMethod: string | null; foreignCharge: boolean; institution: string | null;
};

export type RecipientRule = {
  ownerId: string; dependentId: string; canonicalName: string; normalizedName: string;
  pensionAmountCents: number; pensionDayStart: number; pensionDayEnd: number; importFrom: string;
};

export type PlannedAction =
  | { type: 'auto_pension' }
  | { type: 'review'; reason: ReviewReason; suggested: 'pensao' | 'adicional' | 'reembolso' };

export function normalizeBankText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
export function moneyToCents(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const cents = Math.round(Math.abs(value) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}
export function signedMoneyToCents(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}
export function matchRecipient(transaction: BankFeedTransaction, rule: RecipientRule): BankMatchSource | null {
  const target = rule.normalizedName || normalizeBankText(rule.canonicalName);
  if (!target) return null;
  if (transaction.counterpartyName && normalizeBankText(transaction.counterpartyName).includes(target)) return 'receiver';
  for (const value of [transaction.descriptionRaw, transaction.description]) {
    if (value && normalizeBankText(value).includes(target)) return 'description';
  }
  return null;
}
/** A date is a signal, never proof of pension competence. */
export function planAgataTransfer(
  transaction: BankFeedTransaction, rule: RecipientRule,
  hasPensionThisMonth: boolean, hasExactExistingPension: boolean,
): PlannedAction {
  if (transaction.type?.toUpperCase() === 'CREDIT')
    return { type: 'review', reason: 'agata_incoming', suggested: 'reembolso' };
  const amount = moneyToCents(transaction.amount);
  if (amount !== rule.pensionAmountCents)
    return { type: 'review', reason: 'agata_outgoing_other', suggested: 'adicional' };
  if (hasExactExistingPension) return { type: 'auto_pension' };
  const day = Number(transaction.chargeDate.slice(8, 10));
  if (day < rule.pensionDayStart || day > rule.pensionDayEnd)
    return { type: 'review', reason: 'pension_outside_window', suggested: 'pensao' };
  if (hasPensionThisMonth && !hasExactExistingPension)
    return { type: 'review', reason: 'pension_duplicate_month', suggested: 'adicional' };
  return { type: 'auto_pension' };
}
export function isPostedTransaction(transaction: BankFeedTransaction): boolean {
  return transaction.status?.toUpperCase() === 'POSTED'
    && ['DEBIT', 'CREDIT'].includes(transaction.type?.toUpperCase() ?? '')
    && !transaction.foreignCharge;
}
export function probableNoahExpense(transaction: BankFeedTransaction): boolean {
  if (transaction.type?.toUpperCase() !== 'DEBIT') return false;
  const evidence = normalizeBankText([transaction.merchantName, transaction.description].filter(Boolean).join(' '));
  return /\b(fralda|fraldas|pampers|huggies|infantil|baby|bebe|creche|noah)\b/.test(evidence);
}
export function overlapStart(importFrom: string, lastOccurredAt: string | null, overlapDays = 14): string {
  if (!lastOccurredAt) return importFrom;
  const date = new Date(lastOccurredAt + 'T00:00:00.000Z');
  if (Number.isNaN(date.getTime())) return importFrom;
  date.setUTCDate(date.getUTCDate() - overlapDays);
  const candidate = date.toISOString().slice(0, 10);
  return candidate < importFrom ? importFrom : candidate;
}
