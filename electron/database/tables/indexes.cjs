// electron/database/tables/indexes.cjs
'use strict';

const { log, createIndex } = require('./helpers.cjs');

function createAllIndexes(db) {
  log('🔧 Création des indexes...');

  // Produits
  createIndex(db, `CREATE INDEX IF NOT EXISTS idx_produits_code ON produits(code)`, 'idx_produits_code');
  createIndex(db, `CREATE INDEX IF NOT EXISTS idx_produits_status ON produits(status)`, 'idx_produits_status');
  createIndex(db, `CREATE INDEX IF NOT EXISTS idx_produits_categorie ON produits(categorie_id)`, 'idx_produits_categorie');
  createIndex(db, `CREATE INDEX IF NOT EXISTS idx_produits_fournisseur ON produits(fournisseur_id)`, 'idx_produits_fournisseur');

  // Utilisateurs
  createIndex(db, `CREATE INDEX IF NOT EXISTS idx_utilisateurs_email ON utilisateurs(email)`, 'idx_utilisateurs_email');
  createIndex(db, `CREATE INDEX IF NOT EXISTS idx_utilisateurs_status ON utilisateurs(status)`, 'idx_utilisateurs_status');

  // Sessions
  createIndex(db, `CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)`, 'idx_sessions_token');
  createIndex(db, `CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId)`, 'idx_sessions_userId');

  // Commandes
  createIndex(db, `CREATE INDEX IF NOT EXISTS idx_commandes_client ON commandes(client_id)`, 'idx_commandes_client');
  createIndex(db, `CREATE INDEX IF NOT EXISTS idx_commandes_date ON commandes(date_commande)`, 'idx_commandes_date');
  createIndex(db, `CREATE INDEX IF NOT EXISTS idx_commandes_statut_paiement ON commandes(statut_paiement)`, 'idx_commandes_statut_paiement');

  // Achats
  createIndex(db, `CREATE INDEX IF NOT EXISTS idx_achats_fournisseur ON achats(fournisseur_id)`, 'idx_achats_fournisseur');
  createIndex(db, `CREATE INDEX IF NOT EXISTS idx_achats_date ON achats(date_achat)`, 'idx_achats_date');
  createIndex(db, `CREATE INDEX IF NOT EXISTS idx_achats_statut_paiement ON achats(statut_paiement)`, 'idx_achats_statut_paiement');

  // Stock snapshots
  createIndex(db, `CREATE INDEX IF NOT EXISTS idx_stock_snapshots_date ON stock_snapshots(date_snapshot DESC)`, 'idx_stock_snapshots_date');

  return true;
}

module.exports = { createAllIndexes };