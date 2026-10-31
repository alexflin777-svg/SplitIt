/**
 * Debt Simplification Algorithm for SplitIT
 * Reduces N*(N-1) raw debts to a minimal set of direct transactions.
 */

export interface Transaction {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amount: number;
  currency: string;
}

export interface PersonBalance {
  id: string;
  name: string;
  netBalance: number; // positive = owed money, negative = owes money
}

export function simplifyDebts(
  balances: Record<string, { name: string; netAmount: number }>,
  currency: string = 'RUB'
): Transaction[] {
  // Separate into debtors (< 0) and creditors (> 0); amounts in whole kopecks,
  // so any non-zero balance (even 1 kopeck) is settled.
  const debtors: { id: string; name: string; amount: number }[] = [];
  const creditors: { id: string; name: string; amount: number }[] = [];

  for (const [id, data] of Object.entries(balances)) {
    const cents = Math.round(data.netAmount * 100);
    if (cents < 0) {
      debtors.push({ id, name: data.name, amount: -cents });
    } else if (cents > 0) {
      creditors.push({ id, name: data.name, amount: cents });
    }
  }

  // Sort by amount descending
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transactions: Transaction[] = [];

  let i = 0; // debtor index
  let j = 0; // creditor index

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];

    const settled = Math.min(debtor.amount, creditor.amount);

    transactions.push({
      fromId: debtor.id,
      fromName: debtor.name,
      toId: creditor.id,
      toName: creditor.name,
      amount: settled / 100,
      currency,
    });

    debtor.amount -= settled;
    creditor.amount -= settled;

    if (debtor.amount === 0) i++;
    if (creditor.amount === 0) j++;
  }

  return transactions;
}
