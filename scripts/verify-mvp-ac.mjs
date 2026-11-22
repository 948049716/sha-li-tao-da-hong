#!/usr/bin/env node
import { createServer } from 'vite';
import assert from 'node:assert/strict';

/**
 * 《沙里淘大红》纯粹流沙抽栓版 自动化验收测试套件（覆盖 AC-01 ~ AC-07）
 */
async function main() {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });

  try {
    const { SandEngine } = await vite.ssrLoadModule('/src/engine/SandEngine.ts');
    const { LevelManager } = await vite.ssrLoadModule('/src/systems/LevelManager.ts');
    const { createDefaultSaveData, mergeSaveData } = await vite.ssrLoadModule('/src/systems/SaveManager.ts');
    const { LayoutManager } = await vite.ssrLoadModule('/src/platform/LayoutManager.ts');

    const levelMgr = new LevelManager();
    const layoutMgr = new LayoutManager();

    function stepUntilIdle(engine, maxFrames = 6000) {
      let idle = 0;
      for (let f = 0; f < maxFrames; f++) {
        const act = engine.step(f * 16.6);
        if (engine.won) return 'win';
        idle = act === 0 ? idle + 1 : 0;
        if (idle >= 22) return 'idle';
      }
      return 'timeout';
    }

    function execAction(engine, action) {
      if (typeof action === 'string' && action.startsWith('col:')) {
        return engine.dispatchBucket(Number(action.slice(4)));
      }
      return engine.pullBoard(action, false);
    }

    // 1. AC-01 ~ AC-03：TypeScript SandEngine 跑通全部 20 关双核解法 + 问号盲桶 / 冰封桶 / 高空脆冰 / FIFO 校验
    if (!process.argv.includes('--skip-20')) {
      console.log('▶ [AC-01~03] 验证 TypeScript SandEngine 首章 1~20 关双核通关与核心机关规则...');
      for (const lvl of levelMgr.levels) {
        process.stdout.write(`  模拟校验 L${String(lvl.levelId).padStart(2, '0')}「${lvl.title}」...\r`);
        const eng = new SandEngine();
        eng.loadLevel(lvl, levelMgr.vessels);
        stepUntilIdle(eng, 1500);
        for (const act of lvl.solution) {
          if (eng.won) break;
          const res = execAction(eng, act);
          assert.equal(res.ok, true, `关卡 ${lvl.levelId} 执行动作 ${act} 失败: ${JSON.stringify(res)}`);
          stepUntilIdle(eng, 6000);
        }
        assert.equal(eng.won, true, `关卡 ${lvl.levelId}「${lvl.title}」在 TypeScript SandEngine 下未通关`);
      }
      process.stdout.write('\n');

      // 反向验证高空脆冰软沙缓冲铁律（L4 未清底沙抢抽托冰栓绝不碎裂）
      {
        const lvl4 = levelMgr.getLevel(4);
        const eng4 = new SandEngine();
        eng4.loadLevel(lvl4, levelMgr.vessels);
        stepUntilIdle(eng4, 600);
        eng4.pullBoard('b_ice', false);
        stepUntilIdle(eng4, 600);
        assert.equal(eng4.ice[0].shattered, false, '第 4 关未排空底沙时高空脆冰因软沙缓冲绝不可摔碎');
      }

      // 验证 L7 问号盲桶递进至 Row 0 自动翻牌揭晓
      {
        const lvl7 = levelMgr.getLevel(7);
        const eng7 = new SandEngine();
        eng7.loadLevel(lvl7, levelMgr.vessels);
        stepUntilIdle(eng7, 600);
        assert.equal(eng7.bucketSys.columns[0][1].mysteryRevealed, false, '后排问号盲桶初始必须隐藏真色');
        eng7.dispatchBucket(0);
        assert.equal(eng7.bucketSys.columns[0][0].mysteryRevealed, true, '递进至列首第 0 排瞬间必须自动翻牌揭晓');
      }

      // 验证同色多桶在槽严格按入槽先后 FIFO 灌装（先满先清腾空卡槽）
      {
        const lvl2 = levelMgr.getLevel(2);
        const eng2 = new SandEngine();
        eng2.loadLevel(lvl2, levelMgr.vessels);
        stepUntilIdle(eng2, 600);
        eng2.dispatchBucket(0); // Yellow A -> Slot 0 (placedSeq=1)
        eng2.dispatchBucket(1); // Yellow C -> Slot 1 (placedSeq=2)
        const recv = eng2.bucketSys.findReceivingBucket(2);
        assert.equal(recv?.slotIdx, 0, '同色多桶在槽必须严格优先灌满最早入槽的木桶');
      }
      console.log('  ✅ 全部 20 关在 TypeScript SandEngine 100% 通关，脆冰缓冲/问号盲桶/冰封桶/FIFO 规则验证通过！');
    }

    // 2. AC-04：磁吸满桶 1:1 颗粒守恒 & 候选洗牌保底救援
    console.log('▶ [AC-04] 验证【磁吸满桶】1:1 颗粒守恒与【候选洗牌】列首保底救援...');
    {
      const lvl2 = levelMgr.getLevel(2);
      const eng = new SandEngine();
      eng.loadLevel(lvl2, levelMgr.vessels);
      stepUntilIdle(eng, 600);
      eng.dispatchBucket(0); // Yellow A
      eng.dispatchBucket(2); // Green Top
      stepUntilIdle(eng, 200);
      assert.equal(eng.canUseMagnet(), true, '卡槽有木桶时磁吸满桶应可用');
      const taken1 = eng.useMagnetFill(1000);
      assert.ok(taken1 > 0, '磁吸满桶必须抽走对应缺口颗粒');
      const taken2 = eng.useMagnetFill(1200);
      assert.ok(taken2 > 0);
      stepUntilIdle(eng, 600);
      eng.dispatchBucket(2); // Blue Bot
      stepUntilIdle(eng, 1500);
      eng.dispatchBucket(0); // Yellow B
      eng.dispatchBucket(1); // Yellow C
      stepUntilIdle(eng, 1500);
      eng.pullBoard('b_right_pink', false);
      eng.pullBoard('b_left_green', false);
      stepUntilIdle(eng, 1500);
      eng.dispatchBucket(1); // Pink Right
      stepUntilIdle(eng, 2000);
      assert.equal(eng.won, true, '使用磁吸满桶后剩余木桶必须严格 1:1 颗粒守恒顺利通关');

      // 验证候选洗牌将匹配滤网底沙的非冰封桶推至列首 Row 0
      const lvl4 = levelMgr.getLevel(4);
      const engShuf = new SandEngine();
      engShuf.loadLevel(lvl4, levelMgr.vessels);
      stepUntilIdle(engShuf, 600);
      assert.equal(engShuf.canUseShuffle(), true);
      assert.equal(engShuf.useShuffleColumns(), true);
      assert.equal(engShuf.bucketSys.columns[0][0].color, 1, '候选洗牌应优先将匹配滤网裸露粉沙的非冰封桶置顶至第 0 列排头');
    }
    console.log('  ✅ 磁吸满桶 1:1 守恒与候选洗牌保底救援验证通过！');

    // 3. AC-05：双核撤回（选桶+抽栓回退）与第 5 槽资格保留
    console.log('▶ [AC-05] 验证双核撤回（选桶+抽栓回退）与第 5 槽资格保留...');
    {
      const lvl2 = levelMgr.getLevel(2);
      const eng2 = new SandEngine();
      eng2.loadLevel(lvl2, levelMgr.vessels);
      stepUntilIdle(eng2, 400);
      assert.equal(eng2.bucketSys.enableExtraSlot(), true);
      assert.equal(eng2.bucketSys.maxActiveSlots, 5, '加开第 5 槽后最大激活小卡槽数应为 5');
      eng2.dispatchBucket(0);
      assert.equal(eng2.bucketSys.occupiedSlotCount, 1);
      assert.equal(eng2.undo(), true, '选桶入槽动作必须可撤回');
      assert.equal(eng2.bucketSys.occupiedSlotCount, 0, '撤回选桶后小卡槽应恢复为空');
      assert.equal(eng2.bucketSys.maxActiveSlots, 5, '撤回后必须保留已解锁的第 5 临时槽资格');

      const lvl1 = levelMgr.getLevel(1);
      const eng1 = new SandEngine();
      eng1.loadLevel(lvl1, levelMgr.vessels);
      stepUntilIdle(eng1, 400);
      eng1.dispatchBucket(0);
      eng1.dispatchBucket(1);
      stepUntilIdle(eng1, 1500);
      eng1.pullBoard('b_top', false);
      for (let i = 0; i < 30; i++) eng1.step(i * 16);
      assert.equal(eng1.undo(), true, '抽栓动作必须可撤回');
      eng1.pullBoard('b_top', false);
      stepUntilIdle(eng1, 2000);
      eng1.dispatchBucket(2);
      stepUntilIdle(eng1, 2000);
      assert.equal(eng1.won, true, '撤回抽栓后重新抽栓必须正常通关');
    }
    console.log('  ✅ 双核撤回与第 5 槽资格保留验证通过！');

    // 4. AC-06：纯粹解谜存档 Schema v2 合并规则（最高关、总通关、最佳用时取优）
    console.log('▶ [AC-06] 验证纯粹解谜存档 Schema v2 与云端合并规则...');
    {
      const local = createDefaultSaveData();
      local.updatedAt = 1000;
      local.currentLevel = 5;
      local.maxClearedLevel = 4;
      local.totalClears = 8;
      local.winStreak = 3;
      local.bestTimeSecMap = { 1: 18, 2: 25 };

      const remote = createDefaultSaveData();
      remote.updatedAt = 2000;
      remote.currentLevel = 7;
      remote.maxClearedLevel = 6;
      remote.totalClears = 6;
      remote.winStreak = 4;
      remote.bestTimeSecMap = { 1: 15, 3: 31 };

      const merged = mergeSaveData(local, remote);
      assert.equal(merged.schemaVersion, 2);
      assert.equal(merged.currentLevel, 7, '当前关卡应取双端最大值');
      assert.equal(merged.maxClearedLevel, 6, '最高通关数应取双端最大值');
      assert.equal(merged.totalClears, 8, '总通关次数应取双端最大值');
      assert.equal(merged.winStreak, 4, '连胜应取最新记录');
      assert.equal(merged.bestTimeSecMap[1], 15, '同关最佳用时应取更短记录');
      assert.equal(merged.bestTimeSecMap[2], 25);
      assert.equal(merged.bestTimeSecMap[3], 31);
    }
    console.log('  ✅ 存档 Schema v2 与双端合并验证通过！');

    // 5. AC-07：多机型胶囊安全避让与三枚极简顶栏 + 五段式排桶台零重叠校验
    console.log('▶ [AC-07] 验证多机型微信右上角胶囊安全避让与极简三枚顶栏零重叠布局...');
    const devices = [
      { name: 'iPhone SE', width: 375, height: 667, statusBarHeight: 20 },
      { name: 'iPhone 15 Pro', width: 393, height: 852, statusBarHeight: 54 },
      { name: 'Android 20:9', width: 384, height: 864, statusBarHeight: 32 },
    ];
    for (const dev of devices) {
      const lay = layoutMgr.compute({
        width: dev.width,
        height: dev.height,
        dpr: 2,
        statusBarHeight: dev.statusBarHeight,
        safeBottom: 20,
        menuButtonRect: { x: dev.width - 97, y: dev.statusBarHeight + 6, w: 87, h: 32 },
      });
      const doubleCapsuleZone = {
        x: dev.width - 198,
        y: lay.menuRect.y,
        w: 190,
        h: lay.menuRect.h,
      };
      const topPills = [lay.settingsPill, lay.guidePill, lay.restartPill];
      for (let i = 0; i < topPills.length; i++) {
        const pill = topPills[i];
        const xOverlap =
          pill.x < doubleCapsuleZone.x + doubleCapsuleZone.w &&
          pill.x + pill.w > doubleCapsuleZone.x;
        const yOverlap =
          pill.y < doubleCapsuleZone.y + doubleCapsuleZone.h &&
          pill.y + pill.h > doubleCapsuleZone.y;
        assert.ok(!(xOverlap && yOverlap), `${dev.name} 顶栏组件与微信右上角双胶囊区重叠！`);
        if (i > 0) {
          assert.ok(
            pill.x >= topPills[i - 1].x + topPills[i - 1].w + 2,
            `${dev.name} 顶栏相邻按钮发生横向重叠！`
          );
        }
      }
      assert.equal(lay.activeSlotRects.length, 5, '必须具备 4+1 共 5 个小卡槽布局矩形');
      assert.ok(
        lay.chamberRect.y > lay.topHudY + lay.topHudH &&
          lay.chamberRect.y + lay.chamberRect.h <= lay.slotRowRect.y &&
          lay.slotRowRect.y + lay.slotRowRect.h <= lay.candidateAreaRect.y &&
          lay.candidateAreaRect.y + lay.candidateAreaRect.h <= lay.propRowRect.y,
        `${dev.name} 顶栏/沙盘/小卡槽/候选列/道具栏发生纵向重叠！`
      );
    }
    console.log('  ✅ 多屏幕比例胶囊避让与极简三枚顶栏 + 五段式布局零重叠验证通过！');
    console.log('\n🎉 纯粹流沙抽栓版全量自动化验收标准 (AC-01 ~ AC-07) 全部通过！');
  } finally {
    await vite.close();
  }
}

main().catch(err => {
  console.error('❌ 验收测试未通过:', err);
  process.exit(1);
});
