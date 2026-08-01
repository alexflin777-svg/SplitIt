import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { simplifyDebts } from '../src/lib/debt-simplification.ts';
import {
  GRADUATION_GROUP,
  REALISTIC_GROUPS,
  ROAD_TRIP_GROUP,
} from './fixtures/realistic-groups.ts';

function calculateBalances(group) {
  const balances = Object.fromEntries(
    group.members.map((member) => [member.id, { name: member.name, paid: 0, owes: 0, netAmount: 0 }]),
  );

  for (const expense of group.expenses) {
    balances[expense.paidById].paid += expense.amountInGroupCurrency;
    for (const split of expense.splits) balances[split.userId].owes += split.amountOwed;
  }

  for (const settlement of group.settlements) {
    balances[settlement.fromUserId].paid += settlement.amount;
    balances[settlement.toUserId].owes += settlement.amount;
  }

  for (const balance of Object.values(balances)) balance.netAmount = balance.paid - balance.owes;
  return balances;
}

function expectMoneyConserved(group, expectedTotal) {
  const total = group.expenses.reduce((sum, expense) => sum + expense.amountInGroupCurrency, 0);
  assert.equal(total, expectedTotal);

  for (const expense of group.expenses) {
    const splitTotal = expense.splits.reduce((sum, split) => sum + split.amountOwed, 0);
    assert.equal(splitTotal, expense.amountInGroupCurrency, `${expense.title}: доли не сходятся`);
  }

  const balances = calculateBalances(group);
  const netTotal = Object.values(balances).reduce((sum, balance) => sum + balance.netAmount, 0);
  assert.ok(Math.abs(netTotal) < 0.01, `балансы не сходятся: ${netTotal}`);
  return balances;
}

describe('Автопутешествие РФ → Турция, 4 участника', () => {
  test('260 000 ₽ расходов и каждая доля сходятся', () => {
    assert.equal(ROAD_TRIP_GROUP.members.length, 4);
    assert.equal(ROAD_TRIP_GROUP.expenses.length, 6);
    expectMoneyConserved(ROAD_TRIP_GROUP, 260_000);
  });

  test('после погашения остаются два перевода: 52 200 ₽ и 6 800 ₽', () => {
    const balances = expectMoneyConserved(ROAD_TRIP_GROUP, 260_000);
    const input = Object.fromEntries(
      Object.entries(balances).map(([id, balance]) => [id, { name: balance.name, netAmount: balance.netAmount }]),
    );
    const transfers = simplifyDebts(input, 'RUB');

    assert.equal(transfers.length, 2);
    assert.deepEqual(
      transfers.map((transfer) => [transfer.fromName, transfer.toName, transfer.amount]),
      [
        ['Михаил Орлов', 'София Ким', 52_200],
        ['Артём Волков', 'София Ким', 6_800],
      ],
    );
  });
});
describe('Выпускной университета, 10 участников', () => {
  test('500 000 ₽ расходов делятся поровну между десятью людьми', () => {
    assert.equal(GRADUATION_GROUP.members.length, 10);
    assert.equal(GRADUATION_GROUP.expenses.length, 7);
    const balances = expectMoneyConserved(GRADUATION_GROUP, 500_000);
    for (const balance of Object.values(balances)) assert.equal(balance.owes, 50_000);
  });

  test('расчёт сводится к девяти переводам и сохраняет 500 000 ₽', () => {
    const balances = expectMoneyConserved(GRADUATION_GROUP, 500_000);
    const input = Object.fromEntries(
      Object.entries(balances).map(([id, balance]) => [id, { name: balance.name, netAmount: balance.netAmount }]),
    );
    const transfers = simplifyDebts(input, 'RUB');

    assert.equal(transfers.length, 9);
    assert.equal(
      transfers.reduce((sum, transfer) => sum + transfer.amount, 0),
      230_000,
      'сумма фактических переводов должна равняться общему долгу, а не обороту расходов',
    );
  });
});

test('две группы не пересекаются ни пользователями, ни расходами', () => {
  const [travel, graduation] = REALISTIC_GROUPS;
  const travelMembers = new Set(travel.members.map((member) => member.id));
  const graduationMembers = new Set(graduation.members.map((member) => member.id));
  const travelExpenses = new Set(travel.expenses.map((expense) => expense.id));
  const graduationExpenses = new Set(graduation.expenses.map((expense) => expense.id));

  assert.equal([...travelMembers].some((id) => graduationMembers.has(id)), false);
  assert.equal([...travelExpenses].some((id) => graduationExpenses.has(id)), false);
});
