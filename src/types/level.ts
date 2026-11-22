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
  startsOpen?: boolean; // 初始为虚线开口态
  reusable?: boolean;   // 往复推拉活门：可无限次推入关闸 / 拉出开闸
  linkedTo?: string;    // 联动双栓：点击本木板会同步触发伙伴木板
}

export type IceKind = 'brittle' | 'permafrost';

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
  iceType?: IceKind;     // brittle=需高空直砸裸露硬底(软沙缓冲不碎), permafrost=摔不碎需流沙冲刷融化
  shatterDrop?: number;  // 脆冰砖最小硬底落差（默认 52 格）
  thawContacts?: number; // 万年寒冰所需流沙颗粒接触冲刷量
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
  antiGreedy?: boolean;
  capsules: LevelCapsuleDef[];
}

export interface ChapterFile {
  chapter: number;
  chapterName: string;
  colorLegend: Record<string, string>;
  levels: LevelConfig[];
}
