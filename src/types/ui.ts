import type { Rarity } from './blindbox';

export interface SandPaletteEntry {
  id: number;
  key: string;
  name: string;
  baseHex: string;
  highlightHex: string;
  shadowHex: string;
  bucketTint: string;
  noiseDelta: number;
  sparkleChance?: number;
}

export interface RarityTokenEntry {
  label: string;
  primary: string;
  cardBg: string;
  border: string;
  accentGold?: string;
  glow: string;
  badgeBg: string;
  text: string;
  scanDurationSec: number;
}

export interface RankBadgeDef {
  level: number;
  title: string;
  minNetWorth: number;
  tintHex: string;
  borderHex: string;
  assetId: string;
}

export interface UiTokensFile {
  version: number;
  theme: {
    id: string;
    inkOutline: string;
    inkSecondary: string;
    woodPrimary: string;
    woodDark: string;
    woodHighlight: string;
    parchmentBg: string;
    parchmentCard: string;
    starryNightBg: string;
    amberGlow: string;
    brassAccent: string;
    modalBackdrop: string;
    dangerText: string;
    successText: string;
    mutedText: string;
  };
  sandPalette: Record<string, SandPaletteEntry | string>;
  rarityTokens: Record<Rarity, RarityTokenEntry>;
  rankBadges: RankBadgeDef[];
  viewport: {
    designWidth: number;
    designHeight: number;
    topHudHeightRatio: [number, number];
    sandChamberWidthRatio: [number, number];
    sandChamberHeightRatio: [number, number];
    bottomBarHeightRatio: [number, number];
    wxCapsuleSafeMarginRightPx: number;
    boardHitPaddingPx: number;
    pointerCancelMovePx: number;
  };
  typography: {
    fontFamily: string;
    numeralFontFamily: string;
    scalePx: {
      heroValuation: number;
      modalTitle: number;
      sectionTitle: number;
      hudPrimary: number;
      body: number;
      caption: number;
      badgeMicro: number;
    };
  };
  motion: {
    buttonPressScale: number;
    buttonPressDurationMs: number;
    disabledAlpha: number;
    modalEnterDurationMs: number;
    modalExitDurationMs: number;
    boardPullDurationMs: number;
    bucketSwapDurationMs: number;
    capsuleFlyDurationMs: number;
    easings: Record<string, [number, number, number, number]>;
  };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
