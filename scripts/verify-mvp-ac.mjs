#!/usr/bin/env node
import { createServer } from 'vite';
import assert from 'node:assert/strict';

/**
 * 《沙里淘大红》日系治愈极简丝带玻璃瓶版 自动化验收测试套件（覆盖 AC-01 ~ AC-07）
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

    // 1. AC-01 ~ AC-03：TypeScript SandEngine 跑通全部 20 关双核解法 + 开局零提前流动 + 问号瓶 / 冰晶瓶 / 脆冰 / FIFO 校验
    if (!process.argv.includes('--skip-20')) {
      console.log('▶ [AC-01~03] 验证 TypeScript SandEngine 首章 01~20 关双核通关、开局静止态与核心机关规则...');
      for (const lvl of levelMgr.levels) {
        const ord = String(lvl.levelId).padStart(2, '0');
        process.stdout.write(`  模拟校验 L${ord}...\r`);
        assert.equal(lvl.title, undefined, `关卡 ${ord} 不应包含冗余关卡标题字段`);
        const eng = new SandEngine();
        eng.loadLevel(lvl, levelMgr.vessels);
        const firstStepMoved = eng.step(16.6);
        assert.equal(firstStepMoved, 0, `关卡 ${ord} 开局未操作前第 1 帧不得有流沙自行下落`);
        stepUntilIdle(eng, 1500);
        for (const act of lvl.solution) {
          if (eng.won) break;
          const res = execAction(eng, act);
          assert.equal(res.ok, true, `关卡 ${ord} 执行动作 ${act} 失败: ${JSON.stringify(res)}`);
          stepUntilIdle(eng, 6000);
        }
        assert.equal(eng.won, true, `关卡 ${ord} 在 TypeScript SandEngine 下未通关`);
      }
      process.stdout.write('\n');

      // 反向验证高空脆冰软沙缓冲铁律（L04 未清底沙抢抽托冰拨片绝不碎裂）
      {
        const lvl4 = levelMgr.getLevel(4);
        const eng4 = new SandEngine();
        eng4.loadLevel(lvl4, levelMgr.vessels);
        stepUntilIdle(eng4, 600);
        eng4.pullBoard('b_ice', false);
        stepUntilIdle(eng4, 600);
        assert.equal(eng4.ice[0].shattered, false, '04 关未排空底沙时高空脆冰因软沙缓冲绝不可摔碎');
      }

      // 验证 L07 问号玻璃瓶递进至 Row 0 自动揭晓丝带颜色
      {
        const lvl7 = levelMgr.getLevel(7);
        const eng7 = new SandEngine();
        eng7.loadLevel(lvl7, levelMgr.vessels);
        stepUntilIdle(eng7, 600);
        assert.equal(eng7.bucketSys.columns[0][1].mysteryRevealed, false, '后排雾面问号瓶初始必须隐藏真色');
        eng7.dispatchBucket(0);
        assert.equal(eng7.bucketSys.columns[0][0].mysteryRevealed, true, '递进至列首第 0 排瞬间必须自动翻面揭晓');
      }

      // 验证同色多瓶在槽严格按入槽先后 FIFO 灌装
      {
        const lvl2 = levelMgr.getLevel(2);
        const eng2 = new SandEngine();
        eng2.loadLevel(lvl2, levelMgr.vessels);
        stepUntilIdle(eng2, 600);
        eng2.dispatchBucket(0); // Yellow 1 -> Slot 0 (placedSeq=1)
        eng2.dispatchBucket(1); // Yellow 2 -> Slot 1 (placedSeq=2)
        const recv = eng2.bucketSys.findReceivingBucket(2);
        assert.equal(recv?.slotIdx, 0, '同色多瓶在槽必须严格优先灌满最早入槽的玻璃瓶');
      }
      console.log('  ✅ 全部 20 关在 TypeScript SandEngine 100% 通关，开局零提前流动与核心机关规则验证通过！');
    }

    // 2. AC-04：隔空磁吸 1:1 颗粒守恒 & 候选洗牌保底救援
    console.log('▶ [AC-04] 验证【隔空磁吸】1:1 颗粒守恒与【候选洗牌】列首保底救援...');
    {
      const lvl2 = levelMgr.getLevel(2);
      const eng = new SandEngine();
      eng.loadLevel(lvl2, levelMgr.vessels);
      stepUntilIdle(eng, 600);
      eng.dispatchBucket(0); // Yellow 1 (locked above b_mid_yel)
      eng.dispatchBucket(3); // PinkL (locked above b_left_top_pnk)
      stepUntilIdle(eng, 200);
      assert.equal(eng.canUseMagnet(), true, '接沙台有玻璃瓶时隔空磁吸应可用');
      const taken1 = eng.useMagnetFill(1000);
      assert.ok(taken1 > 0, '隔空磁吸必须抽走对应缺口颗粒');
      const taken2 = eng.useMagnetFill(1200);
      assert.ok(taken2 > 0, '第二次隔空磁吸必须抽走对应缺口颗粒');
      stepUntilIdle(eng, 600);

      // 继续完成 L02 剩余全部玻璃瓶，验证 1:1 颗粒守恒无残留通关
      eng.dispatchBucket(2); // Park Yellow 3
      eng.dispatchBucket(0); // Clear Blue 1
      eng.dispatchBucket(2); // Clear Blue 2
      stepUntilIdle(eng, 1500);
      eng.pullBoard('b_mid_yel', false);
      eng.dispatchBucket(1); // Clear Yellow 2
      stepUntilIdle(eng, 1500);
      eng.dispatchBucket(2); // Clear Green 1
      eng.dispatchBucket(3); // Clear Green 2
      stepUntilIdle(eng, 1500);
      eng.pullBoard('b_left_top_pnk', false);
      eng.pullBoard('b_right_trap_pnk', false);
      eng.dispatchBucket(0); // Clear PinkR 1
      eng.dispatchBucket(1); // Clear PinkR 2
      stepUntilIdle(eng, 2500);
      assert.equal(eng.won, true, '使用隔空磁吸后剩余玻璃瓶必须严格 1:1 颗粒守恒顺利通关');

      // 验证候选洗牌将匹配滤网底沙的非冰封玻璃瓶置顶至列首 Row 0
      const lvl4 = levelMgr.getLevel(4);
      const engShuf = new SandEngine();
      engShuf.loadLevel(lvl4, levelMgr.vessels);
      stepUntilIdle(engShuf, 600);
      assert.equal(engShuf.canUseShuffle(), true);
      assert.equal(engShuf.useShuffleColumns(), true);
      assert.equal(engShuf.bucketSys.columns[0][0].color, 1, '候选洗牌应优先将匹配滤网裸露粉沙的非冰封瓶置顶至第 0 列排头');
    }
    console.log('  ✅ 隔空磁吸 1:1 守恒与候选洗牌保底救援验证通过！');

    // 3. AC-05：双核撤回（选瓶+抽拨片回退）与第 5 瓶位资格保留
    console.log('▶ [AC-05] 验证双核撤回（选瓶+抽拨片回退）与第 5 瓶位资格保留...');
    {
      const lvl2 = levelMgr.getLevel(2);
      const eng2 = new SandEngine();
      eng2.loadLevel(lvl2, levelMgr.vessels);
      stepUntilIdle(eng2, 400);
      assert.equal(eng2.bucketSys.enableExtraSlot(), true);
      assert.equal(eng2.bucketSys.maxActiveSlots, 5, '加开第 5 瓶位后最大激活接沙槽数应为 5');
      eng2.dispatchBucket(0);
      assert.equal(eng2.bucketSys.occupiedSlotCount, 1);
      assert.equal(eng2.undo(), true, '选瓶入台动作必须可撤回');
      assert.equal(eng2.bucketSys.occupiedSlotCount, 0, '撤回选瓶后接沙台应恢复为空');
      assert.equal(eng2.bucketSys.maxActiveSlots, 5, '撤回后必须保留已解锁的第 5 临时瓶位资格');

      const lvl1 = levelMgr.getLevel(1);
      const eng1 = new SandEngine();
      eng1.loadLevel(lvl1, levelMgr.vessels);
      stepUntilIdle(eng1, 400);
      eng1.dispatchBucket(0);
      eng1.dispatchBucket(1);
      stepUntilIdle(eng1, 1500);
      eng1.pullBoard('b_top', false);
      for (let i = 0; i < 30; i++) eng1.step(i * 16);
      assert.equal(eng1.undo(), true, '抽拨片动作必须可撤回');
      eng1.pullBoard('b_top', false);
      stepUntilIdle(eng1, 2000);
      eng1.dispatchBucket(2);
      stepUntilIdle(eng1, 2000);
      assert.equal(eng1.won, true, '撤回抽拨片后重新抽开必须正常通关');
    }
    console.log('  ✅ 双核撤回与第 5 瓶位资格保留验证通过！');

    // 4. AC-06：纯粹解谜存档 Schema v2 合并规则（最高关、总通关、最佳用时取优、已读引导并集）
    console.log('▶ [AC-06] 验证纯粹解谜存档 Schema v2 与云端合并规则...');
    {
      const local = createDefaultSaveData();
      local.updatedAt = 1000;
      local.currentLevel = 5;
      local.maxClearedLevel = 4;
      local.totalClears = 8;
      local.winStreak = 3;
      local.bestTimeSecMap = { 1: 18, 2: 25 };
      local.seenGuides = ['prop_l2_undo_slot'];

      const remote = createDefaultSaveData();
      remote.updatedAt = 2000;
      remote.currentLevel = 7;
      remote.maxClearedLevel = 6;
      remote.totalClears = 6;
      remote.winStreak = 4;
      remote.bestTimeSecMap = { 1: 15, 3: 31 };
      remote.seenGuides = ['prop_l3_magnet'];

      const merged = mergeSaveData(local, remote);
      assert.equal(merged.schemaVersion, 2);
      assert.equal(merged.currentLevel, 7, '当前关卡应取双端最大值');
      assert.equal(merged.maxClearedLevel, 6, '最高通关数应取双端最大值');
      assert.equal(merged.totalClears, 8, '总通关次数应取双端最大值');
      assert.equal(merged.winStreak, 4, '连胜应取最新记录');
      assert.equal(merged.bestTimeSecMap[1], 15, '同关最佳用时应取更短记录');
      assert.equal(merged.bestTimeSecMap[2], 25);
      assert.equal(merged.bestTimeSecMap[3], 31);
      assert.deepEqual(
        merged.seenGuides.sort(),
        ['prop_l2_undo_slot', 'prop_l3_magnet'],
        '已读引导集合应取双端并集'
      );
    }
    console.log('  ✅ 存档 Schema v2 与双端合并验证通过！');

    // 5. AC-07：多机型胶囊安全避让与极简三钮顶栏 + 五段式高占比布局零重叠校验
    console.log('▶ [AC-07] 验证多机型微信右上角胶囊安全避让与极简三钮顶栏零重叠布局...');
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
      assert.equal(lay.activeSlotRects.length, 5, '必须具备 4+1 共 5 个接沙瓶位布局矩形');
      assert.ok(
        lay.chamberRect.y > lay.topHudY + lay.topHudH &&
          lay.chamberRect.y + lay.chamberRect.h <= lay.slotRowRect.y &&
          lay.slotRowRect.y + lay.slotRowRect.h <= lay.candidateAreaRect.y &&
          lay.candidateAreaRect.y + lay.candidateAreaRect.h <= lay.propRowRect.y,
        `${dev.name} 顶栏/沙盘/接沙槽/候选瓶区/道具栏发生纵向重叠！`
      );
    }
    console.log('  ✅ 多屏幕比例胶囊避让与极简三钮顶栏 + 五段式布局零重叠验证通过！');
    console.log('\n🎉 日系治愈极简丝带玻璃瓶版全量自动化验收标准 (AC-01 ~ AC-07) 全部通过！');
  } finally {
    await vite.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
