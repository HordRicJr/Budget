export type TransactionKind = 'income' | 'expense';
export type TransactionStatus = 'planned' | 'paid' | 'deferred';

export interface Category {
  id: string;
  name: string;
  kind: TransactionKind;
}

export interface Transaction {
  id: string;
  kind: TransactionKind;
  categoryId: string;
  categoryName?: string;
  amountXof: number;
  occurredOn: string;
  financialItemId?: string | null;
  dueOn: string | null;
  payee: string | null;
  note: string | null;
  status: TransactionStatus;
}

export interface MonthlySummary {
  incomeXof: number;
  plannedIncomeXof: number;
  expensesXof: number;
  plannedXof: number;
  availableXof: number;
}

export type FinancialItemKind = 'debt' | 'subscription' | 'project' | 'custom';
export type FinancialItemStatus = 'active' | 'paused' | 'completed' | 'cancelled';

export interface FinancialItem {
  id: string;
  kind: FinancialItemKind;
  name: string;
  targetAmountXof: number | null;
  remainingAmountXof: number | null;
  plannedAmountXof: number;
  dueOn: string | null;
  cadence: 'once' | 'weekly' | 'monthly' | 'yearly' | null;
  priority: number;
  deferralImpact: string;
  status: FinancialItemStatus;
  version: number;
}

export interface UnexpectedEvent {
  id: string;
  title: string;
  amountXof: number;
  occurredOn: string;
  dueOn: string | null;
  urgency: number;
  note: string;
  status: 'open' | 'planned' | 'resolved';
  version: number;
}

export interface ScenarioAction {
  itemId: string | null;
  itemName: string;
  action: 'reduce' | 'defer' | 'pause' | 'allocate';
  amountDeltaXof: number;
  consequence: string;
  itemVersion: number;
  priority: number;
  dueOn: string | null;
}

export interface ScenarioCandidate {
  id: string;
  actions: ScenarioAction[];
  availableBeforeXof: number;
  eventAmountXof: number;
  availableAfterXof: number;
  explanation: string;
  admissible: boolean;
}

export interface ScenarioSimulation {
  dataVersion: string;
  availableBeforeXof: number;
  event: { id: string; title: string; amountXof: number; urgency: number };
  candidates: ScenarioCandidate[];
}

export interface RecommendationResult {
  candidateId: string;
  rank: number;
  explanation: string;
  availableAfterXof: number;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}
