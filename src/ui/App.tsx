import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiRequestError } from '../lib/api-client';
import type {
  Category, FinancialItem, MonthlySummary, RecommendationResult, ScenarioSimulation,
  Transaction, TransactionKind, TransactionStatus, UnexpectedEvent,
} from '../contracts/api';

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Abidjan', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const currentMonth = today.slice(0, 7);
const currency = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
type Page = 'overview' | 'movements' | 'priorities' | 'scenarios' | 'settings';

function formatXof(amount: number) {
  return `${currency.format(amount)} F CFA`;
}

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [items, setItems] = useState<FinancialItem[]>([]);
  const [events, setEvents] = useState<UnexpectedEvent[]>([]);
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [month, setMonth] = useState(currentMonth);
  const monthRef = useRef(month);
  const listVersion = useRef(0);
  monthRef.current = month;
  const [refreshKey, setRefreshKey] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState<Page>('overview');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [simulation, setSimulation] = useState<ScenarioSimulation | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationResult[]>([]);
  const [recommendationSource, setRecommendationSource] = useState('');
  const [recommendationEnabled, setRecommendationEnabled] = useState(false);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    setSimulation(null);
    setRecommendations([]);
    setRecommendationSource('');
  }, [month]);

  useEffect(() => {
    let active = true;
    api.me()
      .then(() => { if (active) setAuthenticated(true); })
      .catch((sessionError: Error) => {
        if (!active) return;
        if (sessionError instanceof ApiRequestError && sessionError.status === 401) setAuthenticated(false);
        else setError(sessionError.message);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (authenticated !== true) return;
    let active = true;
    listVersion.current += 1;
    setLoading(true);
    setTransactions([]);
    setSummary(null);
    setHasMore(false);
    Promise.all([api.categories(), api.transactions(month), api.financialItems(), api.unexpectedEvents()])
      .then(([categoryList, result, financialItems, unexpectedEvents]) => {
        if (!active) return;
        setCategories(categoryList);
        setTransactions(result.data.transactions);
        setSummary(result.data.summary);
        setHasMore(result.data.pagination.hasMore);
        setItems(financialItems);
        setEvents(unexpectedEvents);
        setSelectedEventId((current) => (
          unexpectedEvents.some((event) => event.id === current && event.status !== 'resolved')
            ? current
            : unexpectedEvents.find((event) => event.status !== 'resolved')?.id ?? ''
        ));
        setError('');
      })
      .catch((loadError: Error) => { if (active) setError(loadError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [month, authenticated, refreshKey]);

  async function handleLoadMore() {
    const requestedMonth = month;
    const requestedVersion = listVersion.current;
    setLoadingMore(true);
    try {
      const result = await api.transactions(requestedMonth, transactions.length);
      if (monthRef.current !== requestedMonth || listVersion.current !== requestedVersion) return;
      setTransactions((current) => [...current, ...result.data.transactions]);
      setHasMore(result.data.pagination.hasMore);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleSessionRetry() {
    setLoading(true);
    setError('');
    try {
      await api.me();
      setAuthenticated(true);
    } catch (sessionError) {
      if (sessionError instanceof ApiRequestError && sessionError.status === 401) setAuthenticated(false);
      else setError((sessionError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await api.login(String(form.get('email')), String(form.get('password')));
      setMonth(currentMonth);
      setLoading(true);
      setAuthenticated(true);
    } catch (loginError) {
      setError((loginError as Error).message);
    }
  }

  async function handleLogout() {
    try {
      await api.logout();
      setAuthenticated(false);
      setCategories([]);
      setTransactions([]);
      setItems([]);
      setEvents([]);
      setSummary(null);
      setSimulation(null);
    } catch (logoutError) {
      setError((logoutError as Error).message);
    }
  }

  async function handleCreateTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online) return;
    setError('');
    setNotice('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = {
      kind: String(form.get('kind')) as TransactionKind,
      categoryId: String(form.get('categoryId')),
      financialItemId: String(form.get('financialItemId') ?? '') || null,
      amountXof: Number(form.get('amountXof')),
      occurredOn: String(form.get('occurredOn')),
      dueOn: String(form.get('dueOn') ?? ''),
      payee: String(form.get('payee') ?? ''),
      note: String(form.get('note') ?? ''),
      status: String(form.get('status')) as TransactionStatus,
    };
    try {
      await api.createTransaction(payload);
      formElement.reset();
      const dateInput = document.querySelector<HTMLInputElement>('#transaction-date');
      if (dateInput) dateInput.value = today;
      setRefreshKey((value) => value + 1);
      setNotice('Mouvement enregistré. Votre solde a été recalculé.');
    } catch (saveError) {
      setError((saveError as Error).message);
    }
  }

  async function handleCreateItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await api.createFinancialItem({
        kind: String(form.get('kind')) as FinancialItem['kind'],
        name: String(form.get('name')),
        targetAmountXof: form.get('targetAmountXof') ? Number(form.get('targetAmountXof')) : null,
        remainingAmountXof: form.get('remainingAmountXof') ? Number(form.get('remainingAmountXof')) : null,
        plannedAmountXof: Number(form.get('plannedAmountXof')),
        dueOn: String(form.get('dueOn') ?? '') || null,
        cadence: (String(form.get('cadence') ?? '') || null) as FinancialItem['cadence'],
        priority: Number(form.get('priority')),
        deferralImpact: String(form.get('deferralImpact') ?? ''),
      });
      formElement.reset();
      setRefreshKey((value) => value + 1);
      setNotice('Engagement ajouté à vos priorités.');
    } catch (saveError) {
      setError((saveError as Error).message);
    }
  }

  async function handleUpdateItem(item: FinancialItem, form: FormEvent<HTMLFormElement>) {
    form.preventDefault();
    if (!online) return;
    const values = new FormData(form.currentTarget);
    try {
      await api.updateFinancialItem({
        id: item.id,
        version: item.version,
        priority: Number(values.get('priority')),
        plannedAmountXof: Number(values.get('plannedAmountXof')),
        dueOn: String(values.get('dueOn') ?? '') || null,
        deferralImpact: String(values.get('deferralImpact') ?? ''),
        status: String(values.get('status')) as FinancialItem['status'],
      });
      setRefreshKey((value) => value + 1);
      setNotice('Engagement mis à jour.');
    } catch (updateError) {
      setError((updateError as Error).message);
    }
  }

  async function handleDeleteItem(item: FinancialItem) {
    if (!online || !window.confirm(`Supprimer « ${item.name} » ?`)) return;
    try {
      await api.deleteFinancialItem(item.id, item.version);
      setRefreshKey((value) => value + 1);
      setNotice('Engagement supprimé.');
    } catch (deleteError) {
      setError((deleteError as Error).message);
    }
  }

  async function handleCreateEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const created = await api.createUnexpectedEvent({
        title: String(form.get('title')),
        amountXof: Number(form.get('amountXof')),
        occurredOn: String(form.get('occurredOn')),
        dueOn: String(form.get('dueOn') ?? ''),
        urgency: Number(form.get('urgency')),
        note: String(form.get('note') ?? ''),
      });
      formElement.reset();
      setSelectedEventId(created.id);
      setSimulation(null);
      setRecommendations([]);
      setRefreshKey((value) => value + 1);
      setNotice('Imprévu enregistré. Vous pouvez maintenant comparer des options.');
    } catch (saveError) {
      setError((saveError as Error).message);
    }
  }

  async function handleSimulate() {
    if (!online || !selectedEventId) return;
    setError('');
    setSimulation(null);
    setRecommendations([]);
    try {
      setSimulation(await api.simulateScenario(selectedEventId, month));
    } catch (simulationError) {
      setError((simulationError as Error).message);
    }
  }

  async function handleRecommendations() {
    if (!online || !selectedEventId || !recommendationEnabled) return;
    setError('');
    try {
      const result = await api.recommendations(selectedEventId, month);
      setRecommendations(result.recommendations);
      setRecommendationSource(result.source === 'groq'
        ? 'Groq · options déterministes classées et validées'
        : result.aiStatus === 'disabled'
          ? 'Règles déterministes · aide IA désactivée'
          : result.aiStatus === 'no_admissible_options'
            ? 'Règles déterministes · aucune option ne couvre l’imprévu'
          : result.aiStatus === 'rate_limited'
            ? 'Règles déterministes · limite d’appels IA atteinte'
            : 'Règles déterministes · service IA indisponible, repli utilisé');
    } catch (recommendationError) {
      setError((recommendationError as Error).message);
    }
  }

  async function handleConfirmScenario(candidateId: string) {
    if (!online || !simulation || !selectedEventId) return;
    const candidate = simulation.candidates.find((option) => option.id === candidateId);
    if (!candidate?.admissible) return;
    const actionSummary = candidate.actions.length
      ? candidate.actions.map((action) => `${action.action} « ${action.itemName} »`).join(', ')
      : 'aucune modification des engagements';
    if (!window.confirm(`Confirmer ce scénario (${actionSummary}) ? Les modifications seront appliquées immédiatement.`)) return;
    try {
      await api.confirmScenario({
        eventId: selectedEventId,
        month,
        candidateId,
        dataVersion: simulation.dataVersion,
        idempotencyKey: crypto.randomUUID(),
      });
      setSimulation(null);
      setRecommendations([]);
      setRefreshKey((value) => value + 1);
      setNotice('Scénario confirmé une seule fois; l’imprévu est marqué comme résolu.');
    } catch (confirmError) {
      setError((confirmError as Error).message);
    }
  }

  async function handleResolveEvent(event: UnexpectedEvent) {
    if (!online || !window.confirm(`Marquer « ${event.title} » comme résolu ?`)) return;
    try {
      await api.updateUnexpectedEvent({ id: event.id, version: event.version, status: 'resolved' });
      setRefreshKey((value) => value + 1);
      setNotice('Imprévu marqué comme résolu.');
    } catch (updateError) {
      setError((updateError as Error).message);
    }
  }

  async function handleExport() {
    if (!online || !window.confirm('Télécharger une copie de toutes vos données budgétaires privées ?')) return;
    try {
      const blob = await api.exportData();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'budget-export.json';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Export téléchargé sur cet appareil.');
    } catch (exportError) {
      setError((exportError as Error).message);
    }
  }

  const monthlyTitle = useMemo(() => new Intl.DateTimeFormat('fr-FR', {
    month: 'long', year: 'numeric', timeZone: 'Africa/Abidjan',
  }).format(new Date(`${month}-01T12:00:00Z`)), [month]);

  if (loading) return <main className="loading-screen"><span className="brand-mark">B</span><p>Préparation de votre espace…</p></main>;
  if (authenticated === null) {
    return <main className="loading-screen"><p role="alert">{error || 'Impossible de vérifier votre session.'}</p><button className="primary-button retry-button" onClick={handleSessionRetry}>Réessayer</button></main>;
  }
  if (!authenticated) {
    return (
      <main className="login-layout">
        <section className="login-story">
          <span className="brand-mark">B</span><p className="eyebrow">VOTRE ARGENT, VOS CHOIX</p>
          <h1>Un mois plus clair commence ici.</h1>
          <p className="muted">Suivez vos revenus et vos dépenses en francs CFA. Vos données restent privées.</p>
          <div className="login-note"><span>●</span> Accès personnel et sécurisé</div>
        </section>
        <section className="login-panel">
          <div className="form-heading"><p className="eyebrow">BON RETOUR</p><h2>Se connecter</h2><p className="muted">Entrez les identifiants de votre compte Budget.</p></div>
          <form onSubmit={handleLogin} className="stack-form">
            <label>Adresse courriel<input name="email" type="email" autoComplete="username" required /></label>
            <label>Mot de passe<input name="password" type="password" autoComplete="current-password" required /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit">Ouvrir mon espace <span>→</span></button>
          </form>
          <p className="privacy-caption">Votre espace est privé. Aucun compte n’est créé depuis cette page.</p>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={() => setPage('overview')}><span className="brand-mark small">B</span><span>budget<span className="brand-dot">.</span></span></a>
        <p className="nav-label">ESPACE PERSONNEL</p>
        <nav className="main-nav" aria-label="Navigation principale">
          <NavButton page="overview" current={page} onClick={setPage} icon="◫">Accueil</NavButton>
          <NavButton page="movements" current={page} onClick={setPage} icon="↕">Mouvements</NavButton>
          <NavButton page="priorities" current={page} onClick={setPage} icon="◎">Priorités</NavButton>
          <NavButton page="scenarios" current={page} onClick={setPage} icon="↗">Imprévus</NavButton>
          <NavButton page="settings" current={page} onClick={setPage} icon="⚙">Plus</NavButton>
        </nav>
        <div className="sidebar-bottom">
          <div className="private-card"><span className="lock-icon">⌑</span><div><strong>Vos données restent privées</strong><small>Accès protégé · XOF</small></div></div>
          <button className="logout-button" onClick={handleLogout}><span>↪</span> Se déconnecter</button>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">Mon espace <span>/</span> <strong>{pageTitle(page)}</strong></div>
          <div className="topbar-right"><span className={`connection-badge ${online ? 'online' : 'offline'}`}>{online ? 'En ligne' : 'Hors ligne'}</span><span className="timezone-badge">GMT+0 · Abidjan</span><span className="avatar">A</span><button className="mobile-logout" onClick={handleLogout}>Quitter</button></div>
        </header>
        <div className="page-content">
          {!online && <div className="alert offline-alert" role="status">Hors connexion : les données affichées ne sont pas actualisées. Les saisies et mutations sont désactivées et ne seront pas enregistrées hors ligne.</div>}
          {error && <div className="alert error-alert" role="alert">{error}</div>}
          {notice && <div className="alert success-alert" role="status">{notice}</div>}
          {page === 'overview' && (
            <>
              <section className="welcome-row">
                <div><p className="eyebrow">SUIVI PERSONNEL</p><h1>Votre mois, en clair.</h1><p className="muted">Gardez le cap, une décision à la fois.</p></div>
                <MonthPicker month={month} onChange={setMonth} />
              </section>
              <Summary summary={summary} monthTitle={monthlyTitle} />
              <section className="workspace-grid">
                <section className="panel transaction-panel">
                  <PanelHeading eyebrow="SAISIE RAPIDE" title="Ajouter un mouvement" />
                  <TransactionForm categories={categories} items={items} onSubmit={handleCreateTransaction} disabled={!online} />
                </section>
                <TransactionHistory transactions={transactions.slice(0, 8)} monthTitle={monthlyTitle} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={handleLoadMore} />
              </section>
            </>
          )}
          {page === 'movements' && (
            <>
              <PageHeading eyebrow="HISTORIQUE" title="Vos mouvements" description="Revenus et dépenses du mois sélectionné." month={<MonthPicker month={month} onChange={setMonth} />} />
              <Summary summary={summary} monthTitle={monthlyTitle} />
              <section className="workspace-grid movements-grid">
                <section className="panel transaction-panel"><PanelHeading eyebrow="SAISIE RAPIDE" title="Ajouter un mouvement" /><TransactionForm categories={categories} items={items} onSubmit={handleCreateTransaction} disabled={!online} /></section>
                <TransactionHistory transactions={transactions} monthTitle={monthlyTitle} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={handleLoadMore} />
              </section>
            </>
          )}
          {page === 'priorities' && (
            <>
              <PageHeading eyebrow="ENGAGEMENTS" title="Vos priorités" description="Montants planifiés, échéances et conséquences restent distincts des paiements." month={<MonthPicker month={month} onChange={setMonth} />} />
              <section className="planning-grid">
                <section className="panel">
                  <PanelHeading eyebrow="NOUVEL ENGAGEMENT" title="Ajouter une priorité" />
                  <FinancialItemForm onSubmit={handleCreateItem} disabled={!online} />
                </section>
                <section className="panel">
                  <PanelHeading eyebrow="ENGAGEMENTS ENREGISTRÉS" title={`${items.length} priorité${items.length === 1 ? '' : 's'}`} />
                  {items.length === 0 ? <EmptyMessage>Ajoutez un engagement pour préparer vos arbitrages.</EmptyMessage> : (
                    <ul className="planning-list">{items.map((item) => (
                      <li className="planning-card" key={item.id}>
                        <div className="planning-card-heading"><div><span className="kind-label">{itemKind(item.kind)}</span><strong>{item.name}</strong></div><span className={`status-pill ${item.status}`}>{item.status}</span></div>
                        <p className="planning-meta">{formatXof(item.plannedAmountXof)} prévus · priorité {item.priority}/5 · {item.dueOn ? `échéance ${item.dueOn}` : 'sans échéance'}</p>
                        {item.remainingAmountXof != null && <p className="planning-meta">Reste dû : {formatXof(item.remainingAmountXof)}</p>}
                        {item.deferralImpact && <p className="consequence-note">Report : {item.deferralImpact}</p>}
                        <details className="edit-details"><summary>Modifier</summary>
                          <form className="compact-form" onSubmit={(event) => handleUpdateItem(item, event)}>
                            <label>Montant prévu<input name="plannedAmountXof" type="number" min="0" step="1" defaultValue={item.plannedAmountXof} required /></label>
                            <label>Priorité<select name="priority" defaultValue={item.priority}>{[1, 2, 3, 4, 5].map((priority) => <option key={priority} value={priority}>{priority}/5</option>)}</select></label>
                            <label>Échéance<input name="dueOn" type="date" defaultValue={item.dueOn ?? ''} /></label>
                            <label>Statut<select name="status" defaultValue={item.status}><option value="active">Actif</option><option value="paused">En pause</option><option value="completed">Terminé</option><option value="cancelled">Annulé</option></select></label>
                            <label className="wide-field">Conséquence d’un report<input name="deferralImpact" maxLength={500} defaultValue={item.deferralImpact} /></label>
                            <button className="secondary-button" disabled={!online}>Enregistrer les changements</button>
                            <button className="text-button delete-button" type="button" disabled={!online} onClick={() => void handleDeleteItem(item)}>Supprimer</button>
                          </form>
                        </details>
                      </li>
                    ))}</ul>
                  )}
                </section>
              </section>
            </>
          )}
          {page === 'scenarios' && (
            <>
              <PageHeading eyebrow="ARBITRAGES" title="Préparer un imprévu" description="Comparez des options explicables. Rien n’est appliqué avant votre confirmation." month={<MonthPicker month={month} onChange={setMonth} />} />
              <section className="planning-grid scenario-grid">
                <section className="panel">
                  <PanelHeading eyebrow="NOUVEL ÉVÉNEMENT" title="Enregistrer un imprévu" />
                  <UnexpectedEventForm onSubmit={handleCreateEvent} disabled={!online} />
                </section>
                <section className="panel">
                  <PanelHeading eyebrow="SIMULATION" title="Comparer les options" />
                  <div className="form-content">
                    <label className="field-label">Imprévu ouvert<select value={selectedEventId} onChange={(event) => { setSelectedEventId(event.target.value); setSimulation(null); setRecommendations([]); }}><option value="">Choisir un imprévu…</option>{events.filter((item) => item.status !== 'resolved').map((item) => <option key={item.id} value={item.id}>{item.title} · {formatXof(item.amountXof)}</option>)}</select></label>
                    <div className="event-list">{events.filter((item) => item.status !== 'resolved').map((event) => <div className="event-summary" key={event.id}><div><strong>{event.title}</strong><span>{formatXof(event.amountXof)} · urgence {event.urgency}/5{event.dueOn ? ` · échéance ${event.dueOn}` : ''}</span></div><button className="text-button" disabled={!online} onClick={() => void handleResolveEvent(event)}>Résolu</button></div>)}</div>
                    <button className="secondary-button" disabled={!online || !selectedEventId} onClick={() => void handleSimulate()}>Simuler sans enregistrer</button>
                    {simulation && <SimulationResults simulation={simulation} onConfirm={handleConfirmScenario} disabled={!online} />}
                    {selectedEventId && <div className="recommendation-control">
                      <label className="toggle-row"><input type="checkbox" checked={recommendationEnabled} onChange={(event) => { setRecommendationEnabled(event.target.checked); setRecommendations([]); }} />Autoriser l’aide facultative de Groq</label>
                      <p className="form-hint left-hint">En cliquant, seuls les totaux, échéances, priorités et options admissibles sont envoyés. Notes et bénéficiaires sont exclus.</p>
                      <button className="secondary-button" disabled={!online || !recommendationEnabled} onClick={() => void handleRecommendations()}>Classer ces options</button>
                      {recommendationSource && <p className="source-label" role="status">{recommendationSource}</p>}
                      {recommendations.length > 0 && <ol className="recommendation-list">{recommendations.map((item) => <li key={item.candidateId}><strong>Option {item.rank}</strong><span>{item.explanation}</span><small>Solde après imprévu : {formatXof(item.availableAfterXof)}</small></li>)}</ol>}
                    </div>}
                  </div>
                </section>
              </section>
            </>
          )}
          {page === 'settings' && (
            <>
              <PageHeading eyebrow="PLUS" title="Réglages et vie privée" description="Contrôlez l’accès, l’aide externe et la portabilité de vos données." />
              <div className="settings-grid">
                <section className="panel settings-card"><PanelHeading eyebrow="CONFIGURATION" title="Votre espace" /><div className="settings-body"><p>Devise : <strong>XOF — franc CFA BCEAO</strong></p><p>Fuseau : <strong>Africa/Abidjan (GMT+0)</strong></p><p>Synchronisation : PostgreSQL via le serveur, lorsque le réseau est disponible.</p><div className="pwa-note">Installation PWA disponible depuis le menu de partage ou le menu du navigateur. Hors ligne, seul le shell statique reste accessible.</div></div></section>
                <section className="panel settings-card"><PanelHeading eyebrow="VOS DONNÉES" title="Exporter votre budget" /><div className="settings-body"><p>L’export contient les données financières de ce compte uniquement. Il est généré côté serveur et n’est jamais mis en cache.</p><button className="secondary-button" disabled={!online} onClick={() => void handleExport()}>Télécharger l’export JSON</button></div></section>
                <section className="panel settings-card privacy-policy"><PanelHeading eyebrow="AIDE IA" title="Groq reste facultatif" /><div className="settings-body"><p>Vous choisissez d’activer l’envoi à chaque demande. Les montants agrégés, échéances, priorités et actions proposées peuvent être transmis; les notes, bénéficiaires et historiques bruts ne le sont pas.</p><p>Une panne, une réponse invalide ou une limite d’usage laisse les options déterministes disponibles.</p></div></section>
                <section className="panel settings-card privacy-policy"><PanelHeading eyebrow="SUPPRESSION" title="Demande de suppression" /><div className="settings-body"><p>La suppression automatique du compte n’est pas proposée. Avant la mise en production, une demande de suppression est traitée manuellement après vérification.</p></div></section>
              </div>
            </>
          )}
          <footer className="page-footer"><span>Budget personnel <b>·</b> Vos décisions restent les vôtres.</span><span>Franc CFA BCEAO <b>·</b> GMT+0</span></footer>
        </div>
      </main>
    </div>
  );
}

function NavButton({ page, current, onClick, icon, children }: { page: Page; current: Page; onClick: (page: Page) => void; icon: string; children: string }) {
  return <button type="button" className={`nav-item ${current === page ? 'active' : ''}`} aria-current={current === page ? 'page' : undefined} onClick={() => onClick(page)}><span>{icon}</span>{children}</button>;
}

function pageTitle(page: Page) {
  return ({ overview: 'Accueil', movements: 'Mouvements', priorities: 'Priorités', scenarios: 'Imprévus', settings: 'Plus' })[page];
}

function PageHeading({ eyebrow, title, description, month }: { eyebrow: string; title: string; description: string; month?: React.ReactNode }) {
  return <section className="welcome-row"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{description}</p></div>{month}</section>;
}

function MonthPicker({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  return <label className="month-picker"><span>Mois suivi</span><input type="month" value={month} onChange={(event) => onChange(event.target.value || currentMonth)} /></label>;
}

function Summary({ summary, monthTitle }: { summary: MonthlySummary | null; monthTitle: string }) {
  return <section className="summary-grid" aria-label="Résumé du mois">
    <article className="balance-card"><div className="balance-top"><span className="card-label">DISPONIBLE CE MOIS-CI</span><span className="balance-icon">↗</span></div><strong className="balance-amount">{summary ? formatXof(summary.availableXof) : '—'}</strong><p>Après les dépenses planifiées, hors revenus non encaissés</p><div className="balance-footer"><span className="balance-indicator"></span> Calculé côté serveur à partir de vos saisies</div></article>
    <MetricCard label="REVENUS ENCAISSÉS" amount={summary?.incomeXof ?? null} period={monthTitle} tone="green" icon="＋" />
    <MetricCard label="REVENUS PRÉVUS" amount={summary?.plannedIncomeXof ?? null} period={monthTitle} tone="amber" icon="◷" />
    <MetricCard label="DÉPENSES PAYÉES" amount={summary?.expensesXof ?? null} period={monthTitle} tone="coral" icon="−" />
    <MetricCard label="DÉPENSES PRÉVUES" amount={summary?.plannedXof ?? null} period={monthTitle} tone="amber" icon="◷" />
  </section>;
}

function MetricCard({ label, amount, period, tone, icon }: { label: string; amount: number | null; period: string; tone: string; icon: string }) {
  return <article className="metric-card"><div className="metric-heading"><span className={`metric-icon ${tone}`}>{icon}</span><span className="card-label">{label}</span></div><strong>{amount == null ? '—' : formatXof(amount)}</strong><small>Sur {period}</small></article>;
}

function PanelHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <div className="panel-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div></div>;
}

function TransactionForm({ categories, items, onSubmit, disabled }: { categories: Category[]; items: FinancialItem[]; onSubmit: (event: FormEvent<HTMLFormElement>) => void; disabled: boolean }) {
  const [kind, setKind] = useState<TransactionKind>('expense');
  const availableCategories = categories.filter((category) => category.kind === kind);
  return <form className="transaction-form" onSubmit={onSubmit}>
    <fieldset disabled={disabled}>
      <div className="type-toggle" role="group" aria-label="Type de mouvement"><button type="button" className={kind === 'expense' ? 'selected expense-selected' : ''} onClick={() => setKind('expense')}>− Dépense</button><button type="button" className={kind === 'income' ? 'selected income-selected' : ''} onClick={() => setKind('income')}>＋ Revenu</button></div>
      <input type="hidden" name="kind" value={kind} />
      <label className="amount-label">Montant <span>FCFA</span><div className="amount-input"><input name="amountXof" type="number" min="1" step="1" placeholder="0" required /><span>F CFA</span></div></label>
      <div className="form-row"><label>Catégorie<select name="categoryId" required defaultValue=""><option value="" disabled>Choisir…</option>{availableCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Date<input id="transaction-date" name="occurredOn" type="date" defaultValue={today} required /></label></div>
      <div className="form-row"><label>Bénéficiaire / source <span className="optional">Facultatif</span><input name="payee" maxLength={120} placeholder="Ex. Marché, salaire…" /></label><label>Statut<select name="status" defaultValue="paid"><option value="paid">Payé / reçu</option><option value="planned">Prévu</option><option value="deferred">Reporté</option></select></label></div>
      <details className="extra-fields"><summary>Ajouter une note, une échéance ou un engagement <span>+</span></summary><div className="form-row extra-row"><label>Échéance<input name="dueOn" type="date" /></label><label>Note<input name="note" maxLength={500} placeholder="Un détail utile…" /></label>{kind === 'expense' && <label className="wide-field">Engagement lié<select name="financialItemId" defaultValue=""><option value="">Aucun</option>{items.filter((item) => item.status === 'active').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div></details>
      <button className="primary-button save-button" type="submit" disabled={availableCategories.length === 0}>Enregistrer le mouvement <span>→</span></button>
    </fieldset>
    {availableCategories.length === 0 && <p className="form-hint">Aucune catégorie disponible pour ce type de mouvement.</p>}
    <p className="form-hint"><span>⌑</span> {disabled ? 'Connectez-vous pour enregistrer.' : 'Enregistré dans votre espace privé'}</p>
  </form>;
}

function TransactionHistory({ transactions, monthTitle, hasMore, loadingMore, onLoadMore }: { transactions: Transaction[]; monthTitle: string; hasMore: boolean; loadingMore: boolean; onLoadMore: () => void }) {
  return <section className="panel recent-panel"><div className="panel-heading recent-heading"><div><p className="eyebrow">VOTRE HISTORIQUE</p><h2>{monthTitle}</h2></div><span className="count-badge">{transactions.length} mouvement{transactions.length === 1 ? '' : 's'}</span></div>
    {transactions.length === 0 ? <EmptyMessage>Ajoutez un revenu ou une dépense pour voir votre mois prendre forme.</EmptyMessage> : <ul className="transaction-list">{transactions.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} />)}</ul>}
    {hasMore && <button className="load-more-button" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? 'Chargement…' : 'Afficher les mouvements suivants'}</button>}
    {transactions.length > 0 && <div className="list-footer">Les totaux sont recalculés après chaque saisie.</div>}
  </section>;
}

function TransactionRow({ transaction }: { transaction: Transaction }) {
  const isIncome = transaction.kind === 'income';
  const displayDate = transaction.status === 'paid' ? transaction.occurredOn : transaction.dueOn || transaction.occurredOn;
  const dateLabel = transaction.status === 'paid' ? 'Le' : 'Échéance';
  return <li className="transaction-row"><span className={`transaction-icon ${isIncome ? 'income-icon' : 'expense-icon'}`}>{isIncome ? '↙' : '↗'}</span><div className="transaction-detail"><strong>{transaction.payee || transaction.categoryName || 'Mouvement'}</strong><span>{transaction.categoryName} · {dateLabel} {new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Africa/Abidjan' }).format(new Date(`${displayDate}T12:00:00Z`))}</span></div><div className="transaction-amount"><strong className={isIncome ? 'income-text' : ''}>{isIncome ? '+' : '−'}{formatXof(transaction.amountXof)}</strong>{transaction.status !== 'paid' && <span className={`status-pill ${transaction.status}`}>{transaction.status === 'planned' ? 'Prévu' : 'Reporté'}</span>}</div></li>;
}

function FinancialItemForm({ onSubmit, disabled }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; disabled: boolean }) {
  return <form className="form-content" onSubmit={onSubmit}><fieldset disabled={disabled}>
    <label className="field-label">Nom<input name="name" maxLength={120} required placeholder="Ex. Loyer, dette, moto…" /></label>
    <div className="form-row"><label className="field-label">Type<select name="kind" defaultValue="custom"><option value="debt">Dette</option><option value="subscription">Abonnement</option><option value="project">Projet</option><option value="custom">Autre poste</option></select></label><label className="field-label">Montant planifié<input name="plannedAmountXof" type="number" min="0" step="1" required /></label></div>
    <div className="form-row"><label className="field-label">Montant total<input name="targetAmountXof" type="number" min="0" step="1" /></label><label className="field-label">Solde restant<input name="remainingAmountXof" type="number" min="0" step="1" /></label></div>
    <div className="form-row"><label className="field-label">Échéance<input name="dueOn" type="date" /></label><label className="field-label">Périodicité<select name="cadence" defaultValue=""><option value="">Aucune</option><option value="once">Unique</option><option value="weekly">Hebdomadaire</option><option value="monthly">Mensuelle</option><option value="yearly">Annuelle</option></select></label></div>
    <div className="form-row"><label className="field-label">Priorité<select name="priority" defaultValue="3">{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}/5</option>)}</select></label><label className="field-label">Conséquence du report<input name="deferralImpact" maxLength={500} placeholder="Frais, pénalité, retard…" /></label></div>
    <button className="primary-button" disabled={disabled}>Ajouter l’engagement</button>
  </fieldset></form>;
}

function UnexpectedEventForm({ onSubmit, disabled }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; disabled: boolean }) {
  return <form className="form-content" onSubmit={onSubmit}><fieldset disabled={disabled}>
    <label className="field-label">Intitulé<input name="title" maxLength={120} required placeholder="Ex. Réparation urgente" /></label>
    <div className="form-row"><label className="field-label">Montant<input name="amountXof" type="number" min="1" step="1" required /></label><label className="field-label">Urgence<select name="urgency" defaultValue="3">{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}/5</option>)}</select></label></div>
    <div className="form-row"><label className="field-label">Date<input name="occurredOn" type="date" defaultValue={today} required /></label><label className="field-label">Échéance<input name="dueOn" type="date" /></label></div>
    <label className="field-label">Note (facultative)<input name="note" maxLength={500} /></label>
    <button className="primary-button">Enregistrer l’imprévu</button>
  </fieldset></form>;
}

function SimulationResults({ simulation, onConfirm, disabled }: { simulation: ScenarioSimulation; onConfirm: (id: string) => void; disabled: boolean }) {
  const hasAdmissible = simulation.candidates.some((candidate) => candidate.admissible);
  return <div className="simulation-results" aria-live="polite">
    <div className="simulation-baseline"><span>Solde avant : <strong>{formatXof(simulation.availableBeforeXof)}</strong></span><span>Imprévu : <strong>−{formatXof(simulation.event.amountXof)}</strong></span></div>
    {!hasAdmissible && <p className="alert error-alert">Aucune combinaison ne couvre entièrement cet imprévu. Les options ci-dessous signalent le manque; elles ne peuvent pas être confirmées.</p>}
    <h3>Options déterministes</h3>
    <ol className="candidate-list">{simulation.candidates.map((candidate) => <li className="candidate-card" key={candidate.id}>
      <div className="candidate-header"><strong>{candidate.actions.length ? candidate.actions.map((action) => `${action.action} · ${action.itemName}`).join(' + ') : 'Utiliser le solde disponible'}</strong><span className={candidate.admissible ? 'covered' : 'shortfall'}>{candidate.admissible ? 'Couvrable' : `Manque ${formatXof(Math.abs(candidate.availableAfterXof))}`}</span></div>
      <p>{candidate.explanation}</p><p className="candidate-balance">Après l’imprévu : <strong>{formatXof(candidate.availableAfterXof)}</strong></p>
      {candidate.actions.map((action) => <p className="consequence-note" key={`${action.itemId}-${action.action}`}>{action.action} {formatXof(action.amountDeltaXof)} · {action.consequence}</p>)}
      <button className="secondary-button" disabled={disabled || !candidate.admissible} onClick={() => onConfirm(candidate.id)}>Confirmer cette option</button>
    </li>)}</ol>
  </div>;
}

function EmptyMessage({ children }: { children: string }) {
  return <div className="empty-state"><span className="empty-icon">↗</span><strong>Rien à afficher pour le moment.</strong><p>{children}</p></div>;
}

function itemKind(kind: FinancialItem['kind']) {
  return ({ debt: 'Dette', subscription: 'Abonnement', project: 'Projet', custom: 'Autre poste' })[kind];
}

export default App;
