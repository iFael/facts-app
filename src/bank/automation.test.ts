import { describe, expect, it } from 'vitest';
import { matchRecipient, moneyToCents, normalizeBankText, overlapStart,
  planAgataTransfer, probableNoahExpense, isPostedTransaction,
  type BankFeedTransaction, type RecipientRule } from './automation';

const rule: RecipientRule = {
  ownerId: 'owner', dependentId: 'dependent', canonicalName: 'Agata Luana Tavares dos Santos',
  normalizedName: 'agata luana tavares dos santos', pensionAmountCents: 80000,
  pensionDayStart: 5, pensionDayEnd: 20, importFrom: '2026-08-01',
};
const tx = (overrides: Partial<BankFeedTransaction> = {}): BankFeedTransaction => ({
  id: 'tx', itemId: 'item', accountId: 'account', amount: 800, originalAmount: -800,
  chargeDate: '2026-11-05', type: 'DEBIT', status: 'POSTED', category: null,
  operationType: 'PIX', description: 'Pix enviado Agata Luana Tavares dos Santos',
  descriptionRaw: null, merchantName: null, counterpartyName: null,
  counterpartyKind: 'person', paymentMethod: 'PIX', foreignCharge: false,
  institution: 'Mercado Pago', ...overrides,
});
describe('bank intelligence', () => {
  it('matches accent-independent recipient from structured or descriptive evidence', () => {
    expect(normalizeBankText(' ÁGATA Luana-Tavares dos Santos ')).toBe('agata luana tavares dos santos');
    expect(matchRecipient(tx({ counterpartyName: 'Ágata Luana Tavares dos Santos' }), rule)).toBe('receiver');
    expect(matchRecipient(tx(), rule)).toBe('description');
    expect(matchRecipient(tx({ description: 'PIX PARA JOAO' }), rule)).toBeNull();
  });
  it('recognizes normal pension and requests decisions outside the window or with duplicates', () => {
    expect(planAgataTransfer(tx(), rule, false, false)).toEqual({ type: 'auto_pension' });
    expect(planAgataTransfer(tx({ chargeDate: '2026-11-21' }), rule, false, false))
      .toEqual({ type: 'review', reason: 'pension_outside_window', suggested: 'pensao' });
    expect(planAgataTransfer(tx(), rule, true, false))
      .toEqual({ type: 'review', reason: 'pension_duplicate_month', suggested: 'adicional' });
    expect(planAgataTransfer(tx(), rule, true, true)).toEqual({ type: 'auto_pension' });
  });
  it('recognizes all sends and receives without misclassifying income', () => {
    expect(planAgataTransfer(tx({ type: 'CREDIT' }), rule, false, false).type).toBe('review');
    expect(planAgataTransfer(tx({ amount: 234 }), rule, false, false))
      .toEqual({ type: 'review', reason: 'agata_outgoing_other', suggested: 'adicional' });
  });
  it('only proposes ambiguous Noah purchases and requires posted evidence', () => {
    expect(probableNoahExpense(tx({ description: 'Compra de fraldas', merchantName: 'Farmacia', amount: 89 }))).toBe(true);
    expect(probableNoahExpense(tx({ type: 'CREDIT', description: 'Fralda' }))).toBe(false);
    expect(isPostedTransaction(tx({ status: 'PENDING' }))).toBe(false);
    expect(isPostedTransaction(tx({ foreignCharge: true }))).toBe(false);
    expect(isPostedTransaction(tx())).toBe(true);
  });
  it('converts amounts safely and overlaps the reconciliation horizon', () => {
    expect(moneyToCents(12.34)).toBe(1234);
    expect(moneyToCents(-800)).toBe(80000);
    expect(overlapStart('2025-10-27', null)).toBe('2025-10-27');
    expect(overlapStart('2026-08-01', '2026-11-05')).toBe('2026-10-22');
  });
});
