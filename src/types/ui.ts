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
    easings: Record<string, [number, number, number, number]>;
  };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
