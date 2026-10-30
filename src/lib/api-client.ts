import type {
  ApiError, Category, FinancialItem, FinancialItemKind,
  MonthlySummary, RecommendationResult, ScenarioSimulation, Transaction,
  TransactionKind, TransactionStatus, UnexpectedEvent,
} from '../contracts/api';

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    ...init,
  });
  const responseBody = await response.text();
  let payload: T | ApiError;
  try {
    if (!responseBody) throw new Error('Empty response');
    payload = JSON.parse(responseBody) as T | ApiError;
  } catch {
    if (!response.ok) {
      throw new ApiRequestError(`Le serveur a répondu sans message exploitable (HTTP ${response.status}).`, response.status, 'INVALID_RESPONSE');
    }
    throw new Error('La réponse du serveur est invalide.');
  }
  if (!response.ok) {
    const error = payload as ApiError;
    throw new ApiRequestError(
      error.error?.message ?? 'Une erreur est survenue.',
      response.status,
      error.error?.code ?? 'REQUEST_FAILED',
    );
  }
  return payload as T;
}

export const api = {
  async login(email: string, password: string) {
    return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  },
  async logout() {
    return request('/api/auth/logout', { method: 'POST', body: '{}' });
  },
  async me() {
    return request<{ data: { authenticated: boolean } }>('/api/auth/me');
  },
  async categories() {
    const response = await request<{ data: Category[] }>('/api/categories');
    return response.data;
  },
  async transactions(month: string, offset = 0) {
    return request<{
      data: {
        month: string;
        summary: MonthlySummary;
        transactions: Transaction[];
        pagination: { offset: number; limit: number; hasMore: boolean; nextOffset: number };
      };
    }>(`/api/transactions?month=${encodeURIComponent(month)}&offset=${offset}`);
  },
  async createTransaction(input: {
    kind: TransactionKind;
    categoryId: string;
    amountXof: number;
    occurredOn: string;
    financialItemId?: string | null;
    dueOn?: string;
    payee?: string;
    note?: string;
    status: TransactionStatus;
  }) {
    return request<{ data: Transaction }>('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  async financialItems() {
    const response = await request<{ data: FinancialItem[] }>('/api/financial-items');
    return response.data;
  },
  async createFinancialItem(input: {
    kind: FinancialItemKind;
    name: string;
    plannedAmountXof: number;
    targetAmountXof?: number | null;
    remainingAmountXof?: number | null;
    dueOn?: string | null;
    cadence?: FinancialItem['cadence'];
    priority: number;
    deferralImpact?: string;
  }) {
    const response = await request<{ data: FinancialItem }>('/api/financial-items', { method: 'POST', body: JSON.stringify(input) });
    return response.data;
  },
  async updateFinancialItem(input: Partial<Omit<FinancialItem, 'id'>> & { id: string; version: number }) {
    const response = await request<{ data: FinancialItem }>('/api/financial-items', { method: 'PATCH', body: JSON.stringify(input) });
    return response.data;
  },
  async deleteFinancialItem(id: string, version: number) {
    return request<{ data: { id: string; deleted: boolean } }>('/api/financial-items', {
      method: 'DELETE', body: JSON.stringify({ id, version }),
    });
  },
  async unexpectedEvents() {
    const response = await request<{ data: UnexpectedEvent[] }>('/api/unexpected-events');
    return response.data;
  },
  async createUnexpectedEvent(input: {
    title: string;
    amountXof: number;
    occurredOn: string;
    dueOn?: string;
    urgency: number;
    note?: string;
  }) {
    const response = await request<{ data: UnexpectedEvent }>('/api/unexpected-events', { method: 'POST', body: JSON.stringify(input) });
    return response.data;
  },
  async updateUnexpectedEvent(input: Partial<Omit<UnexpectedEvent, 'id'>> & { id: string; version: number }) {
    const response = await request<{ data: UnexpectedEvent }>('/api/unexpected-events', { method: 'PATCH', body: JSON.stringify(input) });
    return response.data;
  },
  async simulateScenario(eventId: string, month: string) {
    const response = await request<{ data: ScenarioSimulation }>('/api/scenarios', {
      method: 'POST', body: JSON.stringify({ action: 'simulate', eventId, month }),
    });
    return response.data;
  },
  async confirmScenario(input: { eventId: string; month: string; candidateId: string; dataVersion: string; idempotencyKey: string }) {
    const response = await request<{ data: { scenarioId: string; result: unknown }; replayed: boolean }>('/api/scenarios', {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: JSON.stringify({ action: 'confirm', ...input }),
    });
    return response;
  },
  async recommendations(eventId: string, month: string) {
    const response = await request<{
      data: { recommendations: RecommendationResult[]; source: 'rules' | 'groq'; aiStatus: string; dataVersion: string };
    }>('/api/recommendations', { method: 'POST', body: JSON.stringify({ eventId, month }) });
    return response.data;
  },
  async exportData() {
    const response = await fetch('/api/export', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as ApiError | null;
      throw new ApiRequestError(body?.error?.message ?? 'L’export a échoué.', response.status, body?.error?.code ?? 'EXPORT_FAILED');
    }
    return response.blob();
  },
};
