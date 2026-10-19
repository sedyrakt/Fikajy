// electron/database/tables/schemas.cjs
// ⭐ NOUVEAU: `type_produit` ho an'ny produits (fini | matiere_premiere | fourniture)

'use strict';

const { log, error } = require('./helpers.cjs');

function createAllSchemas(db) {
  log('🔄 Création/vérification du schéma database...');

  // ─── INVENTAIRE ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS fournisseurs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      contact TEXT,
      telephone TEXT,
      email TEXT,
      adresse TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS produits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      nom TEXT NOT NULL,
      description TEXT,
      categorie_id INTEGER,
      fournisseur_id INTEGER,
      prix_achat REAL DEFAULT 0,
      prix_vente REAL DEFAULT 0,
      quantite_stock INTEGER DEFAULT 0,
      quantite_minimale INTEGER DEFAULT 5,
      unite TEXT DEFAULT 'pièce',
      tva_rate REAL DEFAULT 0.2,
      status TEXT DEFAULT 'actif',
      statut_stock TEXT DEFAULT 'disponible',
      type_produit TEXT DEFAULT 'fini',          
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (categorie_id) REFERENCES categories(id) ON DELETE SET NULL,
      FOREIGN KEY (fournisseur_id) REFERENCES fournisseurs(id) ON DELETE SET NULL
    );
  `);

  // ─── CLIENTS ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      email TEXT UNIQUE,
      telephone TEXT,
      adresse TEXT,
      ville TEXT,
      code_postal TEXT,
      pays TEXT,
      type TEXT DEFAULT 'Particulier',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ─── COMMANDES ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS commandes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      client_nom TEXT NOT NULL,
      total_ht REAL DEFAULT 0,
      total_ttc REAL DEFAULT 0,
      total REAL DEFAULT 0,
      statut_paiement TEXT DEFAULT 'Non payé',
      montant_paye REAL DEFAULT 0,
      montant_restant REAL DEFAULT 0,
      date_limite_paiement TEXT,
      mode_paiement TEXT DEFAULT 'Espèces',
      modalite_paiement TEXT DEFAULT 'Immediat',
      frais_livraison REAL DEFAULT 0,
      stock_restaure INTEGER NOT NULL DEFAULT 0,
      date_commande TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS details_commandes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      commande_id INTEGER NOT NULL,
      produit_id INTEGER NOT NULL,
      quantite INTEGER NOT NULL,
      prix_unitaire REAL NOT NULL,
      total REAL NOT NULL,
      tva_rate REAL DEFAULT 0.2,
      FOREIGN KEY (commande_id) REFERENCES commandes(id) ON DELETE CASCADE,
      FOREIGN KEY (produit_id) REFERENCES produits(id) ON DELETE CASCADE
    );
  `);

  // ─── UTILISATEURS ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS utilisateurs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      firstName TEXT,
      lastName TEXT,
      role TEXT DEFAULT 'user',
      companyName TEXT,
      phone TEXT,
      status TEXT DEFAULT 'actif',
      twoFactorEnabled INTEGER DEFAULT 0,
      twoFactorSecret TEXT,
      lastLogin TEXT,
      loginAttempts INTEGER DEFAULT 0,
      lockedUntil TEXT,
      image TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      userId INTEGER NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES utilisateurs(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT,
      entity TEXT,
      entity_id INTEGER,
      entity_name TEXT,
      user_id INTEGER,
      details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS security_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT,
      action TEXT,
      ip TEXT,
      userAgent TEXT,
      status INTEGER,
      details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ─── STOCK ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS entrees_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produit_id INTEGER NOT NULL,
      quantite INTEGER NOT NULL,
      prix_unitaire REAL DEFAULT 0,
      reference TEXT,
      fournisseur_id INTEGER,
      observation TEXT,
      date_entree TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (produit_id) REFERENCES produits(id) ON DELETE CASCADE,
      FOREIGN KEY (fournisseur_id) REFERENCES fournisseurs(id) ON DELETE SET NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sorties_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produit_id INTEGER NOT NULL,
      quantite INTEGER NOT NULL,
      prix_unitaire REAL DEFAULT 0,
      reference TEXT,
      destination TEXT,
      observation TEXT,
      date_sortie TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (produit_id) REFERENCES produits(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mouvements_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produit_id INTEGER NOT NULL,
      type_mouvement TEXT NOT NULL CHECK (type_mouvement IN ('ENTREE', 'SORTIE')),
      quantite INTEGER NOT NULL,
      ancien_stock INTEGER NOT NULL,
      nouveau_stock INTEGER NOT NULL,
      reference TEXT,
      observation TEXT,
      prix_unitaire REAL DEFAULT 0,
      created_by INTEGER,
      date_mouvement TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (produit_id) REFERENCES produits(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES utilisateurs(id) ON DELETE SET NULL
    );
  `);

  // ─── DÉPENSES / ACHATS ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS depenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fournisseur_id INTEGER,
      description TEXT NOT NULL,
      montant REAL NOT NULL DEFAULT 0,
      categorie TEXT,
      date_depense TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (fournisseur_id) REFERENCES fournisseurs(id) ON DELETE SET NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS achats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fournisseur_id INTEGER NOT NULL,
      reference TEXT,
      date_achat TEXT DEFAULT CURRENT_TIMESTAMP,
      total_ht REAL DEFAULT 0,
      total_ttc REAL DEFAULT 0,
      designation TEXT,
      nombre_produits INTEGER DEFAULT 0,
      statut_paiement TEXT DEFAULT 'Non payé',
      montant_paye REAL DEFAULT 0,
      montant_restant REAL DEFAULT 0,
      observation TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (fournisseur_id) REFERENCES fournisseurs(id) ON DELETE SET NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS details_achats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      achat_id INTEGER NOT NULL,
      produit_id INTEGER,
      quantite INTEGER NOT NULL,
      prix_unitaire REAL NOT NULL,
      total REAL NOT NULL,
      tva_rate REAL DEFAULT 0.2,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (achat_id) REFERENCES achats(id) ON DELETE CASCADE,
      FOREIGN KEY (produit_id) REFERENCES produits(id) ON DELETE CASCADE
    );
  `);

  // ─── STOCK SNAPSHOTS ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date_snapshot TEXT NOT NULL,
      stock_value REAL DEFAULT 0,
      stock_total INTEGER DEFAULT 0,
      total_produits INTEGER DEFAULT 0,
      rupture_stock INTEGER DEFAULT 0,
      alertes_stock INTEGER DEFAULT 0,
      stock_normal INTEGER DEFAULT 0,
      rotation_rate REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(date_snapshot)
    );
  `);

  return true;
}

module.exports = { createAllSchemas };