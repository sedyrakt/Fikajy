// electron/database/tables/migrations/index.cjs
'use strict';

const { migrateClients } = require('./clients.cjs');
const { migrateOrders } = require('./orders.cjs');
const { migrateProducts } = require('./products.cjs');
const { migratePurchases } = require('./purchases.cjs');
const { migrateStock } = require('./stock.cjs');
const { migrateUsers } = require('./users.cjs');

function runAllMigrations(db) {
  // ─── Tables de base ───
  migrateUsers(db);
  migrateClients(db);
  migrateProducts(db);
  migrateOrders(db);
  migratePurchases(db);
  migrateStock(db);
}

module.exports = { runAllMigrations };