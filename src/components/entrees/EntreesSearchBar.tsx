// src/components/stock/EntreesSearchBar.tsx
// ⭐ INDIGO (#4F46E5) + SLATE (#0F172A) DARK MODE
// ⭐ UPDATE: Natao hita kokoa ny border gris rehefa Light Mode (border-slate-300) sy dark:border-[0.5px]
// ⭐ FIX: Nesorina ny style inline, nampiasa Tailwind classes mba hahazoana hover/focus effects

import React from 'react';
import { Search } from 'lucide-react';

interface EntreesSearchBarProps {
  searchInput: string;
  onSearchChange: (value: string) => void;
}

const EntreesSearchBar: React.FC<EntreesSearchBarProps> = ({ searchInput, onSearchChange }) => {
  return (
    <div className="relative min-w-0 flex-1">
      <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-500 dark:text-brand-400" />
      <input
        type="text"
        placeholder="Rechercher une entrée produit ..."
        value={searchInput}
        onChange={(e) => onSearchChange(e.target.value)}
        // ⭐ FANOVÀNA: Natao border-slate-300, dark:border-[0.5px], ary hover:border-slate-400
        className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 text-[13.5px] text-slate-900 outline-none placeholder:text-slate-400 hover:border-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 dark:border-[0.5px] dark:border-white/[0.12] dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:hover:border-white/[0.18]"
      />
    </div>
  );
};

export default EntreesSearchBar;