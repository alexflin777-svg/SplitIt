export interface ScenarioMember {
  id: string;
  name: string;
  avatar: string;
  role: 'owner' | 'member';
  email: string;
}

export interface ScenarioExpense {
  id: string;
  title: string;
  amount: number;
  currency: string;
  amountInGroupCurrency: number;
  category: string;
  paidById: string;
  splits: Array<{ userId: string; amountOwed: number }>;
  createdAt: string;
}

export interface ScenarioSettlement {
  id: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  status: 'completed';
  createdAt: string;
}

export interface ScenarioGroup {
  id: string;
  name: string;
  category: string;
  currency: string;
  status: 'active';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  members: ScenarioMember[];
  expenses: ScenarioExpense[];
  settlements: ScenarioSettlement[];
}

function equalSplits(memberIds: string[], total: number) {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / memberIds.length);
  let remainder = cents - base * memberIds.length;

  return memberIds.map((userId) => {
    const amountInCents = base + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    return { userId, amountOwed: amountInCents / 100 };
  });
}

const TRAVEL_MEMBERS: ScenarioMember[] = [
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    name: 'Артём Волков',
    avatar: '🚙',
    role: 'owner',
    email: 'artem.travel@example.com',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000002',
    name: 'Елена Морозова',
    avatar: '🗺️',
    role: 'member',
    email: 'elena.travel@example.com',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000003',
    name: 'Михаил Орлов',
    avatar: '⛽',
    role: 'member',
    email: 'mikhail.travel@example.com',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000004',
    name: 'София Ким',
    avatar: '🏖️',
    role: 'member',
    email: 'sofia.travel@example.com',
  },
];

const travelIds = TRAVEL_MEMBERS.map((member) => member.id);

export const ROAD_TRIP_GROUP: ScenarioGroup = {
  id: 'group-road-trip-russia-turkey',
  name: 'Москва → Анталья: месяц на авто',
  category: 'trip',
  currency: 'RUB',
  status: 'active',
  createdBy: TRAVEL_MEMBERS[0].id,
  createdAt: '2026-08-01T08:00:00.000Z',
  updatedAt: '2026-08-30T18:00:00.000Z',
  members: TRAVEL_MEMBERS,
  expenses: [
    {
      id: 'trip-expense-1',
      title: 'Бензин по России',
      amount: 18_400,
      currency: 'RUB',
      amountInGroupCurrency: 18_400,
      category: 'transport',
      paidById: TRAVEL_MEMBERS[0].id,
      splits: equalSplits(travelIds, 18_400),
      createdAt: '2026-08-02T09:00:00.000Z',
    },
    {
      id: 'trip-expense-2',
      title: 'Отели по дороге',
      amount: 48_000,
      currency: 'RUB',
      amountInGroupCurrency: 48_000,
      category: 'lodging',
      paidById: TRAVEL_MEMBERS[1].id,
      splits: equalSplits(travelIds, 48_000),
      createdAt: '2026-08-05T19:00:00.000Z',
    },
    {
      id: 'trip-expense-3',
      title: 'Платные дороги и паром',
      amount: 12_800,
      currency: 'RUB',
      amountInGroupCurrency: 12_800,
      category: 'transport',
      paidById: TRAVEL_MEMBERS[2].id,
      splits: equalSplits(travelIds, 12_800),
      createdAt: '2026-08-09T12:00:00.000Z',
    },
    {
      id: 'trip-expense-4',
      title: 'Дом в Анталье на месяц',
      amount: 124_000,
      currency: 'RUB',
      amountInGroupCurrency: 124_000,
      category: 'lodging',
      paidById: TRAVEL_MEMBERS[3].id,
      splits: equalSplits(travelIds, 124_000),
      createdAt: '2026-08-10T10:00:00.000Z',
    },
    {
      id: 'trip-expense-5',
      title: 'Продукты и бытовые покупки',
      amount: 10_000,
      currency: 'TRY',
      amountInGroupCurrency: 36_400,
      category: 'food',
      paidById: TRAVEL_MEMBERS[0].id,
      splits: equalSplits(travelIds, 36_400),
      createdAt: '2026-08-18T14:00:00.000Z',
    },
    {
      id: 'trip-expense-6',
      title: 'Страховка и мобильная связь',
      amount: 20_400,
      currency: 'RUB',
      amountInGroupCurrency: 20_400,
      category: 'other',
      paidById: TRAVEL_MEMBERS[1].id,
      splits: equalSplits(travelIds, 20_400),
      createdAt: '2026-08-25T11:00:00.000Z',
    },
  ],
  settlements: [
    {
      id: 'trip-settlement-1',
      fromUserId: TRAVEL_MEMBERS[0].id,
      toUserId: TRAVEL_MEMBERS[1].id,
      amount: 3_400,
      currency: 'RUB',
      paymentMethod: 'sbp',
      status: 'completed',
      createdAt: '2026-08-29T15:00:00.000Z',
    },
  ],
};

const GRADUATION_NAMES = [
  'Анна Смирнова',
  'Борис Соколов',
  'Вера Лебедева',
  'Глеб Новиков',
  'Дарья Козлова',
  'Егор Павлов',
  'Жанна Волкова',
  'Кирилл Морозов',
  'Лиза Орлова',
  'Максим Фёдоров',
];

const GRADUATION_MEMBERS: ScenarioMember[] = GRADUATION_NAMES.map((name, index) => ({
  id: `b0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  name,
  avatar: index === 0 ? '🎓' : '👤',
  role: index === 0 ? 'owner' : 'member',
  email: `graduate-${index + 1}@example.com`,
}));

const graduationIds = GRADUATION_MEMBERS.map((member) => member.id);

export const GRADUATION_GROUP: ScenarioGroup = {
  id: 'group-university-graduation',
  name: 'Выпускной университета 2026',
  category: 'party',
  currency: 'RUB',
  status: 'active',
  createdBy: GRADUATION_MEMBERS[0].id,
  createdAt: '2026-08-01T08:00:00.000Z',
  updatedAt: '2026-08-20T18:00:00.000Z',
  members: GRADUATION_MEMBERS,
  expenses: [
    {
      id: 'graduation-expense-1',
      title: 'Аренда банкетного зала',
      amount: 180_000,
      currency: 'RUB',
      amountInGroupCurrency: 180_000,
      category: 'entertainment',
      paidById: GRADUATION_MEMBERS[0].id,
      splits: equalSplits(graduationIds, 180_000),
      createdAt: '2026-08-02T10:00:00.000Z',
    },
    {
      id: 'graduation-expense-2',
      title: 'Банкет и напитки',
      amount: 140_000,
      currency: 'RUB',
      amountInGroupCurrency: 140_000,
      category: 'food',
      paidById: GRADUATION_MEMBERS[1].id,
      splits: equalSplits(graduationIds, 140_000),
      createdAt: '2026-08-04T10:00:00.000Z',
    },
    {
      id: 'graduation-expense-3',
      title: 'Фотограф и видеограф',
      amount: 60_000,
      currency: 'RUB',
      amountInGroupCurrency: 60_000,
      category: 'entertainment',
      paidById: GRADUATION_MEMBERS[2].id,
      splits: equalSplits(graduationIds, 60_000),
      createdAt: '2026-08-06T10:00:00.000Z',
    },
    {
      id: 'graduation-expense-4',
      title: 'DJ и музыкальное оборудование',
      amount: 45_000,
      currency: 'RUB',
      amountInGroupCurrency: 45_000,
      category: 'entertainment',
      paidById: GRADUATION_MEMBERS[3].id,
      splits: equalSplits(graduationIds, 45_000),
      createdAt: '2026-08-08T10:00:00.000Z',
    },
    {
      id: 'graduation-expense-5',
      title: 'Украшение зала',
      amount: 30_000,
      currency: 'RUB',
      amountInGroupCurrency: 30_000,
      category: 'other',
      paidById: GRADUATION_MEMBERS[4].id,
      splits: equalSplits(graduationIds, 30_000),
      createdAt: '2026-08-10T10:00:00.000Z',
    },
    {
      id: 'graduation-expense-6',
      title: 'Подарки преподавателям',
      amount: 25_000,
      currency: 'RUB',
      amountInGroupCurrency: 25_000,
      category: 'other',
      paidById: GRADUATION_MEMBERS[5].id,
      splits: equalSplits(graduationIds, 25_000),
      createdAt: '2026-08-12T10:00:00.000Z',
    },
    {
      id: 'graduation-expense-7',
      title: 'Трансфер после выпускного',
      amount: 20_000,
      currency: 'RUB',
      amountInGroupCurrency: 20_000,
      category: 'transport',
      paidById: GRADUATION_MEMBERS[6].id,
      splits: equalSplits(graduationIds, 20_000),
      createdAt: '2026-08-14T10:00:00.000Z',
    },
  ],
  settlements: [],
};

export const REALISTIC_GROUPS = [ROAD_TRIP_GROUP, GRADUATION_GROUP] as const;
