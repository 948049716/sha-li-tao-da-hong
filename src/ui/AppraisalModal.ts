import type { ParticleSystem } from '../engine/ParticleSystem';
import type { AssetLoader } from '../platform/AssetLoader';
import type { AudioManager } from '../platform/AudioManager';
import type { HapticManager } from '../platform/HapticManager';
import type { ComputedLayout } from '../platform/LayoutManager';
import type { SingleDrawOutcome } from '../systems/GachaSystem';
import { RARITY_ORDER } from '../systems/GachaSystem';
import type { RewardManager } from '../systems/RewardManager';
import type { BlindBoxId } from '../types/blindbox';
import type { Rect, UiTokensFile } from '../types/ui';
import {
  drawCollectibleCard,
  drawCoverImage,
  drawDoubleRimPlaque,
  drawInkText,
  drawParchmentModalFrame,
  drawPlaqueText,
  drawRecessedTileCard,
  drawWoodButton,
  hitRect,
} from './UIHelpers';

export type AppraisalAction =
  | { type: 'NEXT_LEVEL' }
  | { type: 'OPEN_GALLERY' }
  | { type: 'REROLL_SLOT'; slotIndex: number }
  | { type: 'UNLOCK_AIRDROP' }
  | { type: 'SHARE_RED_JACKPOT'; figName: string; valuation: number };

/**
 * 通关出货鉴定台（AppraisalModal）
 * 复用统一藏品卡 drawCollectibleCard、双层嵌芯盲盒待检卡与双圈木镶边身价牌匾
 */
export class AppraisalModal {
  public levelId = 1;
  public outcomes: SingleDrawOutcome[] = [];
  public airdropBoxId: BlindBoxId | null = null;
  public airdropUnlocked = false;
  public rerollUsedThisLevel = false;

  private doubleSplitAnimMs = 0;
  private scanningIdx = 0;
  private scanElapsedSec = 0;
  private scanTargetSec = 0.35;
  private allRevealed = false;
  private flashWhiteAlpha = 0;

  private redJackpotOutcome: SingleDrawOutcome | null = null;
  private redSlamProgressSec = 0;

  private cardRects: Rect[] = [];
  private rerollBtnRect: Rect | null = null;
  private rerollTargetIdx = -1;
  private airdropBtnRect: Rect | null = null;
  private galleryBtnRect: Rect = { x: 0, y: 0, w: 124, h: 46 };
  private nextBtnRect: Rect = { x: 0, y: 0, w: 168, h: 46 };
  private jackpotShareRect: Rect = { x: 0, y: 0, w: 150, h: 46 };
  private jackpotKeepRect: Rect = { x: 0, y: 0, w: 136, h: 46 };

  private audio: AudioManager;
  private haptic: HapticManager;
  private particles: ParticleSystem;
  private tokens: UiTokensFile;

  constructor(
    audio: AudioManager,
    haptic: HapticManager,
    particles: ParticleSystem,
    tokens: UiTokensFile
  ) {
    this.audio = audio;
    this.haptic = haptic;
    this.particles = particles;
    this.tokens = tokens;
  }

  public open(
    levelId: number,
    outcomes: SingleDrawOutcome[],
    airdropBoxId: BlindBoxId | null
  ): void {
    this.levelId = levelId;
    this.outcomes = outcomes;
    this.airdropBoxId = airdropBoxId;
    this.airdropUnlocked = false;
    this.rerollUsedThisLevel = false;
    this.redJackpotOutcome = null;
    this.flashWhiteAlpha = 0;

    const hasDouble = outcomes.some(o => o.isSecondSplitOfDouble);
    this.doubleSplitAnimMs = hasDouble ? 450 : 0;
    if (hasDouble) {
      this.audio.playEvent('BOX_DOUBLE_SPLIT');
      this.haptic.triggerForEvent('BOX_DOUBLE_SPLIT');
    }

    this.scanningIdx = 0;
    this.allRevealed = outcomes.length === 0;
    if (!this.allRevealed) {
      this.startSlotScan(0);
    }
  }

  public replaceOutcomeAfterReroll(slotIndex: number, newOutcome: SingleDrawOutcome): void {
    this.outcomes[slotIndex] = newOutcome;
    this.rerollUsedThisLevel = true;
    this.allRevealed = false;
    this.scanningIdx = slotIndex;
    this.startSlotScan(slotIndex);
  }

  public appendAirdropOutcome(newOutcome: SingleDrawOutcome): void {
    this.airdropUnlocked = true;
    this.outcomes.push(newOutcome);
    this.allRevealed = false;
    this.scanningIdx = this.outcomes.length - 1;
    this.startSlotScan(this.scanningIdx);
  }

  private startSlotScan(idx: number): void {
    const item = this.outcomes[idx];
    if (!item) {
      this.allRevealed = true;
      this.audio.stopHeartbeat();
      return;
    }
    this.scanElapsedSec = 0;
    this.scanTargetSec = this.tokens.rarityTokens[item.rarity]?.scanDurationSec || 0.35;
    if (item.rarity === 'GOLD' || item.rarity === 'RED') {
      this.audio.startHeartbeat(item.rarity === 'RED');
      this.haptic.triggerForEvent('APPRAISAL_SCAN_HIGH');
    } else {
      this.audio.stopHeartbeat();
    }
  }

  private completeCurrentSlotReveal(screenW: number, screenH: number): void {
    this.audio.stopHeartbeat();
    const item = this.outcomes[this.scanningIdx];
    if (!item) return;

    const r = item.rarity;
    if (r === 'WHITE' || r === 'GREEN') {
      this.audio.playEvent('REVEAL_WHITE_GREEN');
    } else if (r === 'BLUE') {
      this.audio.playEvent('REVEAL_BLUE');
      this.haptic.triggerForEvent('REVEAL_BLUE');
    } else if (r === 'PURPLE') {
      this.audio.playEvent('REVEAL_PURPLE');
      this.haptic.triggerForEvent('REVEAL_PURPLE');
    } else if (r === 'GOLD') {
      this.audio.playEvent('REVEAL_GOLD');
      this.haptic.triggerForEvent('REVEAL_GOLD');
      this.flashWhiteAlpha = 0.45;
    } else if (r === 'RED') {
      this.audio.playEvent('REVEAL_RED_JACKPOT');
      this.haptic.triggerForEvent('REVEAL_RED_JACKPOT');
      this.flashWhiteAlpha = 0.92;
      this.redJackpotOutcome = item;
      this.redSlamProgressSec = 0;
      this.particles.spawnRedJackpotConfetti(screenW, screenH);
    }

    const cardRect = this.cardRects[this.scanningIdx];
    if (cardRect && (r === 'PURPLE' || r === 'GOLD' || r === 'RED')) {
      this.particles.spawnStarBurst(
        cardRect.x + cardRect.w * 0.5,
        cardRect.y + cardRect.h * 0.5,
        this.tokens.rarityTokens[r].primary,
        r === 'RED' ? 14 : 8
      );
    }

    if (item.rerolled) {
      this.scanningIdx = this.outcomes.length;
      this.allRevealed = true;
      return;
    }

    this.scanningIdx++;
    if (this.scanningIdx >= this.outcomes.length) {
      this.allRevealed = true;
    } else {
      this.startSlotScan(this.scanningIdx);
    }
  }

  public update(dtMs: number, screenW: number, screenH: number): void {
    const dtSec = dtMs / 1000;
    if (this.flashWhiteAlpha > 0) {
      this.flashWhiteAlpha = Math.max(0, this.flashWhiteAlpha - dtSec * 2.2);
    }

    if (this.redJackpotOutcome) {
      this.redSlamProgressSec += dtSec;
      return;
    }

    if (this.doubleSplitAnimMs > 0) {
      this.doubleSplitAnimMs = Math.max(0, this.doubleSplitAnimMs - dtMs);
      return;
    }

    if (!this.allRevealed && this.scanningIdx < this.outcomes.length) {
      this.scanElapsedSec += dtSec;
      if (this.scanElapsedSec >= this.scanTargetSec) {
        this.completeCurrentSlotReveal(screenW, screenH);
      }
    }
  }

  public handleTap(px: number, py: number, screenW: number, screenH: number): AppraisalAction | null {
    if (this.redJackpotOutcome) {
      if (hitRect(px, py, this.jackpotShareRect)) {
        const cur = this.redJackpotOutcome;
        return {
          type: 'SHARE_RED_JACKPOT',
          figName: cur.figurine.name,
          valuation: cur.figurine.valuation,
        };
      }
      if (hitRect(px, py, this.jackpotKeepRect)) {
        this.redJackpotOutcome = null;
        return null;
      }
      return null;
    }

    if (!this.allRevealed && this.doubleSplitAnimMs <= 0) {
      const cur = this.outcomes[this.scanningIdx];
      if (cur) {
        const canSkip =
          cur.rarity === 'WHITE' ||
          cur.rarity === 'GREEN' ||
          cur.rarity === 'BLUE' ||
          (cur.rarity === 'PURPLE' && this.scanElapsedSec >= 0.3) ||
          (cur.rarity === 'GOLD' && (!cur.isNewUnlock || this.scanElapsedSec >= 0.5)) ||
          (cur.rarity === 'RED' && !cur.isNewUnlock && this.scanElapsedSec >= 0.8);
        if (canSkip) {
          this.completeCurrentSlotReveal(screenW, screenH);
        }
      }
      return null;
    }

    if (this.rerollBtnRect && this.rerollTargetIdx >= 0 && hitRect(px, py, this.rerollBtnRect)) {
      return { type: 'REROLL_SLOT', slotIndex: this.rerollTargetIdx };
    }
    if (this.airdropBtnRect && this.airdropBoxId && !this.airdropUnlocked && hitRect(px, py, this.airdropBtnRect)) {
      return { type: 'UNLOCK_AIRDROP' };
    }
    if (hitRect(px, py, this.galleryBtnRect)) {
      return { type: 'OPEN_GALLERY' };
    }
    if (hitRect(px, py, this.nextBtnRect)) {
      return { type: 'NEXT_LEVEL' };
    }
    return null;
  }

  public render(
    ctx: CanvasRenderingContext2D,
    layout: ComputedLayout,
    assets: AssetLoader,
    rewardMgr: RewardManager,
    hasCraftableRedDot: boolean,
    timeSec: number
  ): void {
    const W = layout.screenW;
    const H = layout.screenH;

    const currentScan = !this.allRevealed ? this.outcomes[this.scanningIdx] : null;
    const isScanningRed = currentScan?.rarity === 'RED' && this.doubleSplitAnimMs <= 0;

    const pw = Math.min(362, W - 20);
    const ph = Math.min(566, H - 80);
    const panel: Rect = { x: (W - pw) * 0.5, y: (H - ph) * 0.5 + 8, w: pw, h: ph };

    drawParchmentModalFrame(
      ctx,
      W,
      H,
      panel,
      `第 ${this.levelId} 关 · 清罐鉴宝台`,
      this.tokens,
      assets,
      'ui_bg_appraisal'
    );

    if (isScanningRed) {
      const beatPulse = 0.22 + 0.16 * Math.sin(this.scanElapsedSec * Math.PI * 5.2);
      const grad = ctx.createRadialGradient(W * 0.5, H * 0.5, W * 0.18, W * 0.5, H * 0.5, H * 0.65);
      grad.addColorStop(0, 'rgba(239, 68, 68, 0)');
      grad.addColorStop(1, `rgba(185, 28, 28, ${beatPulse})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }

    const showLockedAirdrop = Boolean(this.airdropBoxId && !this.airdropUnlocked);
    const totalSlots = this.outcomes.length + (showLockedAirdrop ? 1 : 0);
    const gridArea: Rect = {
      x: panel.x + 14,
      y: panel.y + 30,
      w: panel.w - 28,
      h: panel.h - 148,
    };

    this.cardRects = this.computeSlotRects(totalSlots, gridArea);
    this.rerollBtnRect = null;
    this.rerollTargetIdx = -1;
    this.airdropBtnRect = null;

    if (this.allRevealed && !this.rerollUsedThisLevel) {
      let lowestRank = 99;
      this.outcomes.forEach((o, idx) => {
        const rk = RARITY_ORDER.indexOf(o.rarity);
        if ((o.rarity === 'WHITE' || o.rarity === 'GREEN') && rk < lowestRank) {
          lowestRank = rk;
          this.rerollTargetIdx = idx;
        }
      });
    }

    for (let i = 0; i < this.outcomes.length; i++) {
      const rect = this.cardRects[i];
      const item = this.outcomes[i];
      const isRevealed = this.allRevealed || (i < this.scanningIdx && !item.rerolled);
      const isScanningThis = !this.allRevealed && i === this.scanningIdx && this.doubleSplitAnimMs <= 0;

      if (isRevealed) {
        drawCollectibleCard(ctx, rect, item.figurine, this.tokens, assets, {
          owned: true,
          isNewUnlock: item.isNewUnlock,
          shardsConverted: item.shardsConverted,
        });
        if (i === this.rerollTargetIdx) {
          const badge = rewardMgr.getBadgeSpec(false);
          this.rerollBtnRect = {
            x: rect.x + (rect.w - 108) * 0.5,
            y: rect.y + rect.h + 4,
            w: 108,
            h: 28,
          };
          drawWoodButton(ctx, this.rerollBtnRect, '重抽必升档', this.tokens, assets, {
            fontSize: 11,
            fillHex: '#0284C7',
            icon: assets.get('ui_prop_reroll'),
            iconSize: 16,
            badgeText: badge.text,
            badgeBgHex: badge.bgHex,
          });
        }
      } else {
        this.renderUnrevealedBoxSlot(ctx, rect, item, isScanningThis, assets);
      }
    }

    if (showLockedAirdrop && this.airdropBoxId) {
      const airRect = this.cardRects[this.cardRects.length - 1];
      this.renderLockedAirdropSlot(ctx, airRect, this.airdropBoxId, assets, rewardMgr, timeSec);
    }

    // 底部双圈木镶边总身价入账横匾（严格内缩于羊皮纸安全区内，不压四角铜片）
    const totalGain = this.outcomes.reduce((s, o) => s + o.valuationAdded, 0);
    const sumW = panel.w - 48;
    const sumRect: Rect = {
      x: panel.x + 24,
      y: panel.y + panel.h - 112,
      w: sumW,
      h: 30,
    };
    drawDoubleRimPlaque(ctx, sumRect, this.tokens, {
      variant: this.allRevealed ? 'amber' : 'parchment',
      rimThickness: 3.0,
      radius: 15,
    });
    drawInkText(
      ctx,
      this.allRevealed ? `本关入账总身价  +${totalGain.toLocaleString()}` : '放大镜逐盒鉴定中（轻触可加速）...',
      sumRect.x + sumW * 0.5,
      sumRect.y + 15.5,
      this.tokens,
      {
        font: `800 12.5px ${this.tokens.typography.numeralFontFamily}`,
        color: this.allRevealed ? '#7C2D12' : '#5C3A1E',
        maxWidth: sumW - 18,
      }
    );

    const btnY = panel.y + panel.h - 72;
    this.galleryBtnRect = { x: panel.x + 24, y: btnY, w: 122, h: 44 };
    this.nextBtnRect = { x: panel.x + 154, y: btnY, w: panel.w - 178, h: 44 };

    drawWoodButton(ctx, this.galleryBtnRect, '大红藏馆', this.tokens, assets, {
      fontSize: 13.5,
      fillHex: '#7E22CE',
      icon: assets.get('box_red'),
      iconSize: 22,
      badgeText: hasCraftableRedDot ? '可合成' : undefined,
      badgeBgHex: '#EF4444',
    });

    const nextLabel = this.levelId >= 20 ? '自由淘金 ▸' : `第 ${this.levelId + 1} 关 ▸`;
    drawWoodButton(ctx, this.nextBtnRect, nextLabel, this.tokens, assets, {
      fontSize: 16,
      fillHex: '#15803D',
      disabled: !this.allRevealed,
      pulse: this.allRevealed,
      pulsePhase: timeSec * 5.6,
    });

    if (this.redJackpotOutcome) {
      this.renderRedJackpotOverlay(ctx, W, H, this.redJackpotOutcome, assets, timeSec);
    }

    if (this.flashWhiteAlpha > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(255, 251, 235, ${this.flashWhiteAlpha})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  private renderUnrevealedBoxSlot(
    ctx: CanvasRenderingContext2D,
    r: Rect,
    item: SingleDrawOutcome,
    isScanningThis: boolean,
    assets: AssetLoader
  ): void {
    const inner = drawRecessedTileCard(ctx, r, this.tokens, {
      variant: isScanningThis ? 'amber' : 'parchment',
      radius: 13,
      rimWidth: 3.6,
    });

    const cx = r.x + r.w * 0.5;
    const cy = inner.y + inner.h * 0.44;
    const boxSize = Math.min(inner.w, inner.h) * 0.62;

    let shakeAngle = 0;
    if (this.doubleSplitAnimMs > 0 && item.sourceBoxId === 'box_double') {
      shakeAngle = Math.sin(this.doubleSplitAnimMs * 0.09) * 0.24;
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(shakeAngle);
    const boxImg = assets.get(item.sourceBoxId);
    if (boxImg) {
      ctx.drawImage(boxImg, -boxSize * 0.5, -boxSize * 0.5, boxSize, boxSize);
    }
    ctx.restore();

    drawInkText(
      ctx,
      item.isSecondSplitOfDouble
        ? '双黄第2抽·保底蓝+'
        : isScanningThis
          ? '鉴定中...'
          : '待鉴定',
      cx,
      inner.y + inner.h - 11,
      this.tokens,
      {
        font: `700 10.5px ${this.tokens.typography.fontFamily}`,
        color: item.isSecondSplitOfDouble ? '#6B21A8' : '#5C3A1E',
        maxWidth: inner.w - 8,
      }
    );

    if (isScanningThis) {
      const progress = Math.min(1, this.scanElapsedSec / Math.max(0.1, this.scanTargetSec));
      const damped =
        item.rarity === 'RED' && progress > 0.92
          ? 0.92
          : 1 - Math.pow(1 - progress, item.rarity === 'RED' || item.rarity === 'GOLD' ? 2.8 : 1.5);
      const turns = item.rarity === 'RED' ? 1.6 : item.rarity === 'GOLD' ? 1.3 : 1.0;
      const theta = damped * Math.PI * 2 * turns;

      const rarColor = this.tokens.rarityTokens[item.rarity].primary;
      const scanRing = assets.getTinted('ui_scan_ring', rarColor);
      if (scanRing) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-theta * 0.8);
        const ringSz = boxSize * 1.18;
        ctx.drawImage(scanRing, -ringSz * 0.5, -ringSz * 0.5, ringSz, ringSz);
        ctx.restore();
      }

      const orbitR = Math.min(24, r.w * 0.18);
      const mx = cx + Math.cos(theta) * orbitR;
      const my = cy + Math.sin(theta) * orbitR;
      const magImg = assets.get('ui_magnifier');
      if (magImg) {
        const mSz = Math.min(68, r.w * 0.56);
        ctx.drawImage(magImg, mx - mSz * 0.4, my - mSz * 0.4, mSz, mSz);
      }
    }
  }

  private renderLockedAirdropSlot(
    ctx: CanvasRenderingContext2D,
    r: Rect,
    boxId: BlindBoxId,
    assets: AssetLoader,
    rewardMgr: RewardManager,
    timeSec: number
  ): void {
    const inner = drawRecessedTileCard(ctx, r, this.tokens, {
      variant: 'lavender',
      radius: 13,
      rimWidth: 3.6,
    });

    const cx = r.x + r.w * 0.5;
    const sway = Math.sin(timeSec * 3.2) * 4;
    const paraImg = assets.get('ui_airdrop_parachute');
    if (paraImg) {
      ctx.drawImage(paraImg, cx - 19 + sway, inner.y + 2, 38, 38);
    }

    const boxImg = assets.get(boxId);
    const bSz = Math.min(inner.w, inner.h) * 0.46;
    if (boxImg) {
      ctx.drawImage(boxImg, cx - bSz * 0.5, inner.y + 34, bSz, bSz);
    }

    const badge = rewardMgr.getBadgeSpec(false);
    this.airdropBtnRect = {
      x: r.x + 6,
      y: r.y + r.h - 33,
      w: r.w - 12,
      h: 27,
    };
    drawWoodButton(ctx, this.airdropBtnRect, '领空投盒', this.tokens, assets, {
      fontSize: 11,
      fillHex: '#7E22CE',
      badgeText: badge.text,
      badgeBgHex: badge.bgHex,
      pulse: this.allRevealed,
      pulsePhase: timeSec * 5.5,
    });
  }

  private renderRedJackpotOverlay(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    item: SingleDrawOutcome,
    assets: AssetLoader,
    timeSec: number
  ): void {
    ctx.save();
    const bg = assets.get('ui_bg_share_poster');
    if (bg) {
      drawCoverImage(ctx, bg, W, H);
      ctx.fillStyle = 'rgba(24, 9, 8, 0.36)';
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = '#450A0A';
      ctx.fillRect(0, 0, W, H);
    }

    drawPlaqueText(ctx, '✦ 绝世大红出货 ✦', W * 0.5, H * 0.11, this.tokens, {
      font: `800 25px ${this.tokens.typography.fontFamily}`,
      fill: '#FFE57F',
      stroke: '#4A180B',
      strokeWidth: 3.4,
    });

    const rollRatio = Math.min(1, this.redSlamProgressSec / 0.65);
    const shownVal = Math.round(item.figurine.valuation * rollRatio);
    drawPlaqueText(ctx, `+${shownVal.toLocaleString()}`, W * 0.5, H * 0.175, this.tokens, {
      font: `800 32px ${this.tokens.typography.numeralFontFamily}`,
      fill: '#FFFBEB',
      stroke: '#881313',
      strokeWidth: 3.6,
    });

    const slamT = Math.min(1, this.redSlamProgressSec / 0.45);
    const cardScale = slamT < 1 ? 2.2 - 1.2 * (1 - Math.pow(1 - slamT, 3)) : 1 + Math.sin(timeSec * 4) * 0.02;
    const cw = 216;
    const ch = 288;

    ctx.save();
    ctx.translate(W * 0.5, H * 0.46);
    ctx.scale(cardScale, cardScale);
    drawCollectibleCard(ctx, { x: -cw * 0.5, y: -ch * 0.5, w: cw, h: ch }, item.figurine, this.tokens, assets, {
      owned: true,
      isNewUnlock: item.isNewUnlock,
      shardsConverted: item.shardsConverted,
    });
    ctx.restore();

    const qw = Math.min(342, W - 28);
    const qRect: Rect = { x: (W - qw) * 0.5, y: H * 0.72, w: qw, h: 42 };
    drawDoubleRimPlaque(ctx, qRect, this.tokens, {
      variant: 'rose',
      rimThickness: 3.6,
      radius: 21,
    });
    drawInkText(ctx, `「${item.figurine.quote}」`, W * 0.5, qRect.y + 21.5, this.tokens, {
      font: `700 11.5px ${this.tokens.typography.fontFamily}`,
      color: '#6E1818',
      maxWidth: qw - 24,
    });

    const btnY = H * 0.81;
    this.jackpotShareRect = { x: W * 0.5 - 152, y: btnY, w: 146, h: 48 };
    this.jackpotKeepRect = { x: W * 0.5 + 6, y: btnY, w: 140, h: 48 };

    drawWoodButton(ctx, this.jackpotShareRect, '✦ 炫耀晒单', this.tokens, assets, {
      fontSize: 15,
      fillHex: '#DC2626',
      pulse: true,
      pulsePhase: timeSec * 6,
    });
    drawWoodButton(ctx, this.jackpotKeepRect, '收入囊中', this.tokens, assets, {
      fontSize: 15,
    });

    ctx.restore();
  }

  private computeSlotRects(count: number, area: Rect): Rect[] {
    if (count <= 0) return [];
    if (count === 1) {
      const w = Math.min(162, area.w * 0.65);
      const h = Math.min(216, area.h * 0.85);
      return [{ x: area.x + (area.w - w) * 0.5, y: area.y + (area.h - h) * 0.45, w, h }];
    }
    if (count === 2) {
      const gap = 14;
      const w = Math.min(144, (area.w - gap) * 0.5);
      const h = Math.min(192, w * 1.33);
      const startX = area.x + (area.w - (w * 2 + gap)) * 0.5;
      const y = area.y + (area.h - h) * 0.45;
      return [
        { x: startX, y, w, h },
        { x: startX + w + gap, y, w, h },
      ];
    }
    if (count <= 4) {
      const gapX = 12;
      const gapY = 26;
      const w = Math.min(126, (area.w - gapX) * 0.5);
      const h = Math.min(156, (area.h - gapY) * 0.5);
      const startX = area.x + (area.w - (w * 2 + gapX)) * 0.5;
      const startY = area.y + (area.h - (h * 2 + gapY)) * 0.45;
      const out: Rect[] = [];
      for (let i = 0; i < count; i++) {
        const col = i % 2;
        const row = (i / 2) | 0;
        const isLoneLast = count === 3 && i === 2;
        const rx = isLoneLast ? area.x + (area.w - w) * 0.5 : startX + col * (w + gapX);
        out.push({ x: rx, y: startY + row * (h + gapY), w, h });
      }
      return out;
    }
    const gapX = 8;
    const gapY = 26;
    const w = Math.min(98, (area.w - gapX * 2) / 3);
    const h = Math.min(132, (area.h - gapY) * 0.5);
    const topStartX = area.x + (area.w - (w * 3 + gapX * 2)) * 0.5;
    const startY = area.y + 4;
    const out: Rect[] = [];
    for (let i = 0; i < 3; i++) {
      out.push({ x: topStartX + i * (w + gapX), y: startY, w, h });
    }
    const rem = count - 3;
    const botStartX = area.x + (area.w - (w * rem + gapX * (rem - 1))) * 0.5;
    for (let i = 0; i < rem; i++) {
      out.push({ x: botStartX + i * (w + gapX), y: startY + h + gapY, w, h });
    }
    return out;
  }
}
