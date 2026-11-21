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
  drawCoverImage,
  drawOutlinedText,
  drawParchmentModalFrame,
  drawWoodButton,
  drawWoodCapsule,
  formatNetWorth,
  hitRect,
} from './UIHelpers';

export type AppraisalAction =
  | { type: 'NEXT_LEVEL' }
  | { type: 'OPEN_GALLERY' }
  | { type: 'REROLL_SLOT'; slotIndex: number }
  | { type: 'UNLOCK_AIRDROP' }
  | { type: 'SHARE_RED_JACKPOT'; figName: string; valuation: number };

/**
 * 通关出货鉴定台（复古放大镜 0.35s~2.25s 分品质阻尼慢转圈 + 双黄蛋分裂 + 空投盒 + 白绿重抽 + 绝世大红全屏砸卡特写）
 * 严格遵循 PRD §6.2 界面四 & UI_UX 规范 §2.2.3 / §3.1
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

  // 绝世大红全屏特写层状态
  private redJackpotOutcome: SingleDrawOutcome | null = null;
  private redSlamProgressSec = 0;

  private cardRects: Rect[] = [];
  private rerollBtnRect: Rect | null = null;
  private rerollTargetIdx = -1;
  private airdropBtnRect: Rect | null = null;
  private galleryBtnRect: Rect = { x: 0, y: 0, w: 120, h: 46 };
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

    // 推进下一格检视（若被重抽单格触发则直接结束）
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
    // 1. 绝世大红全屏特写层点击优先
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

    // 2. 扫描中支持按品质规则点击快进（PRD §6.2 界面四）
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

    // 3. 全部常规检视完毕后的按钮点击
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

    // 检视大红时的全屏压暗与心跳泛红暗角
    const currentScan = !this.allRevealed ? this.outcomes[this.scanningIdx] : null;
    const isScanningRed = currentScan?.rarity === 'RED' && this.doubleSplitAnimMs <= 0;

    const pw = Math.min(358, W - 22);
    const ph = Math.min(556, H - 84);
    const panel: Rect = { x: (W - pw) * 0.5, y: (H - ph) * 0.5 + 8, w: pw, h: ph };

    drawParchmentModalFrame(
      ctx,
      W,
      H,
      panel,
      `🎉 第 ${this.levelId} 关清罐鉴定`,
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

    // 计算卡片网格排布（含可选空投锁定槽）
    const showLockedAirdrop = Boolean(this.airdropBoxId && !this.airdropUnlocked);
    const totalSlots = this.outcomes.length + (showLockedAirdrop ? 1 : 0);
    const gridArea: Rect = {
      x: panel.x + 14,
      y: panel.y + 34,
      w: panel.w - 28,
      h: panel.h - 148,
    };

    this.cardRects = this.computeSlotRects(totalSlots, gridArea);
    this.rerollBtnRect = null;
    this.rerollTargetIdx = -1;
    this.airdropBtnRect = null;

    // 查找品质最低的白/绿卡供单关 1 次【重抽必升档】
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

    // 逐格绘制盲盒或已揭晓公仔卡
    for (let i = 0; i < this.outcomes.length; i++) {
      const rect = this.cardRects[i];
      const item = this.outcomes[i];
      const isRevealed = this.allRevealed || (i < this.scanningIdx && !item.rerolled);
      const isScanningThis = !this.allRevealed && i === this.scanningIdx && this.doubleSplitAnimMs <= 0;

      if (isRevealed) {
        this.renderRevealedCard(ctx, rect, item, assets);
        if (i === this.rerollTargetIdx) {
          const badge = rewardMgr.getBadgeSpec(false);
          this.rerollBtnRect = {
            x: rect.x + (rect.w - 108) * 0.5,
            y: rect.y + rect.h + 4,
            w: 108,
            h: 28,
          };
          drawWoodButton(ctx, this.rerollBtnRect, '🔄重抽升档', this.tokens, assets, {
            fontSize: 11,
            fillHex: '#0284C7',
            badgeText: badge.text,
            badgeBgHex: badge.bgHex,
          });
        }
      } else {
        this.renderUnrevealedBoxSlot(ctx, rect, item, isScanningThis, assets);
      }
    }

    // 绘制末尾空投锁定槽位
    if (showLockedAirdrop && this.airdropBoxId) {
      const airRect = this.cardRects[this.cardRects.length - 1];
      this.renderLockedAirdropSlot(ctx, airRect, this.airdropBoxId, assets, rewardMgr, timeSec);
    }

    // 底部汇总身价与双主按钮
    const totalGain = this.outcomes.reduce((s, o) => s + o.valuationAdded, 0);
    const summaryY = panel.y + panel.h - 92;
    drawOutlinedText(
      ctx,
      this.allRevealed
        ? `本关入账总身价：+${totalGain.toLocaleString()}`
        : '点击画面可加速检视...',
      panel.x + panel.w * 0.5,
      summaryY,
      `800 15px ${this.tokens.typography.numeralFontFamily}`,
      '#B45309',
      '#FFF8EC',
      2.5
    );

    const btnY = panel.y + panel.h - 62;
    this.galleryBtnRect = { x: panel.x + 18, y: btnY, w: 124, h: 46 };
    this.nextBtnRect = { x: panel.x + 152, y: btnY, w: panel.w - 170, h: 46 };

    drawWoodButton(ctx, this.galleryBtnRect, '🏛️大红藏馆', this.tokens, assets, {
      fontSize: 14,
      fillHex: '#7C5335',
      badgeText: hasCraftableRedDot ? '可合成!' : undefined,
      badgeBgHex: '#EF4444',
    });

    const nextLabel = this.levelId >= 20 ? '自由淘金 ▶' : `第 ${this.levelId + 1} 关 ▶`;
    drawWoodButton(ctx, this.nextBtnRect, nextLabel, this.tokens, assets, {
      fontSize: 16,
      fillHex: '#15803D',
      disabled: !this.allRevealed,
      pulse: this.allRevealed,
      pulsePhase: timeSec * 5.6,
    });

    // 绝世大红全屏特写层（RedJackpotOverlay）
    if (this.redJackpotOutcome) {
      this.renderRedJackpotOverlay(ctx, W, H, this.redJackpotOutcome, assets, timeSec);
    }

    // 爆光白闪叠加
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
    ctx.save();
    drawWoodCapsule(ctx, r, this.tokens, '#FDF1DC', this.tokens.theme.woodDark, 12);

    const cx = r.x + r.w * 0.5;
    const cy = r.y + r.h * 0.48;
    const boxSize = Math.min(r.w, r.h) * 0.62;

    // 双黄蛋摇晃分裂特效
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

    if (item.isSecondSplitOfDouble) {
      drawOutlinedText(
        ctx,
        '双黄第2抽·保底蓝+',
        cx,
        r.y + r.h - 16,
        `700 10px ${this.tokens.typography.fontFamily}`,
        '#7E22CE',
        '#FFFFFF',
        0
      );
    } else {
      drawOutlinedText(
        ctx,
        isScanningThis ? '放大镜鉴定中...' : '待鉴定',
        cx,
        r.y + r.h - 16,
        `700 11px ${this.tokens.typography.fontFamily}`,
        this.tokens.theme.inkSecondary,
        '#FFFFFF',
        0
      );
    }

    // 复古放大镜慢转圈动画（M-07）
    if (isScanningThis) {
      const progress = Math.min(1, this.scanElapsedSec / Math.max(0.1, this.scanTargetSec));
      // 高品质前快后极慢阻尼曲线
      const damped =
        item.rarity === 'RED' && progress > 0.92
          ? 0.92 // 第 2.10s 屏息悬停帧！
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

    ctx.restore();
  }

  private renderRevealedCard(
    ctx: CanvasRenderingContext2D,
    r: Rect,
    item: SingleDrawOutcome,
    assets: AssetLoader
  ): void {
    const rarTok = this.tokens.rarityTokens[item.rarity];
    const frameId = `ui_card_frame_${item.rarity.toLowerCase()}`;
    const frameImg = assets.get(frameId);

    ctx.save();
    // 品质光晕底
    ctx.fillStyle = rarTok.cardBg;
    ctx.strokeStyle = rarTok.border;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 12);
    ctx.fill();
    ctx.stroke();

    if (frameImg) {
      ctx.drawImage(frameImg, r.x, r.y, r.w, r.h);
    }

    // 公仔立绘居中安全区
    const figImg = assets.get(item.figurine.id);
    const figSz = Math.min(r.w * 0.72, r.h * 0.56);
    const fx = r.x + (r.w - figSz) * 0.5;
    const fy = r.y + r.h * 0.11;
    if (figImg) {
      ctx.drawImage(figImg, fx, fy, figSz, figSz);
    } else {
      ctx.fillStyle = rarTok.primary;
      ctx.beginPath();
      ctx.arc(r.x + r.w * 0.5, fy + figSz * 0.5, figSz * 0.36, 0, Math.PI * 2);
      ctx.fill();
    }

    // 底部名称与估值
    drawOutlinedText(
      ctx,
      item.figurine.name,
      r.x + r.w * 0.5,
      r.y + r.h - 28,
      `700 ${r.w < 110 ? 10.5 : 12}px ${this.tokens.typography.fontFamily}`,
      '#FFF8EC',
      this.tokens.theme.inkOutline,
      2.2
    );
    drawOutlinedText(
      ctx,
      `💰${formatNetWorth(item.figurine.valuation)}`,
      r.x + r.w * 0.5,
      r.y + r.h - 12,
      `700 10.5px ${this.tokens.typography.numeralFontFamily}`,
      rarTok.primary === '#9CA3AF' ? '#5A3A22' : rarTok.border,
      '#FFF8EC',
      2
    );

    // 左上角 NEW! 或右下角重复转碎片角标
    if (item.isNewUnlock) {
      ctx.fillStyle = '#F59E0B';
      ctx.strokeStyle = this.tokens.theme.inkOutline;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(r.x - 4, r.y - 5, 42, 18, 7);
      ctx.fill();
      ctx.stroke();
      drawOutlinedText(ctx, 'NEW!', r.x + 17, r.y + 4, '800 9.5px sans-serif', '#FFFFFF', this.tokens.theme.inkOutline, 1.5);
    } else if (item.shardsConverted > 0) {
      const tagW = Math.min(r.w - 8, 68);
      const tx = r.x + r.w - tagW - 4;
      const ty = r.y + 4;
      ctx.fillStyle = 'rgba(245, 158, 11, 0.92)';
      ctx.beginPath();
      ctx.roundRect(tx, ty, tagW, 17, 7);
      ctx.fill();
      drawOutlinedText(
        ctx,
        `🧩+${item.shardsConverted}`,
        tx + tagW * 0.5,
        ty + 8.5,
        `700 9.5px ${this.tokens.typography.fontFamily}`,
        '#FFFFFF',
        this.tokens.theme.inkOutline,
        1.4
      );
    }

    ctx.restore();
  }

  private renderLockedAirdropSlot(
    ctx: CanvasRenderingContext2D,
    r: Rect,
    boxId: BlindBoxId,
    assets: AssetLoader,
    rewardMgr: RewardManager,
    timeSec: number
  ): void {
    ctx.save();
    drawWoodCapsule(ctx, r, this.tokens, '#EDE9FE', '#6D28D9', 12);

    const cx = r.x + r.w * 0.5;
    const sway = Math.sin(timeSec * 3.2) * 4;
    const paraImg = assets.get('ui_airdrop_parachute');
    if (paraImg) {
      ctx.drawImage(paraImg, cx - 20 + sway, r.y + 4, 40, 40);
    }

    const boxImg = assets.get(boxId);
    const bSz = Math.min(r.w, r.h) * 0.48;
    if (boxImg) {
      ctx.drawImage(boxImg, cx - bSz * 0.5, r.y + 38, bSz, bSz);
    }

    const badge = rewardMgr.getBadgeSpec(false);
    this.airdropBtnRect = {
      x: r.x + 6,
      y: r.y + r.h - 34,
      w: r.w - 12,
      h: 28,
    };
    drawWoodButton(ctx, this.airdropBtnRect, '🪂领空投', this.tokens, assets, {
      fontSize: 11,
      fillHex: '#7E22CE',
      badgeText: badge.text,
      badgeBgHex: badge.bgHex,
      pulse: this.allRevealed,
      pulsePhase: timeSec * 5.5,
    });
    ctx.restore();
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
      ctx.fillStyle = 'rgba(22, 8, 8, 0.35)';
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = '#450A0A';
      ctx.fillRect(0, 0, W, H);
    }

    drawOutlinedText(
      ctx,
      '🚨 绝世大红出货！！',
      W * 0.5,
      H * 0.11,
      `800 24px ${this.tokens.typography.fontFamily}`,
      '#FDE047',
      '#5A3A22',
      3.5
    );

    const rollRatio = Math.min(1, this.redSlamProgressSec / 0.65);
    const shownVal = Math.round(item.figurine.valuation * rollRatio);
    drawOutlinedText(
      ctx,
      `+${shownVal.toLocaleString()}`,
      W * 0.5,
      H * 0.175,
      `800 32px ${this.tokens.typography.numeralFontFamily}`,
      '#FFFBEB',
      '#991B1B',
      4
    );

    // M-08 2.2x -> 1.0x 砸卡回弹特写
    const slamT = Math.min(1, this.redSlamProgressSec / 0.45);
    const cardScale = slamT < 1 ? 2.2 - 1.2 * (1 - Math.pow(1 - slamT, 3)) : 1 + Math.sin(timeSec * 4) * 0.02;
    const cw = 216;
    const ch = 288;

    ctx.save();
    ctx.translate(W * 0.5, H * 0.46);
    ctx.scale(cardScale, cardScale);
    this.renderRevealedCard(ctx, { x: -cw * 0.5, y: -ch * 0.5, w: cw, h: ch }, item, assets);
    ctx.restore();

    // 趣味鉴宝台词横幅
    const qw = Math.min(340, W - 28);
    const qRect: Rect = { x: (W - qw) * 0.5, y: H * 0.72, w: qw, h: 44 };
    drawWoodCapsule(ctx, qRect, this.tokens, '#FFF8EC', '#991B1B', 12);
    drawOutlinedText(
      ctx,
      item.figurine.quote,
      W * 0.5,
      qRect.y + 22,
      `700 11.5px ${this.tokens.typography.fontFamily}`,
      '#7F1D1D',
      '#FFFFFF',
      0
    );

    const btnY = H * 0.81;
    this.jackpotShareRect = { x: W * 0.5 - 152, y: btnY, w: 146, h: 48 };
    this.jackpotKeepRect = { x: W * 0.5 + 6, y: btnY, w: 140, h: 48 };

    drawWoodButton(ctx, this.jackpotShareRect, '🔥 炫耀晒单', this.tokens, assets, {
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
      const gapY = 30;
      const w = Math.min(126, (area.w - gapX) * 0.5);
      const h = Math.min(156, (area.h - gapY) * 0.5);
      const startX = area.x + (area.w - (w * 2 + gapX)) * 0.5;
      const startY = area.y + (area.h - (h * 2 + gapY)) * 0.45;
      const out: Rect[] = [];
      for (let i = 0; i < count; i++) {
        const col = i % 2;
        const row = (i / 2) | 0;
        out.push({ x: startX + col * (w + gapX), y: startY + row * (h + gapY), w, h });
      }
      return out;
    }
    // 5+ 格：上 3 下 N 居中
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
