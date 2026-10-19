// src/components/dashboard/types.ts
// ⭐ FIX: ESORINA ny salairesPayes sy RH rehetra
// ⭐ FIX: Nampiana ny types rehetra ilaina (DashboardChartsData, DateRangeType, etc.)

// ============================================================
// DATE RANGE
// ============================================================
export type DateRangeType =
  | 'aujourdhui'
  | 'hier'
  | 'semaine'
  | 'mois'
  | 'mois_dernier'
  | 'annee'
  | 'annee_derniere'
  | 'custom';

// ============================================================
// DASHBOARD STATS
// ============================================================
export interface DashboardStats {
  // ═══ VENTES ═══
  chiffreAffaires?: number;
  chiffreAffairesPaye?: number;
  depenses?: number;
  achats?: number;
  cogs?: number;
  beneficeNet?: number;

  // ═══ COMMANDES / CLIENTS ═══
  commandesTotal?: number;
  commandesEnAttente?: number;
  clientsActifs?: number;
  totalClients?: number;
  totalDette?: number;
  nbCommandesNonPayees?: number;

  // ═══ STOCK ═══
  stockValue?: number;
  stockTotal?: number;
  totalProduits?: number;
  ruptureStock?: number;
  alertesStock?: number;
  stockNormal?: number;
  rotationRate?: number;

  // ═══ VARIATIONS ═══
  variationChiffreAffaires?: number;
  variationBenefice?: number;
  variationCommandesTotal?: number;
  variationCommandes?: number;
  variationClients?: number;
  variationDepenses?: number;
  variationAchats?: number;
  variationStockValue?: number;
  variationRupture?: number;
  variationAlertes?: number;
  variationStockNormal?: number;
  variationRotation?: number;

  // ═══ META ═══
  firstClientDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;

  // ═══ RÉTRO-COMPAT ═══
  [key: string]: any;
}

// ============================================================
// DASHBOARD CHARTS DATA
// ============================================================
export interface DashboardChartsData {
  // ═══ CHARTS ═══
  ventesParMois: any[];
  topProduits: any[];
  categorieRepartition: any[];
  stockStatus: { en_stock: number; stock_bas: number; rupture: number };
  entreesStock: any[];
  sortiesStock: any[];
  topClients: any[];
  depensesParCategorie: any[];
  commandesStatut: any[];
  ruptureStockDetails: any[];
  detteClientsDetails: any[];
  commandesEnAttenteDetails: any[];

  // ═══ SPARKLINES — VENTES ═══
  sparklineCA: number[];
  sparklineBenefice: number[];
  sparklineCommandes: number[];
  sparklineClients: number[];

  // ═══ SPARKLINES — DÉPENSES / ACHATS ═══
  sparklineDepenses: number[];
  sparklineAchats: number[];

  // ═══ SPARKLINES — STOCK ═══
  sparklineStockValue: number[];
  sparklineRupture: number[];
  sparklineAlertes: number[];
  sparklineRotation: number[];
}

// ============================================================
// CHART ITEM
// ============================================================
export interface ChartItem { [key: string]: any; }

// ============================================================
// ALERT ITEM
// ============================================================
export interface AlertItem {
  type: string;
  title: string;
  message: string;
  time: string;
}

// ============================================================
// KPI ITEM
// ============================================================
export interface KpiItem {
  key: string;
  title: string;
  value: number;
  variation?: number;
  variationLabel?: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  money?: boolean;
  negative?: boolean;
  showSign?: boolean;
  unit?: string;
  sparkline?: number[];
  sparklineColor?: string;
  tooltip?: string;
}

// ============================================================
// TOP PRODUCT
// ============================================================
export interface TopProduct {
  name: string;
  quantity: number;
  sales: number;
  evolution: number;
}