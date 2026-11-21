import blindBoxesJson from '../../data/blindboxes.json';
import figurinesJson from '../../data/figurines.json';
import type { BlindBoxConfig, BlindBoxFile, BlindBoxId, DropWeights, Rarity } from '../types/blindbox';
import type { FigurineFile, FigurineItem, FigurineSeriesConfig } from '../types/figurine';
import type { LevelCapsuleDef, LevelConfig } from '../types/level';
import type { PlayerSaveData } from '../types/save';

export const RARITY_ORDER: Rarity[] = ['WHITE', 'GREEN', 'BLUE', 'PURPLE', 'GOLD', 'RED'];

export interface SingleDrawOutcome {
  slotIndex: number;
  sourceBoxId: BlindBoxId;
  isSecondSplitOfDouble: boolean;
  rarity: Rarity;
  figurine: FigurineItem;
  isNewUnlock: boolean;
  shardsConverted: number;
  valuationAdded: number;
  // 供重抽回滚账务使用（PRD §3.4 P1 防双份套利）
  prevPityGold: number;
  prevPityRed: number;
  rerolled?: boolean;
}

export interface CraftOutcome {
  tier: 'NORMAL_5' | 'PREMIUM_25';
  costShards: number;
  figurine: FigurineItem;
  rarity: Rarity;
  isNewUnlock: boolean;
  valuationAdded: number;
  wasFullPoolSprint: boolean;
}

export class GachaSystem {
  public readonly boxFile: BlindBoxFile = blindBoxesJson as unknown as BlindBoxFile;
  public readonly figFile: FigurineFile = figurinesJson as unknown as FigurineFile;
  public readonly boxMap = new Map<string, BlindBoxConfig>();
  public readonly allFigurines: FigurineItem[] = [];
  public readonly figById = new Map<string, FigurineItem>();

  constructor() {
    for (const b of this.boxFile.boxes) {
      this.boxMap.set(b.boxId, b);
    }
    for (const s of this.figFile.series) {
      for (const item of s.items) {
        this.allFigurines.push(item);
        this.figById.set(item.id, item);
      }
    }
  }

  public getSeriesList(): FigurineSeriesConfig[] {
    return this.figFile.series;
  }

  /**
   * 区分首通掉落 vs 已通关复刷淘金替换（PRD §3.2 / AC-09）
   */
  public resolveLevelCapsules(
    level: LevelConfig,
    maxClearedLevel: number,
    rng: () => number = Math.random
  ): LevelCapsuleDef[] {
    const isFirstClear = level.levelId > maxClearedLevel;
    if (isFirstClear) {
      return (level.capsules || []).map(c => ({ ...c }));
    }
    return (level.capsules || []).map(c => {
      const table = this.boxFile.replayDrops[c.boxType];
      if (!table || typeof table === 'string') {
        return { ...c, boxType: 'box_white' };
      }
      const picked = this.rollWeightedKey(table, rng) || 'box_white';
      return { ...c, boxType: picked };
    });
  }

  /**
   * 判断本关结算是否触发【额外盲盒空投】（首通逢 3 倍数关，或满通后每复刷 5 局）
   */
  public rollAirdropBoxIfEligible(
    levelId: number,
    wasFirstClear: boolean,
    replayedClearCount: number,
    rng: () => number = Math.random
  ): BlindBoxId | null {
    const cfg = this.boxFile.airdrop;
    const eligible = wasFirstClear
      ? levelId % cfg.firstClearEveryNLevels === 0
      : replayedClearCount > 0 && replayedClearCount % cfg.replayEveryNClears === 0;
    if (!eligible) return null;
    return this.rollWeightedKey(cfg.weights, rng) || 'box_purple';
  }

  /**
   * 一次性预结算本关战利品袋中所有盲盒（支持双黄蛋分裂为 2 抽），直接更新 saveData
   */
  public settleLootBag(
    lootBoxIds: BlindBoxId[],
    levelId: number,
    save: PlayerSaveData,
    rng: () => number = Math.random
  ): SingleDrawOutcome[] {
    const outcomes: SingleDrawOutcome[] = [];
    for (const boxId of lootBoxIds) {
      const cfg = this.boxMap.get(boxId) || this.boxMap.get('box_white')!;
      const first = this.rollSingleDraw(
        outcomes.length,
        cfg.boxId,
        cfg.dropWeights,
        false,
        levelId,
        save,
        rng
      );
      outcomes.push(first);

      if (cfg.splitCount >= 2 && cfg.secondDropWeights) {
        const second = this.rollSingleDraw(
          outcomes.length,
          cfg.boxId,
          cfg.secondDropWeights,
          true,
          levelId,
          save,
          rng
        );
        outcomes.push(second);
      }
    }
    return outcomes;
  }

  /**
   * 单次抽取完整算法（严格遵循 PRD §3.4 P0 -> P2 -> P3 优先级与 §4.2 Stage 2 权重）
   */
  public rollSingleDraw(
    slotIndex: number,
    boxId: BlindBoxId,
    rawWeights: DropWeights,
    isSecondSplitOfDouble: boolean,
    levelId: number,
    save: PlayerSaveData,
    rng: () => number = Math.random
  ): SingleDrawOutcome {
    const prevPityGold = save.pityGoldCount;
    const prevPityRed = save.pityRedCount;
    let rarity: Rarity;

    // P0: 第 1 关新手首盒必爽锁（70% 紫 + 30% 金）
    if (levelId === this.boxFile.ftue.levelId && !save.ftueFirstBoxOpened) {
      rarity = (this.rollWeightedKey(this.boxFile.ftue.forced as Record<string, number>, rng) as Rarity) || 'PURPLE';
      save.ftueFirstBoxOpened = true;
    } else {
      const qualifiesRedPity =
        this.boxFile.pity.redPityBoxes.includes(boxId) && (rawWeights.RED || 0) >= 4;

      // P2: 40 抽绝世大红暗保底（高阶盒必爆大红）
      if (save.pityRedCount >= this.boxFile.pity.redAfter && qualifiesRedPity) {
        rarity = 'RED';
      } else if (save.pityGoldCount >= this.boxFile.pity.goldAfter) {
        // P3: 15 抽传说小金暗保底（仅保留 GOLD 与 RED 权重归一化）
        const highOnly: Record<string, number> = {
          GOLD: Math.max(1, rawWeights.GOLD || 0),
          RED: rawWeights.RED || 0,
        };
        rarity = (this.rollWeightedKey(highOnly, rng) as Rarity) || 'GOLD';
      } else {
        rarity = (this.rollWeightedKey(rawWeights, rng) as Rarity) || 'WHITE';
      }
    }

    // 更新双暗保底计数
    if (rarity === 'RED') {
      save.pityRedCount = 0;
      save.pityGoldCount = 0;
    } else if (rarity === 'GOLD') {
      save.pityGoldCount = 0;
      save.pityRedCount++;
    } else {
      save.pityGoldCount++;
      save.pityRedCount++;
    }

    const figurine = this.pickFigurineInRarity(rarity, boxId, save.ownedMap, rng);
    return this.applyFigurineToSave(
      slotIndex,
      boxId,
      isSecondSplitOfDouble,
      figurine,
      prevPityGold,
      prevPityRed,
      save
    );
  }

  /**
   * 鉴定台【重抽必升档】：先精确回滚原白/绿卡账务，再剔除 <= 原品质权重重抽（PRD §3.4 P1 / AC-10）
   */
  public rerollUpgradeOutcome(
    oldOutcome: SingleDrawOutcome,
    save: PlayerSaveData,
    rng: () => number = Math.random
  ): SingleDrawOutcome {
    // 1. 精确回滚原公仔账务与保底计数
    const oldId = oldOutcome.figurine.id;
    const curOwned = save.ownedMap[oldId] || 0;
    if (curOwned <= 1) {
      delete save.ownedMap[oldId];
    } else {
      save.ownedMap[oldId] = curOwned - 1;
    }
    save.totalNetWorth = Math.max(0, save.totalNetWorth - oldOutcome.valuationAdded);
    save.shards = Math.max(0, save.shards - oldOutcome.shardsConverted);
    save.pityGoldCount = oldOutcome.prevPityGold;
    save.pityRedCount = oldOutcome.prevPityRed;

    // 2. 剔除 <= 原品质权重并归一化
    const cfg = this.boxMap.get(oldOutcome.sourceBoxId) || this.boxMap.get('box_white')!;
    const raw =
      oldOutcome.isSecondSplitOfDouble && cfg.secondDropWeights
        ? cfg.secondDropWeights
        : cfg.dropWeights;
    const oldRank = RARITY_ORDER.indexOf(oldOutcome.rarity);

    const upgradedWeights: Record<string, number> = {};
    let sum = 0;
    for (let i = oldRank + 1; i < RARITY_ORDER.length; i++) {
      const r = RARITY_ORDER[i];
      const w = raw[r] || 0;
      if (w > 0) {
        upgradedWeights[r] = w;
        sum += w;
      }
    }
    if (sum <= 0) {
      const nextRarity = RARITY_ORDER[Math.min(RARITY_ORDER.length - 1, oldRank + 1)];
      upgradedWeights[nextRarity] = 100;
    }

    const prevPityGold = save.pityGoldCount;
    const prevPityRed = save.pityRedCount;
    const newRarity = (this.rollWeightedKey(upgradedWeights, rng) as Rarity) || 'BLUE';

    if (newRarity === 'RED') {
      save.pityRedCount = 0;
      save.pityGoldCount = 0;
    } else if (newRarity === 'GOLD') {
      save.pityGoldCount = 0;
      save.pityRedCount++;
    } else {
      save.pityGoldCount++;
      save.pityRedCount++;
    }

    const newFig = this.pickFigurineInRarity(newRarity, oldOutcome.sourceBoxId, save.ownedMap, rng);
    const updated = this.applyFigurineToSave(
      oldOutcome.slotIndex,
      oldOutcome.sourceBoxId,
      oldOutcome.isSecondSplitOfDouble,
      newFig,
      prevPityGold,
      prevPityRed,
      save
    );
    updated.rerolled = true;
    return updated;
  }

  private pickFigurineInRarity(
    rarity: Rarity,
    boxId: BlindBoxId,
    ownedMap: Record<string, number>,
    rng: () => number
  ): FigurineItem {
    const candidates = this.allFigurines.filter(f => f.rarity === rarity);
    const boxCfg = this.boxMap.get(boxId);
    const featuredSet = new Set(boxCfg?.featuredFigurines?.ids || []);
    const themeMult = boxCfg?.featuredFigurines?.weightMultiplier || 1.0;
    const unownedBoost = this.figFile.craftRules.unownedWeightBoost || 1.5;

    const weights: Record<string, number> = {};
    for (const f of candidates) {
      const wUnlock = (ownedMap[f.id] || 0) === 0 ? unownedBoost : 1.0;
      const wTheme = featuredSet.has(f.id) ? themeMult : 1.0;
      weights[f.id] = wUnlock * wTheme;
    }
    const pickedId = this.rollWeightedKey(weights, rng) || candidates[0].id;
    return this.figById.get(pickedId) || candidates[0];
  }

  private applyFigurineToSave(
    slotIndex: number,
    sourceBoxId: BlindBoxId,
    isSecondSplitOfDouble: boolean,
    figurine: FigurineItem,
    prevPityGold: number,
    prevPityRed: number,
    save: PlayerSaveData
  ): SingleDrawOutcome {
    const prevCount = save.ownedMap[figurine.id] || 0;
    const isNewUnlock = prevCount === 0;
    save.ownedMap[figurine.id] = Math.min(9999, prevCount + 1);
    save.totalNetWorth += figurine.valuation;

    let shardsConverted = 0;
    if (!isNewUnlock) {
      shardsConverted = this.figFile.rarities[figurine.rarity]?.shardValue || 1;
      save.shards += shardsConverted;
    }

    return {
      slotIndex,
      sourceBoxId,
      isSecondSplitOfDouble,
      rarity: figurine.rarity,
      figurine,
      isNewUnlock,
      shardsConverted,
      valuationAdded: figurine.valuation,
      prevPityGold,
      prevPityRed,
    };
  }

  /**
   * 5 碎片普通未解锁保底合成 & 满 30/30 身价冲刺兜底（PRD §5.2 / AC-11）
   */
  public craftNormal5(save: PlayerSaveData, rng: () => number = Math.random): CraftOutcome | null {
    const cost = this.figFile.craftRules.normalCost;
    if (save.shards < cost) return null;
    save.shards -= cost;

    const baseWeights: Record<Rarity, number> = {
      WHITE: 35,
      GREEN: 28,
      BLUE: 20,
      PURPLE: 10,
      GOLD: 5,
      RED: 2,
    };

    const unowned = this.allFigurines.filter(f => (save.ownedMap[f.id] || 0) === 0);
    if (unowned.length > 0) {
      const activeRarityWeights: Record<string, number> = {};
      for (const r of RARITY_ORDER) {
        if (unowned.some(f => f.rarity === r)) {
          activeRarityWeights[r] = baseWeights[r];
        }
      }
      const pickedRarity = (this.rollWeightedKey(activeRarityWeights, rng) as Rarity) || unowned[0].rarity;
      const pool = unowned.filter(f => f.rarity === pickedRarity);
      const fig = pool[Math.floor(rng() * pool.length)] || unowned[0];
      save.ownedMap[fig.id] = 1;
      save.totalNetWorth += fig.valuation;
      return {
        tier: 'NORMAL_5',
        costShards: cost,
        figurine: fig,
        rarity: fig.rarity,
        isNewUnlock: true,
        valuationAdded: fig.valuation,
        wasFullPoolSprint: false,
      };
    }

    // 30/30 满图鉴身价冲刺盒（不二次返还碎片，防套利漏洞）
    const pickedRarity = (this.rollWeightedKey(baseWeights, rng) as Rarity) || 'WHITE';
    const pool = this.allFigurines.filter(f => f.rarity === pickedRarity);
    const fig = pool[Math.floor(rng() * pool.length)] || this.allFigurines[0];
    save.ownedMap[fig.id] = Math.min(9999, (save.ownedMap[fig.id] || 0) + 1);
    save.totalNetWorth += fig.valuation;
    return {
      tier: 'NORMAL_5',
      costShards: cost,
      figurine: fig,
      rarity: fig.rarity,
      isNewUnlock: false,
      valuationAdded: fig.valuation,
      wasFullPoolSprint: true,
    };
  }

  public isHighTierPoolFull(save: PlayerSaveData): boolean {
    const highPool = this.figFile.craftRules.premiumPool;
    return this.allFigurines
      .filter(f => highPool.includes(f.rarity))
      .every(f => (save.ownedMap[f.id] || 0) > 0);
  }

  /**
   * 25 碎片紫/金/大红高阶定向冲刺合成（PRD §5.2 / AC-11）
   */
  public craftPremium25(save: PlayerSaveData, rng: () => number = Math.random): CraftOutcome | null {
    const cost = this.figFile.craftRules.premiumCost;
    if (save.shards < cost) return null;
    save.shards -= cost;

    const baseWeights: Record<string, number> = {
      PURPLE: 60,
      GOLD: 30,
      RED: 10,
    };
    const highPoolRarities = this.figFile.craftRules.premiumPool;
    const highAll = this.allFigurines.filter(f => highPoolRarities.includes(f.rarity));
    const unownedHigh = highAll.filter(f => (save.ownedMap[f.id] || 0) === 0);

    if (unownedHigh.length > 0) {
      const activeWeights: Record<string, number> = {};
      for (const r of highPoolRarities) {
        if (unownedHigh.some(f => f.rarity === r)) {
          activeWeights[r] = baseWeights[r] || 10;
        }
      }
      const pickedRarity = (this.rollWeightedKey(activeWeights, rng) as Rarity) || unownedHigh[0].rarity;
      const pool = unownedHigh.filter(f => f.rarity === pickedRarity);
      const fig = pool[Math.floor(rng() * pool.length)] || unownedHigh[0];
      save.ownedMap[fig.id] = 1;
      save.totalNetWorth += fig.valuation;
      return {
        tier: 'PREMIUM_25',
        costShards: cost,
        figurine: fig,
        rarity: fig.rarity,
        isNewUnlock: true,
        valuationAdded: fig.valuation,
        wasFullPoolSprint: false,
      };
    }

    // 12/12 高阶满池身价冲刺（不返还碎片）
    const pickedRarity = (this.rollWeightedKey(baseWeights, rng) as Rarity) || 'PURPLE';
    const pool = highAll.filter(f => f.rarity === pickedRarity);
    const fig = pool[Math.floor(rng() * pool.length)] || highAll[0];
    save.ownedMap[fig.id] = Math.min(9999, (save.ownedMap[fig.id] || 0) + 1);
    save.totalNetWorth += fig.valuation;
    return {
      tier: 'PREMIUM_25',
      costShards: cost,
      figurine: fig,
      rarity: fig.rarity,
      isNewUnlock: false,
      valuationAdded: fig.valuation,
      wasFullPoolSprint: true,
    };
  }

  public checkSeriesCompletion(series: FigurineSeriesConfig, save: PlayerSaveData): {
    ownedCount: number;
    totalCount: number;
    isComplete: boolean;
    isClaimed: boolean;
    isEquipped: boolean;
  } {
    const totalCount = series.items.length;
    const ownedCount = series.items.filter(it => (save.ownedMap[it.id] || 0) > 0).length;
    const isComplete = ownedCount >= totalCount;
    const rewardId = series.unlockReward.id;
    const isSkin = series.unlockReward.type === 'sand_skin';
    const isClaimed = isSkin
      ? save.unlockedSkins.includes(rewardId)
      : save.unlockedSuctionFx.includes(rewardId);
    const isEquipped = isSkin
      ? save.equippedSkinId === rewardId
      : save.equippedSuctionFxId === rewardId;
    return { ownedCount, totalCount, isComplete, isClaimed, isEquipped };
  }

  private rollWeightedKey(weights: Record<string, number>, rng: () => number): string | null {
    let total = 0;
    const entries: [string, number][] = [];
    for (const [k, v] of Object.entries(weights)) {
      if (k.startsWith('$') || typeof v !== 'number' || v <= 0) continue;
      total += v;
      entries.push([k, v]);
    }
    if (total <= 0 || entries.length === 0) return null;
    let r = rng() * total;
    for (const [k, v] of entries) {
      r -= v;
      if (r <= 0) return k;
    }
    return entries[entries.length - 1][0];
  }
}
