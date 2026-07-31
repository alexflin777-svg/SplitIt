/**
 * SplitIT Clean Initial State Store
 * Clean initial state for real multi-user testing & production release.
 */

export interface EventGroup {
  id: string;
  name: string;
  category: 'trip' | 'restaurant' | 'home' | 'party' | 'other';
  currency: string;
  createdBy: string;
  createdAt: string;
  members: EventMember[];
  expenses: EventExpense[];
  settlements: EventSettlement[];
}

export interface EventMember {
  id: string;
  name: string;
  avatar: string;
  phone: string;
  email: string;
  role: 'owner' | 'member';
}

export interface EventExpense {
  id: string;
  groupId: string;
  paidById: string;
  title: string;
  amount: number;
  currency: string;
  amountInGroupCurrency: number;
  category: 'food' | 'transport' | 'lodging' | 'entertainment' | 'other';
  splitType: 'equal' | 'exact' | 'shares';
  splits: Array<{ userId: string; amountOwed: number }>;
  receiptUrl?: string;
  createdAt: string;
}

export interface EventSettlement {
  id: string;
  groupId: string;
  payerId: string;
  payeeId: string;
  amount: number;
  currency: string;
  paymentMethod: 'sbp' | 'card' | 'cash' | 'other';
  proofUrl?: string;
  status: 'completed' | 'pending';
  createdAt: string;
}

export const INITIAL_MEMBERS: EventMember[] = [
  { id: 'user-me', name: 'Вы', avatar: '👤', phone: '', email: '', role: 'owner' }
];

export const INITIAL_GROUPS: EventGroup[] = [];
