import type { Rarity } from './blindbox';

export interface RarityDef {
  label: string;
  shardValue: number;
  valuation: [number, number];
}

export interface FigurineItem {
  id: string;
  name: string;
  rarity: Rarity;
  valuation: number;
  species: string;
  archetype: string;
  tags: string[];
  quote: string;
  spriteKey?: string;
}

export interface FigurineSeriesConfig {
  seriesId: string;
  seriesName: string;
  unlockReward: {
    type: 'sand_skin' | 'drain_fx' | string;
    id: string;
    name: string;
    title?: string;
  };
  items: FigurineItem[];
}

export interface FigurineFile {
  rarities: Record<Rarity, RarityDef>;
  craftRules: {
    normalCost: number;
    premiumCost: number;
    premiumPool: Rarity[];
    unownedWeightBoost: number;
  };
  series: FigurineSeriesConfig[];
}
