'use strict';
// ============================================================
// electron/ipc/dashboard/handlers.cjs
// LIFE'S ART ERP — Dashboard Handlers
// ⭐ FIX: Bénéfice net = CA − Dépenses − ACHATS
// ⭐ FIX #4: CA = COMMANDES (nesorina ny FACTURES)
// ⭐ FIX: computeVariation misy fetra ±999%
// ⭐ FIX: withDb → auto-forceReconnect raha tsy misokatra ny DB
// ⭐ FIX: ESORINA ny factures
// ⭐ FIX: ESORINA ny RH / employés / paiements / salaires
// ⭐ FIX: Dette client — mifanaraka amin'ny Commandes
//         (total_ttc − montant_paye ho an'ny 'Non payé' + 'Partiel')
// ============================================================

const { getDb, forceReconnect } = require('../../database/connection.cjs');
const { log, error } = require('../../database/utils.cjs');
const {
  getSnapshotAtDate,
  getSnapshotSeries,
  computeCurrentSnapshot,
  computeRotationRate,
} = require('../../database/stockSnapshots.cjs');

const DEBUG_BENEFICE = false;
const DEBUG = false;

function debugLog(...args) {
  if (DEBUG) console.log('[📊 dashboard]', ...args);
}

// ⭐⭐⭐ WRAPPER: withDb — auto-reconnect + centralized error handling ⭐⭐⭐
function withDb(fn) {
  return (event, ...args) => {
    try {
      let db = getDb();

      if (!db || !db.open) {
        debugLog('⚠️ DB non ouverte, tentative forceReconnect...');
        try {
          db = forceReconnect();
        } catch (reconnectErr) {
          error('❌ [dashboard] forceReconnect failed:', reconnectErr?.message);
        }
      }

      if (!db || !db.open) {
        error('❌ [dashboard] Database connection is not open après forceReconnect');
        return { success: false, error: 'Database connection is not open' };
      }

      return fn(db, event, ...args);
    } catch (err) {
      error('❌ [dashboard] withDb:', err?.message || err);
      return { success: false, error: err?.message || 'Dashboard database error' };
    }
  };
}

// ────────────────────────────────────────────────────────────
// HELPERS GÉNÉRIQUES
// ────────────────────────────────────────────────────────────
function tableExists(db, tableName) {
  try {
    if (!db || !tableName) return false;
    const stmt = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`);
    return !!stmt.get(tableName);
  } catch (_) { return false; }
}

function columnExists(db, tableName, columnName) {
  try {
    if (!tableExists(db, tableName)) return false;
    const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
    return columns.some((c) => String(c.name).toLowerCase() === String(columnName).toLowerCase());
  } catch (_) { return false; }
}

function getTableColumns(db, tableName) {
  try {
    if (!tableExists(db, tableName)) return [];
    return db.prepare(`PRAGMA table_info("${tableName}")`).all().map((c) => String(c.name));
  } catch (_) { return []; }
}

function findDateColumn(db, tableName, preferredColumns = []) {
  try {
    const columns = getTableColumns(db, tableName);
    if (!columns.length) return null;
    const lowerMap = new Map(columns.map((c) => [c.toLowerCase(), c]));
    for (const preferred of preferredColumns) {
      const real = lowerMap.get(String(preferred).toLowerCase());
      if (real) return real;
    }
    const genericCandidates = ['date', 'created_at', 'updated_at', 'date_creation', 'date_created', 'timestamp'];
    for (const candidate of genericCandidates) {
      const real = lowerMap.get(candidate);
      if (real) return real;
    }
    const dateLike = columns.find((c) => {
      const name = c.toLowerCase();
      return name.includes('date') || name.includes('created') || name.includes('timestamp');
    });
    return dateLike || null;
  } catch (_) { return null; }
}

function getCommandeDateColumn(db) { return findDateColumn(db, 'commandes', ['date_commande', 'date', 'created_at']); }
function getDepenseDateColumn(db) { return findDateColumn(db, 'depenses', ['date_depense', 'date', 'created_at']); }
function getEntreeDateColumn(db) { return findDateColumn(db, 'entrees_stock', ['date_entree', 'date', 'created_at']); }
function getSortieDateColumn(db) { return findDateColumn(db, 'sorties_stock', ['date_sortie', 'date', 'created_at']); }
function getClientDateColumn(db) { return findDateColumn(db, 'clients', ['created_at', 'date_creation', 'date']); }
function getProduitUpdateDateColumn(db) { return findDateColumn(db, 'produits', ['updated_at', 'created_at', 'date']); }
function getAchatDateColumn(db) { return findDateColumn(db, 'achats', ['date_achat', 'date', 'created_at']); }

function normalizeDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const result = String(value).trim();
  return result || null;
}

function buildDateFilter(column, startDate, endDate, params) {
  let sql = '';
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate);
  if (start) {
    sql += ` AND substr(COALESCE(${column}, ''), 1, 10) >= substr(?, 1, 10)`;
    params.push(start);
  }
  if (end) {
    sql += ` AND substr(COALESCE(${column}, ''), 1, 10) <= substr(?, 1, 10)`;
    params.push(end);
  }
  return sql;
}

function getGroupFormat(groupBy) {
  switch (String(groupBy || '').toLowerCase()) {
    case 'heure': return '%H';
    case 'jour': return '%Y-%m-%d';
    case 'semaine': return '%Y-%W';
    case 'mois': return '%Y-%m';
    case 'annee': return '%Y';
    default: return '%Y-%m-%d';
  }
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildCommandeNumeroExpr(alias = 'c') {
  return `'CMD-' || printf('%06d', ${alias}.id)`;
}

function getCaExpr(db, alias = 'c') {
  return `COALESCE(${alias}.total_ttc, 0)`;
}

function computePreviousPeriod(startDate, endDate) {
  if (!startDate || !endDate) return { prevStart: null, prevEnd: null };
  const startStr = String(startDate).slice(0, 10);
  const endStr = String(endDate).slice(0, 10);
  const start = new Date(`${startStr}T00:00:00`);
  const end = new Date(`${endStr}T23:59:59`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { prevStart: null, prevEnd: null };
  }
  const durationMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  const fmt = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  return {
    prevStart: `${fmt(prevStart)} 00:00:00`,
    prevEnd: `${fmt(prevEnd)} 23:59:59`,
  };
}

function computeVariation(current, previous) {
  const c = toNumber(current);
  const p = toNumber(previous);
  if (p === 0) {
    if (c === 0) return 0;
    return 100;
  }
  const variation = ((c - p) / Math.abs(p)) * 100;
  if (variation > 999) return 999;
  if (variation < -999) return -999;
  return Number(variation.toFixed(1));
}

function computeCOGS(db, startDate, endDate) {
  try {
    if (!tableExists(db, 'details_commandes') ||
        !tableExists(db, 'commandes') ||
        !tableExists(db, 'produits')) {
      return 0;
    }
    const dateCol = getCommandeDateColumn(db);
    const params = [];
    let filter = '';
    if (dateCol) filter = buildDateFilter(`c."${dateCol}"`, startDate, endDate, params);

    const row = db.prepare(`
      SELECT COALESCE(SUM(dc.quantite * COALESCE(p.prix_achat, 0)), 0) AS cogs
      FROM details_commandes dc
      INNER JOIN commandes c ON c.id = dc.commande_id
      INNER JOIN produits p ON p.id = dc.produit_id
      WHERE 1 = 1 ${filter}
    `).get(...params);

    return toNumber(row?.cogs);
  } catch (err) {
    debugLog('computeCOGS error:', err?.message);
    return 0;
  }
}

// ⭐⭐⭐ Stats agrégées pour une période ⭐⭐⭐
function fetchPeriodStats(db, startDate, endDate) {
  const result = {
    chiffreAffaires: 0,
    depenses: 0,
    achats: 0,
    cogs: 0,
    beneficeNet: 0,
    commandesTotal: 0,
    clientsActifs: 0,
  };

  const uniqueClients = new Set();

  // 1️⃣ COMMANDES (source unique du CA)
  let caCommandes = 0;
  if (tableExists(db, 'commandes')) {
    const dateCol = getCommandeDateColumn(db);
    const params = [];
    let filter = '';
    if (dateCol) filter = buildDateFilter(`c."${dateCol}"`, startDate, endDate, params);

    const caExpr = getCaExpr(db, 'c');

    const row = db.prepare(`
      SELECT
        COUNT(*) AS commandesTotal,
        COALESCE(SUM(${caExpr}), 0) AS chiffreAffaires
      FROM commandes c
      WHERE 1 = 1 ${filter}
    `).get(...params);
    caCommandes = toNumber(row?.chiffreAffaires);
    result.commandesTotal = toNumber(row?.commandesTotal);

    const clientsRows = db.prepare(`
      SELECT DISTINCT c.client_id
      FROM commandes c
      WHERE c.client_id IS NOT NULL ${filter}
    `).all(...params);
    clientsRows.forEach(r => { if (r.client_id) uniqueClients.add(r.client_id); });
  }

  result.chiffreAffaires = caCommandes;
  result.clientsActifs = uniqueClients.size;

  // 2️⃣ DÉPENSES
  if (tableExists(db, 'depenses')) {
    const dateCol = getDepenseDateColumn(db);
    const params = [];
    let filter = '';
    if (dateCol) filter = buildDateFilter(`d."${dateCol}"`, startDate, endDate, params);
    const row = db.prepare(`
      SELECT COALESCE(SUM(COALESCE(d.montant, 0)), 0) AS depenses
      FROM depenses d WHERE 1 = 1 ${filter}
    `).get(...params);
    result.depenses = toNumber(row?.depenses);
  }

  // 3️⃣ ACHATS
  if (tableExists(db, 'achats')) {
    const dateCol = getAchatDateColumn(db);
    const params = [];
    let filter = '';
    if (dateCol) filter = buildDateFilter(`a."${dateCol}"`, startDate, endDate, params);
    const row = db.prepare(`
      SELECT COALESCE(SUM(COALESCE(a.total_ttc, 0)), 0) AS achats
      FROM achats a WHERE 1 = 1 ${filter}
    `).get(...params);
    result.achats = toNumber(row?.achats);
  }

  // 4️⃣ COGS (info ihany)
  result.cogs = computeCOGS(db, startDate, endDate);

  // ⭐⭐⭐ Bénéfice Net = CA − Dépenses − ACHATS ⭐⭐⭐
  result.beneficeNet = result.chiffreAffaires - result.depenses - result.achats;

  if (DEBUG_BENEFICE) {
    console.log('🔍 [fetchPeriodStats]', {
      période: { startDate, endDate },
      chiffreAffaires: result.chiffreAffaires,
      depenses: result.depenses,
      achats: result.achats,
      beneficeNet: result.beneficeNet,
      formula: `${result.chiffreAffaires} - ${result.depenses} - ${result.achats} = ${result.beneficeNet}`,
    });
  }

  return result;
}

// ⭐⭐⭐ KPI STOCK ⭐⭐⭐
function fetchStockMetrics(db) {
  const current = computeCurrentSnapshot(db);
  return {
    stockValue: current.stockValue,
    ruptureStock: current.ruptureStock,
    alertesStock: current.alertesStock,
    stockNormal: current.stockNormal,
    stockTotal: current.stockTotal,
    totalProduits: current.totalProduits,
  };
}

function computeStockVariations(db, startDate, endDate) {
  const zero = {
    variationStockValue: 0,
    variationRupture: 0,
    variationAlertes: 0,
    variationStockNormal: 0,
  };
  if (!startDate || !endDate) return zero;
  if (!tableExists(db, 'stock_snapshots')) return zero;

  try {
    const currentSnapshot = computeCurrentSnapshot(db);
    const startSnapshot = getSnapshotAtDate(db, String(startDate).slice(0, 10));

    if (!startSnapshot) return zero;

    const variationStockValue = computeVariation(currentSnapshot.stockValue, toNumber(startSnapshot.stock_value));
    const variationRupture = computeVariation(currentSnapshot.ruptureStock, toNumber(startSnapshot.rupture_stock));
    const variationAlertes = computeVariation(currentSnapshot.alertesStock, toNumber(startSnapshot.alertes_stock));
    const variationStockNormal = computeVariation(currentSnapshot.stockNormal, toNumber(startSnapshot.stock_normal));

    return { variationStockValue, variationRupture, variationAlertes, variationStockNormal };
  } catch (err) {
    debugLog('computeStockVariations error:', err?.message);
    return zero;
  }
}

// ⭐⭐⭐ Sparkline VENTES ⭐⭐⭐
function fetchSparklineSeries(db, { startDate, endDate, metric = 'ca', points = 12 }) {
  if (!startDate || !endDate) return [];
  const startStr = String(startDate).slice(0, 10);
  const endStr = String(endDate).slice(0, 10);
  const start = new Date(`${startStr}T00:00:00`);
  const end = new Date(`${endStr}T23:59:59`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  const durationMs = end.getTime() - start.getTime();
  const totalDays = Math.max(1, Math.round(durationMs / 86400000) + 1);
  const bucketDays = Math.max(1, Math.ceil(totalDays / points));
  const buckets = [];

  for (let i = 0; i < points; i++) {
    const bucketStart = new Date(start.getTime() + i * bucketDays * 86400000);
    if (bucketStart > end) break;
    const bucketEnd = new Date(Math.min(
      bucketStart.getTime() + (bucketDays - 1) * 86400000 + 86399999,
      end.getTime()
    ));
    const fmt = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    buckets.push({
      start: `${fmt(bucketStart)} 00:00:00`,
      end: `${fmt(bucketEnd)} 23:59:59`,
    });
  }

  const caExpr = getCaExpr(db, 'c');
  const values = [];

  for (const b of buckets) {
    let value = 0;
    try {
      if (metric === 'ca') {
        if (tableExists(db, 'commandes')) {
          const dateCol = getCommandeDateColumn(db);
          if (dateCol) {
            const params = [];
            const filter = buildDateFilter(`c."${dateCol}"`, b.start, b.end, params);
            const row = db.prepare(`
              SELECT COALESCE(SUM(${caExpr}), 0) AS v
              FROM commandes c WHERE 1 = 1 ${filter}
            `).get(...params);
            value = toNumber(row?.v);
          }
        }
      } else if (metric === 'commandes' && tableExists(db, 'commandes')) {
        const dateCol = getCommandeDateColumn(db);
        if (dateCol) {
          const params = [];
          const filter = buildDateFilter(`c."${dateCol}"`, b.start, b.end, params);
          const row = db.prepare(`
            SELECT COUNT(*) AS v FROM commandes c WHERE 1 = 1 ${filter}
          `).get(...params);
          value = toNumber(row?.v);
        }
      } else if (metric === 'benefice') {
        const caCommandes = (() => {
          if (!tableExists(db, 'commandes')) return 0;
          const dateCol = getCommandeDateColumn(db);
          if (!dateCol) return 0;
          const params = [];
          const filter = buildDateFilter(`c."${dateCol}"`, b.start, b.end, params);
          const row = db.prepare(`SELECT COALESCE(SUM(${caExpr}), 0) AS v FROM commandes c WHERE 1 = 1 ${filter}`).get(...params);
          return toNumber(row?.v);
        })();
        const dep = (() => {
          if (!tableExists(db, 'depenses')) return 0;
          const dateCol = getDepenseDateColumn(db);
          if (!dateCol) return 0;
          const params = [];
          const filter = buildDateFilter(`d."${dateCol}"`, b.start, b.end, params);
          const row = db.prepare(`SELECT COALESCE(SUM(COALESCE(d.montant,0)),0) AS v FROM depenses d WHERE 1=1 ${filter}`).get(...params);
          return toNumber(row?.v);
        })();
        const ach = (() => {
          if (!tableExists(db, 'achats')) return 0;
          const dateCol = getAchatDateColumn(db);
          if (!dateCol) return 0;
          const params = [];
          const filter = buildDateFilter(`a."${dateCol}"`, b.start, b.end, params);
          const row = db.prepare(`SELECT COALESCE(SUM(COALESCE(a.total_ttc,0)),0) AS v FROM achats a WHERE 1=1 ${filter}`).get(...params);
          return toNumber(row?.v);
        })();
        value = caCommandes - dep - ach;
      } else if (metric === 'clients') {
        const clientSet = new Set();
        if (tableExists(db, 'commandes')) {
          const dateCol = getCommandeDateColumn(db);
          if (dateCol) {
            const params = [];
            const filter = buildDateFilter(`c."${dateCol}"`, b.start, b.end, params);
            const rows = db.prepare(`SELECT DISTINCT c.client_id FROM commandes c WHERE c.client_id IS NOT NULL ${filter}`).all(...params);
            rows.forEach(r => { if (r.client_id) clientSet.add(r.client_id); });
          }
        }
        value = clientSet.size;
      } else if (metric === 'achats' && tableExists(db, 'achats')) {
        const dateCol = getAchatDateColumn(db);
        if (dateCol) {
          const params = [];
          const filter = buildDateFilter(`a."${dateCol}"`, b.start, b.end, params);
          const row = db.prepare(`SELECT COALESCE(SUM(COALESCE(a.total_ttc,0)),0) AS v FROM achats a WHERE 1=1 ${filter}`).get(...params);
          value = toNumber(row?.v);
        }
      } else if (metric === 'depenses' && tableExists(db, 'depenses')) {
        const dateCol = getDepenseDateColumn(db);
        if (dateCol) {
          const params = [];
          const filter = buildDateFilter(`d."${dateCol}"`, b.start, b.end, params);
          const row = db.prepare(`SELECT COALESCE(SUM(COALESCE(d.montant,0)),0) AS v FROM depenses d WHERE 1=1 ${filter}`).get(...params);
          value = toNumber(row?.v);
        }
      }
    } catch (e) {
      debugLog('sparkline bucket error:', e?.message);
    }
    values.push(value);
  }
  return values;
}

// ⭐⭐⭐ Sparkline STOCK via snapshots ⭐⭐⭐
function fetchStockSparkline(db, { startDate, endDate, metric = 'stockValue', points = 12 }) {
  if (!startDate || !endDate) return [];
  if (!tableExists(db, 'stock_snapshots')) {
    const snapshot = computeCurrentSnapshot(db);
    const rotation = computeRotationRate(db, 30);
    const value = metric === 'stockValue' ? snapshot.stockValue
                : metric === 'rupture'    ? snapshot.ruptureStock
                : metric === 'alertes'    ? snapshot.alertesStock
                : metric === 'stockNormal' ? snapshot.stockNormal
                : metric === 'rotation'   ? rotation
                : 0;
    return Array(points).fill(value);
  }

  const series = getSnapshotSeries(db, { startDate, endDate, points });
  if (!series || series.length === 0 || series.every((s) => !s)) {
    const snapshot = computeCurrentSnapshot(db);
    const rotation = computeRotationRate(db, 30);
    const value = metric === 'stockValue' ? snapshot.stockValue
                : metric === 'rupture'    ? snapshot.ruptureStock
                : metric === 'alertes'    ? snapshot.alertesStock
                : metric === 'stockNormal' ? snapshot.stockNormal
                : metric === 'rotation'   ? rotation
                : 0;
    return Array(points).fill(value);
  }

  return series.map((s) => {
    if (!s) return 0;
    switch (metric) {
      case 'stockValue': return toNumber(s.stock_value);
      case 'rupture':    return toNumber(s.rupture_stock);
      case 'alertes':    return toNumber(s.alertes_stock);
      case 'stockNormal': return toNumber(s.stock_normal);
      case 'rotation':   return toNumber(s.rotation_rate);
      default:           return 0;
    }
  });
}

// ═══════════════════════════════════════════════════════════
// REGISTER HANDLERS
// ═══════════════════════════════════════════════════════════
function registerDashboardHandlers(ipcMain) {
  if (!ipcMain) { error('❌ [dashboard] ipcMain est null/undefined'); return false; }

  const channels = ['dashboard:get-stats', 'dashboard:get-financial-summary', 'dashboard:get-chart-data'];
  for (const channel of channels) { try { ipcMain.removeHandler(channel); } catch (_) {} }

  // ============================================================
  // GET STATS
  // ============================================================
  ipcMain.handle('dashboard:get-stats', withDb((db, _event, options = {}) => {
    const startDate = normalizeDate(options.startDate);
    const endDate = normalizeDate(options.endDate);
    debugLog('📊 [get-stats]', { startDate, endDate });

    const current = fetchPeriodStats(db, startDate, endDate);
    const { prevStart, prevEnd } = computePreviousPeriod(startDate, endDate);
    const previous = (prevStart && prevEnd)
      ? fetchPeriodStats(db, prevStart, prevEnd)
      : {
          chiffreAffaires: 0, depenses: 0, achats: 0, cogs: 0,
          beneficeNet: 0, commandesTotal: 0, clientsActifs: 0,
        };

    const stockMetrics = fetchStockMetrics(db);
    const rotationRate = computeRotationRate(db, 30);
    const stockVariations = computeStockVariations(db, startDate, endDate);

    // ⭐ FIX: commandesEnAttente — mandray 'Non payé' + 'Partiel'
    let commandesEnAttente = 0;
    if (tableExists(db, 'commandes')) {
      const dateCol = getCommandeDateColumn(db);
      const params = [];
      let filter = '';
      if (dateCol) filter = buildDateFilter(`c."${dateCol}"`, startDate, endDate, params);
      const row = db.prepare(`
        SELECT COALESCE(SUM(
          CASE WHEN c.statut_paiement IN ('Non payé', 'Partiel') THEN 1 ELSE 0 END
        ), 0) AS n
        FROM commandes c WHERE 1 = 1 ${filter}
      `).get(...params);
      commandesEnAttente = toNumber(row?.n);
    }

    let totalClients = 0;
    if (tableExists(db, 'clients')) {
      const row = db.prepare(`SELECT COUNT(*) AS totalClients FROM clients`).get();
      totalClients = toNumber(row?.totalClients);
    }

    // ⭐⭐⭐ FIX: Dette client — mifanaraka amin'ny Commandes ⭐⭐⭐
    // Formula: SUM(total_ttc − montant_paye) ho an'ny 'Non payé' + 'Partiel'
    let dette = { totalDette: 0, nbCommandesNonPayees: 0 };
    if (tableExists(db, 'commandes')) {
      const dateCol = getCommandeDateColumn(db);
      const params = [];
      let filter = '';
      if (dateCol) filter = buildDateFilter(`c."${dateCol}"`, startDate, endDate, params);
      const stmt = db.prepare(`
        SELECT
          COALESCE(SUM(
            CASE
              WHEN c.statut_paiement IN ('Non payé', 'Partiel')
              THEN COALESCE(c.total_ttc, 0) - COALESCE(c.montant_paye, 0)
              ELSE 0
            END
          ), 0) AS totalDette,
          COALESCE(SUM(
            CASE WHEN c.statut_paiement IN ('Non payé', 'Partiel') THEN 1 ELSE 0 END
          ), 0) AS nbCommandesNonPayees
        FROM commandes c WHERE 1 = 1 ${filter}
      `);
      dette = stmt.get(...params) || dette;
    }

    const variationChiffreAffaires = computeVariation(current.chiffreAffaires, previous.chiffreAffaires);
    const variationBenefice = computeVariation(current.beneficeNet, previous.beneficeNet);
    const variationCommandesTotal = computeVariation(current.commandesTotal, previous.commandesTotal);
    const variationClients = computeVariation(current.clientsActifs, previous.clientsActifs);
    const variationDepenses = computeVariation(current.depenses, previous.depenses);
    const variationAchats = computeVariation(current.achats, previous.achats);

    return {
      success: true,
      data: {
        chiffreAffaires: toNumber(current.chiffreAffaires),
        chiffreAffairesPaye: toNumber(current.chiffreAffaires),
        depenses: toNumber(current.depenses),
        achats: toNumber(current.achats),
        cogs: toNumber(current.cogs),

        beneficeNet: toNumber(current.beneficeNet),
        commandesTotal: toNumber(current.commandesTotal),
        commandesEnAttente: toNumber(commandesEnAttente),
        clientsActifs: toNumber(current.clientsActifs),
        totalClients,

        stockValue: toNumber(stockMetrics.stockValue),
        ruptureStock: toNumber(stockMetrics.ruptureStock),
        alertesStock: toNumber(stockMetrics.alertesStock),
        stockNormal: toNumber(stockMetrics.stockNormal),
        stockTotal: toNumber(stockMetrics.stockTotal),
        totalProduits: toNumber(stockMetrics.totalProduits),
        rotationRate: toNumber(rotationRate),

        totalDette: toNumber(dette.totalDette),
        nbCommandesNonPayees: toNumber(dette.nbCommandesNonPayees),

        variationChiffreAffaires,
        variationBenefice,
        variationCommandesTotal,
        variationCommandes: variationCommandesTotal,
        variationClients,
        variationDepenses,
        variationAchats,

        variationStockValue: stockVariations.variationStockValue,
        variationRupture: stockVariations.variationRupture,
        variationAlertes: stockVariations.variationAlertes,
        variationStockNormal: stockVariations.variationStockNormal,
        variationRotation: 0,

        startDate,
        endDate,
      },
    };
  }));

  // ============================================================
  // FINANCIAL SUMMARY
  // ============================================================
  ipcMain.handle('dashboard:get-financial-summary', withDb((db, _event, options = {}) => {
    const startDate = normalizeDate(options.startDate);
    const endDate = normalizeDate(options.endDate);
    const stats = fetchPeriodStats(db, startDate, endDate);
    return {
      success: true,
      data: {
        chiffreAffaires: stats.chiffreAffaires,
        depenses: stats.depenses,
        achats: stats.achats,
        cogs: stats.cogs,
        beneficeNet: stats.beneficeNet,
        startDate,
        endDate,
      },
    };
  }));

  // ============================================================
  // CHART DATA
  // ============================================================
  ipcMain.handle('dashboard:get-chart-data', withDb((db, _event, options = {}) => {
    const { type, year = new Date().getFullYear(), limit = 5, startDate, endDate, groupBy = 'mois' } = options;
    const normalizedStart = normalizeDate(startDate);
    const normalizedEnd = normalizeDate(endDate);

    if (type === 'ventes-par-mois') {
      if (!tableExists(db, 'commandes')) return { success: true, data: [] };
      const dateColumn = getCommandeDateColumn(db);
      if (!dateColumn) return { success: true, data: [] };
      const format = getGroupFormat(groupBy);
      const params = [];
      let filter = buildDateFilter(`c."${dateColumn}"`, normalizedStart, normalizedEnd, params);
      let yearFilter = '';
      if (!normalizedStart && !normalizedEnd) {
        yearFilter = ` AND strftime('%Y', c."${dateColumn}", 'localtime') = ?`;
        params.push(String(year));
      }
      const ventesExpr = getCaExpr(db, 'c');
      const stmt = db.prepare(`
        SELECT strftime('${format}', c."${dateColumn}", 'localtime') AS label,
               strftime('${format}', c."${dateColumn}", 'localtime') AS mois,
               COUNT(*) AS nb_commandes,
               COALESCE(SUM(${ventesExpr}), 0) AS total_ventes
        FROM commandes c
        WHERE 1 = 1 ${yearFilter} ${filter}
        GROUP BY strftime('${format}', c."${dateColumn}", 'localtime')
        ORDER BY label ASC
      `);
      return { success: true, data: stmt.all(...params) };
    }

    if (type === 'top-produits') {
      if (!tableExists(db, 'details_commandes') || !tableExists(db, 'commandes') || !tableExists(db, 'produits')) return { success: true, data: [] };
      const dateColumn = getCommandeDateColumn(db);
      const params = [];
      let filter = '';
      if (dateColumn) filter = buildDateFilter(`c."${dateColumn}"`, normalizedStart, normalizedEnd, params);
      const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 100));
      const stmt = db.prepare(`
        SELECT p.id, p.nom,
               COALESCE(SUM(d.quantite), 0) AS total_vendu,
               COALESCE(SUM(d.total), 0) AS total_ventes
        FROM details_commandes d
        INNER JOIN commandes c ON c.id = d.commande_id
        INNER JOIN produits p ON p.id = d.produit_id
        WHERE 1 = 1 ${filter}
        GROUP BY p.id, p.nom
        ORDER BY total_vendu DESC LIMIT ?
      `);
      return { success: true, data: stmt.all(...params, safeLimit) };
    }

    if (type === 'repartition-categories') {
      if (!tableExists(db, 'details_commandes') || !tableExists(db, 'commandes') || !tableExists(db, 'produits')) {
        return { success: true, data: [] };
      }
      const dateColumn = getCommandeDateColumn(db);
      if (!dateColumn && (normalizedStart || normalizedEnd)) {
        return { success: true, data: [] };
      }
      const params = [];
      let filter = '';
      if (dateColumn) filter = buildDateFilter(`cmd."${dateColumn}"`, normalizedStart, normalizedEnd, params);

      const hasCategories = tableExists(db, 'categories');
      let categoryJoin = '';
      let categorySelect = `0 AS id, 'Sans catégorie' AS nom`;
      let categoryGroup = `0, 'Sans catégorie'`;
      if (hasCategories) {
        categoryJoin = `LEFT JOIN categories cat ON cat.id = p.categorie_id`;
        categorySelect = `COALESCE(cat.id, 0) AS id, COALESCE(cat.nom, 'Sans catégorie') AS nom`;
        categoryGroup = `cat.id, cat.nom`;
      }
      const stmt = db.prepare(`
        SELECT ${categorySelect},
               COALESCE(SUM(dc.quantite), 0) AS total_quantite,
               COALESCE(SUM(dc.total), 0) AS total_ventes,
               COUNT(DISTINCT cmd.id) AS nb_commandes
        FROM details_commandes dc
        INNER JOIN commandes cmd ON cmd.id = dc.commande_id
        INNER JOIN produits p ON p.id = dc.produit_id
        ${categoryJoin}
        WHERE 1 = 1 ${filter}
        GROUP BY ${categoryGroup}
        ORDER BY total_ventes DESC
      `);
      return { success: true, data: stmt.all(...params) };
    }

    if (type === 'stock-status') {
      if (!tableExists(db, 'produits')) return { success: true, data: { en_stock: 0, stock_bas: 0, rupture: 0 } };
      const stmt = db.prepare(`
        SELECT COUNT(CASE WHEN COALESCE(quantite_stock, 0) > COALESCE(quantite_minimale, 0) THEN 1 END) AS en_stock,
               COUNT(CASE WHEN COALESCE(quantite_stock, 0) > 0 AND COALESCE(quantite_stock, 0) <= COALESCE(quantite_minimale, 0) THEN 1 END) AS stock_bas,
               COUNT(CASE WHEN COALESCE(quantite_stock, 0) <= 0 THEN 1 END) AS rupture
        FROM produits WHERE status = 'actif'
      `);
      return { success: true, data: stmt.get() || { en_stock: 0, stock_bas: 0, rupture: 0 } };
    }

    if (type === 'entrees-stock') {
      if (!tableExists(db, 'entrees_stock')) return { success: true, data: [] };
      const dateColumn = getEntreeDateColumn(db);
      if (!dateColumn) return { success: true, data: [] };
      const format = getGroupFormat(groupBy);
      const params = [];
      const filter = buildDateFilter(`e."${dateColumn}"`, normalizedStart, normalizedEnd, params);
      const stmt = db.prepare(`
        SELECT strftime('${format}', e."${dateColumn}", 'localtime') AS label,
               COALESCE(SUM(e.quantite), 0) AS total_quantite
        FROM entrees_stock e WHERE 1 = 1 ${filter}
        GROUP BY strftime('${format}', e."${dateColumn}", 'localtime')
        ORDER BY label ASC
      `);
      return { success: true, data: stmt.all(...params) };
    }

    if (type === 'sorties-stock') {
      if (!tableExists(db, 'sorties_stock')) return { success: true, data: [] };
      const dateColumn = getSortieDateColumn(db);
      if (!dateColumn) return { success: true, data: [] };
      const format = getGroupFormat(groupBy);
      const params = [];
      const filter = buildDateFilter(`s."${dateColumn}"`, normalizedStart, normalizedEnd, params);
      const stmt = db.prepare(`
        SELECT strftime('${format}', s."${dateColumn}", 'localtime') AS label,
               COALESCE(SUM(s.quantite), 0) AS total_quantite
        FROM sorties_stock s WHERE 1 = 1 ${filter}
        GROUP BY strftime('${format}', s."${dateColumn}", 'localtime')
        ORDER BY label ASC
      `);
      return { success: true, data: stmt.all(...params) };
    }

    if (type === 'top-clients') {
      if (!tableExists(db, 'clients') || !tableExists(db, 'commandes')) return { success: true, data: [] };
      const dateColumn = getCommandeDateColumn(db);
      const params = [];
      let filter = '';
      if (dateColumn) filter = buildDateFilter(`cmd."${dateColumn}"`, normalizedStart, normalizedEnd, params);
      const stmt = db.prepare(`
        SELECT cl.id AS client_id, cl.nom AS client_nom,
               COUNT(DISTINCT cmd.id) AS nb_commandes,
               COALESCE(SUM(cmd.total_ttc), 0) AS total_achats
        FROM clients cl
        INNER JOIN commandes cmd ON cl.id = cmd.client_id
        WHERE 1 = 1 ${filter}
        GROUP BY cl.id, cl.nom
        ORDER BY total_achats DESC LIMIT 5
      `);
      return { success: true, data: stmt.all(...params) };
    }

    if (type === 'depenses-categorie') {
      if (!tableExists(db, 'depenses')) return { success: true, data: [] };
      const dateColumn = getDepenseDateColumn(db);
      const params = [];
      let filter = '';
      if (dateColumn) filter = buildDateFilter(`d."${dateColumn}"`, normalizedStart, normalizedEnd, params);
      if (!columnExists(db, 'depenses', 'categorie')) return { success: true, data: [] };
      const stmt = db.prepare(`
        SELECT d.categorie,
               COALESCE(SUM(d.montant), 0) AS total
        FROM depenses d
        WHERE d.categorie IS NOT NULL AND TRIM(d.categorie) != '' ${filter}
        GROUP BY d.categorie
        ORDER BY total DESC
      `);
      return { success: true, data: stmt.all(...params) };
    }

    if (type === 'commandes-statut') {
      if (!tableExists(db, 'commandes')) return { success: true, data: [] };
      const dateColumn = getCommandeDateColumn(db);
      const params = [];
      let filter = '';
      if (dateColumn) filter = buildDateFilter(`c."${dateColumn}"`, normalizedStart, normalizedEnd, params);
      const stmt = db.prepare(`
        SELECT c.statut_paiement, COUNT(*) AS nb
        FROM commandes c WHERE 1 = 1 ${filter}
        GROUP BY c.statut_paiement
        ORDER BY nb DESC
      `);
      return { success: true, data: stmt.all(...params) };
    }

    if (type === 'premiere-date') {
      if (!tableExists(db, 'clients')) return { success: true, data: null };
      const dateColumn = getClientDateColumn(db);
      if (!dateColumn) return { success: true, data: null };
      const row = db.prepare(`SELECT MIN("${dateColumn}") AS first_date FROM clients`).get();
      return { success: true, data: row?.first_date ?? null };
    }

    if (type === 'sparkline-stats') {
      const points = Math.max(6, Math.min(Number(limit) || 12, 24));
      return {
        success: true,
        data: {
          ca: fetchSparklineSeries(db, { startDate: normalizedStart, endDate: normalizedEnd, metric: 'ca', points }),
          benefice: fetchSparklineSeries(db, { startDate: normalizedStart, endDate: normalizedEnd, metric: 'benefice', points }),
          commandes: fetchSparklineSeries(db, { startDate: normalizedStart, endDate: normalizedEnd, metric: 'commandes', points }),
          clients: fetchSparklineSeries(db, { startDate: normalizedStart, endDate: normalizedEnd, metric: 'clients', points }),
          achats: fetchSparklineSeries(db, { startDate: normalizedStart, endDate: normalizedEnd, metric: 'achats', points }),
          depenses: fetchSparklineSeries(db, { startDate: normalizedStart, endDate: normalizedEnd, metric: 'depenses', points }),
          stockValue: fetchStockSparkline(db, { startDate: normalizedStart, endDate: normalizedEnd, metric: 'stockValue', points }),
          rupture: fetchStockSparkline(db, { startDate: normalizedStart, endDate: normalizedEnd, metric: 'rupture', points }),
          alertes: fetchStockSparkline(db, { startDate: normalizedStart, endDate: normalizedEnd, metric: 'alertes', points }),
          stockNormal: fetchStockSparkline(db, { startDate: normalizedStart, endDate: normalizedEnd, metric: 'stockNormal', points }),
          rotation: fetchStockSparkline(db, { startDate: normalizedStart, endDate: normalizedEnd, metric: 'rotation', points }),
        },
      };
    }

    if (type === 'rupture-stock-details') {
      if (!tableExists(db, 'produits')) return { success: true, data: [] };
      const updateDateColumn = getProduitUpdateDateColumn(db);
      const dateSelect = updateDateColumn
        ? `COALESCE("${updateDateColumn}", '') AS date_ref`
        : `'' AS date_ref`;
      const stmt = db.prepare(`
        SELECT id, COALESCE(code, '') AS code, COALESCE(nom, 'Produit') AS nom,
               COALESCE(quantite_stock, 0) AS quantite_stock,
               COALESCE(quantite_minimale, 0) AS quantite_minimale,
               ${dateSelect}
        FROM produits
        WHERE status = 'actif' AND COALESCE(quantite_stock, 0) <= 0
        ORDER BY nom ASC LIMIT 20
      `);
      return { success: true, data: stmt.all() };
    }

    // ⭐⭐⭐ FIX: dette-clients-details — mandray 'Non payé' + 'Partiel' ⭐⭐⭐
    if (type === 'dette-clients-details') {
      if (!tableExists(db, 'commandes')) return { success: true, data: [] };
      const dateColumn = getCommandeDateColumn(db);
      const params = [];
      let filter = '';
      if (dateColumn) filter = buildDateFilter(`c."${dateColumn}"`, normalizedStart, normalizedEnd, params);
      const dateSelect = dateColumn ? `COALESCE(c."${dateColumn}", '') AS date_ref` : `'' AS date_ref`;
      const dateOrder = dateColumn ? `c."${dateColumn}"` : 'c.id';
      const numeroExpr = buildCommandeNumeroExpr('c');
      const stmt = db.prepare(`
        SELECT c.id AS commande_id, ${numeroExpr} AS numero,
               COALESCE(c.client_nom, 'Client inconnu') AS client_nom,
               COALESCE(c.total_ttc, 0) AS total_ttc,
               COALESCE(c.montant_paye, 0) AS montant_paye,
               (COALESCE(c.total_ttc, 0) - COALESCE(c.montant_paye, 0)) AS dette,
               COALESCE(c.statut_paiement, 'Non payé') AS statut_paiement,
               COALESCE(c.modalite_paiement, 'Immediat') AS modalite_paiement,
               COALESCE(c.date_limite_paiement, '') AS date_limite_paiement,
               ${dateSelect}
        FROM commandes c
        WHERE c.statut_paiement IN ('Non payé', 'Partiel') ${filter}
        ORDER BY dette DESC, ${dateOrder} DESC LIMIT 20
      `);
      return { success: true, data: stmt.all(...params) };
    }

    // ⭐⭐⭐ FIX: commandes-en-attente-details — mandray 'Non payé' + 'Partiel' ⭐⭐⭐
    if (type === 'commandes-en-attente-details') {
      if (!tableExists(db, 'commandes')) return { success: true, data: [] };
      const dateColumn = getCommandeDateColumn(db);
      const params = [];
      let filter = '';
      if (dateColumn) filter = buildDateFilter(`c."${dateColumn}"`, normalizedStart, normalizedEnd, params);
      const dateSelect = dateColumn ? `COALESCE(c."${dateColumn}", '') AS date_ref` : `'' AS date_ref`;
      const dateOrder = dateColumn ? `c."${dateColumn}"` : 'c.id';
      const numeroExpr = buildCommandeNumeroExpr('c');
      const stmt = db.prepare(`
        SELECT c.id, ${numeroExpr} AS numero,
               COALESCE(c.client_nom, 'Client inconnu') AS client_nom,
               COALESCE(c.total_ttc, 0) AS total_ttc,
               COALESCE(c.montant_paye, 0) AS montant_paye,
               COALESCE(c.statut_paiement, 'Non payé') AS statut_paiement,
               COALESCE(c.modalite_paiement, 'Immediat') AS modalite_paiement,
               COALESCE(c.date_limite_paiement, '') AS date_limite_paiement,
               ${dateSelect}
        FROM commandes c
        WHERE c.statut_paiement IN ('Non payé', 'Partiel') ${filter}
        ORDER BY ${dateOrder} DESC LIMIT 20
      `);
      return { success: true, data: stmt.all(...params) };
    }

    return { success: false, error: `Type de chart inconnu: ${type}` };
  }));

  log('✅ [dashboard.handlers] Enregistrés (withDb + auto-forceReconnect + sans RH + Dette client synchronisée)');
  return true;
}

module.exports = { registerDashboardHandlers };