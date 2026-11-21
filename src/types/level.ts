import type { BlindBoxId, Rarity } from './blindbox';

export type SandColorId = 1 | 2 | 3 | 4 | 5;
export type VesselTemplateId =
  | 'jar_standard_v1'
  | 'jar_tall_narrow_v1'
  | 'hourglass_wide_v1'
  | 'milk_tea_cup_v1'
  | string;

export interface VesselWallSegment {
  points: [number, number][];
  thickness: number;
}

export interface VesselDef {
  name: string;
  walls: VesselWallSegment[];
}

export type VesselCatalog = Record<string, VesselDef>;

export interface StaticWallDef {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  thickness?: number;
}

export interface BoardDef {
  id: string;
  label?: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  kind?: 'slant' | string;
  lockColor?: SandColorId;
}

export interface SandZoneDef {
  id: string;
  color: SandColorId;
  shape: 'rect' | 'poly' | string;
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
  points?: [number, number][];
  frozen?: boolean;
  shatterDrop?: number;
  expectDyeTo?: SandColorId;
}

export interface DyeRingDef {
  id: string;
  fromColors: SandColorId[];
  toColor: SandColorId;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface BucketDef {
  color: SandColorId;
  zones: string[];
}

export interface LevelCapsuleDef {
  boxType: BlindBoxId;
  x: number;
  y: number;
}

export interface LevelConfig {
  levelId: number;
  key: string;
  title: string;
  difficulty: number;
  type: 'tutorial' | 'normal' | 'bonus' | 'boss' | string;
  mechanics: string[];
  vesselTemplate: VesselTemplateId;
  hint?: string;
  ftue?: {
    handPointBoard?: string;
    highlightBucket?: number;
    highlightLock?: string;
    highlightDyeRing?: number;
    guaranteedFirstBox?: Rarity[];
  };
  staticWalls: StaticWallDef[];
  boards: BoardDef[];
  sandZones: SandZoneDef[];
  dyeRings: DyeRingDef[];
  bucketQueue: BucketDef[];
  solution: string[];
  expectTrap?: boolean;
  capsules: LevelCapsuleDef[];
}

export interface ChapterFile {
  chapter: number;
  chapterName: string;
  colorLegend: Record<string, string>;
  levels: LevelConfig[];
}
