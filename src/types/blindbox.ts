export type Rarity = 'WHITE' | 'GREEN' | 'BLUE' | 'PURPLE' | 'GOLD' | 'RED';

export type BlindBoxId =
  | 'box_white'
  | 'box_purple'
  | 'box_gold'
  | 'box_red'
  | 'box_ice'
  | 'box_double'
  | string;

export type DropWeights = Record<Rarity, number>;

export interface BlindBoxConfig {
  boxId: BlindBoxId;
  name: string;
  category: 'base' | 'advanced' | 'premium' | 'boss' | 'mechanic' | 'surprise' | string;
  radiusGrid: number;
  splitCount: number;
  seriesFilter: string | null;
  featuredFigurines?: {
    ids: string[];
    weightMultiplier: number;
  };
  shellStyle: {
    fill: string;
    rimOuter: string;
    rimInner: string;
    glowColor: string;
    badgeText: string;
  };
  dropWeights: DropWeights;
  secondDropWeights?: DropWeights;
}

export interface BlindBoxFile {
  pity: {
    goldAfter: number;
    redAfter: number;
    redPityBoxes: BlindBoxId[];
    redPityRule?: string;
  };
  ftue: {
    levelId: number;
    boxId: BlindBoxId;
    forced: Partial<DropWeights>;
  };
  replayDrops: Record<string, Record<string, number> | string>;
  airdrop: {
    $comment?: string;
    firstClearEveryNLevels: number;
    replayEveryNClears: number;
    weights: Record<string, number>;
  };
  boxes: BlindBoxConfig[];
}
