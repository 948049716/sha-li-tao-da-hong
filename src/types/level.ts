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
  startsOpen?: boolean;
  reusable?: boolean;
  linkedTo?: string;
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
  iceType?: IceKind; // brittle=需排空下垫软沙直砸裸露硬底碎裂
  shatterDrop?: number; // 脆冰砖最小硬底落差（默认 44 格）
  thawContacts?: number;
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

/**
 * 候选接沙木桶定义：
 * - 按 `col`（0..3）分配至底部 3~4 列纵深候选队列，同一列内按数组先后顺序从前排（row 0）向后排排列；
 * - `mystery: true` 表示问号盲桶（在后排隐藏真实颜色，升至列首 row 0 时揭晓）；
 * - `iceLayers: 1..3` 表示冰封木桶（每当任意在槽木桶 100% 满桶消除时，冰层 -1，归零后方可点击入槽）。
 */
export interface BucketDef {
  color: SandColorId;
  zones: string[];
  col?: number;
  mystery?: boolean;
  iceLayers?: number;
}

export interface LevelConfig {
  levelId: number;
  key: string;
  difficulty: number;
  type: 'tutorial' | 'normal' | 'bonus' | 'boss' | string;
  mechanics: string[];
  vesselTemplate: VesselTemplateId;
  numCols?: number; // 底部候选丝带玻璃瓶列数（3 或 4）
  hint?: string;
  ftue?: {
    handPointBoard?: string;
    highlightCol?: number;
    highlightLock?: string;
    highlightDyeRing?: number;
  };
  staticWalls: StaticWallDef[];
  boards: BoardDef[];
  sandZones: SandZoneDef[];
  dyeRings: DyeRingDef[];
  bucketQueue: BucketDef[];
  /** 标准通关混合操作序列：`"col:0".."col:3"` 表示点选对应列首木桶入槽，其余字符串表示抽开对应 `boardId` */
  solution: string[];
  expectTrap?: boolean;
  antiGreedy?: boolean;
}

export interface ChapterFile {
  chapter: number;
  chapterName: string;
  colorLegend: Record<string, string>;
  levels: LevelConfig[];
}
