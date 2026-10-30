import { createServer } from 'node:http';
import { sendError } from '../api/_lib/http.js';
import login from '../api/auth/login.js';
import logout from '../api/auth/logout.js';
import me from '../api/auth/me.js';
import categories from '../api/categories.js';
import transactions from '../api/transactions.js';
import financialItems from '../api/financial-items.js';
import unexpectedEvents from '../api/unexpected-events.js';
import scenarios from '../api/scenarios.js';
import recommendations from '../api/recommendations.js';
import exportData from '../api/export.js';

const routes = new Map([
  ['/api/auth/login', login],
  ['/api/auth/logout', logout],
  ['/api/auth/me', me],
  ['/api/categories', categories],
  ['/api/transactions', transactions],
  ['/api/financial-items', financialItems],
  ['/api/unexpected-events', unexpectedEvents],
  ['/api/scenarios', scenarios],
  ['/api/recommendations', recommendations],
  ['/api/export', exportData],
]);

const server = createServer(async (req, res) => {
  const parsed = new URL(req.url ?? '/', 'http://localhost');
  const handler = routes.get(parsed.pathname);
  if (!handler) return sendError(res, 404, 'NOT_FOUND', 'La route demandée est introuvable.');

  req.query = Object.fromEntries(parsed.searchParams);
  try {
    await handler(req, res);
  } catch (error) {
    console.error('Erreur API locale:', error instanceof Error ? error.message : 'Erreur inconnue');
    if (!res.headersSent) sendError(res, 500, 'INTERNAL_ERROR', 'Une erreur serveur est survenue.');
  }
});

server.listen(3000, '127.0.0.1', () => {
  console.log('API Budget disponible sur http://127.0.0.1:3000');
});
