import promptsData from '../../data/art/prompts.json';
import type { SpriteProvider } from '../engine/SandRenderer';
import type { IPlatformBridge } from './PlatformBridge';

interface ArtEntry {
  assetId: string;
  category: string;
  output: string;
}

const SUBPACKAGE_FIGURINE_BG_IDS = new Set([
  'ui_bg_appraisal',
  'ui_bg_collection',
  'ui_bg_level_drawer',
  'ui_bg_share_poster',
]);

/**
 * 压缩美术资产加载器 + 离屏 Multiply 程序着色缓存 + 未解锁公仔星夜剪影缓存
 * 遵循《UI/UX交互与视听资产规范》§1.1 与《美术素材压缩与分包规范》
 */
export class AssetLoader implements SpriteProvider {
  private platform: IPlatformBridge;
  private catalog = new Map<string, ArtEntry>();
  private images = new Map<string, HTMLImageElement>();
  private loading = new Map<string, Promise<HTMLImageElement | null>>();
  private tintCache = new Map<string, HTMLCanvasElement>();
  private silhouetteCache = new Map<string, HTMLCanvasElement>();
  private subpackageLoaded = false;

  constructor(platform: IPlatformBridge) {
    this.platform = platform;
    for (const item of promptsData.assets as ArtEntry[]) {
      this.catalog.set(item.assetId, item);
    }
  }

  private resolveAssetUrl(entry: ArtEntry): string {
    if (this.platform.isWeChat) {
      // 微信小游戏环境下，30 款公仔与 4 张次级背景放置在 subpackages/figurines/ 分包
      if (entry.category === 'figurine' || SUBPACKAGE_FIGURINE_BG_IDS.has(entry.assetId)) {
        const subRel = entry.output.replace(/^assets\//, 'subpackages/figurines/');
        return subRel;
      }
      return entry.output;
    }
    return `/${entry.output}`;
  }

  public loadOne(assetId: string): Promise<HTMLImageElement | null> {
    if (this.images.has(assetId)) {
      return Promise.resolve(this.images.get(assetId)!);
    }
    if (this.loading.has(assetId)) {
      return this.loading.get(assetId)!;
    }
    const entry = this.catalog.get(assetId);
    if (!entry) return Promise.resolve(null);

    const p = new Promise<HTMLImageElement | null>(resolve => {
      const img = this.platform.createImage();
      img.onload = () => {
        this.images.set(assetId, img);
        resolve(img);
      };
      img.onerror = () => {
        this.loading.delete(assetId);
        resolve(null);
      };
      img.src = this.resolveAssetUrl(entry);
    });
    this.loading.set(assetId, p);
    return p;
  }

  /**
   * 首屏预加载主包核心资产（进度回调 0..1），确保 <1.5s 秒进主菜单
   */
  public async preloadCoreAssets(onProgress?: (ratio: number) => void): Promise<void> {
    const coreIds: string[] = [];
    for (const entry of this.catalog.values()) {
      if (entry.category !== 'figurine' && !SUBPACKAGE_FIGURINE_BG_IDS.has(entry.assetId)) {
        coreIds.push(entry.assetId);
      }
    }
    let done = 0;
    await Promise.all(
      coreIds.map(async id => {
        await this.loadOne(id);
        done++;
        onProgress?.(done / Math.max(1, coreIds.length));
      })
    );
  }

  /**
   * 进入主菜单后后台静默加载公仔与次级背景分包
   */
  public async preloadSubpackageAssets(): Promise<void> {
    if (this.subpackageLoaded) return;
    const ok = await this.platform.loadSubpackage('figurines');
    if (!ok) return;
    this.subpackageLoaded = true;

    const subIds: string[] = [];
    for (const entry of this.catalog.values()) {
      if (entry.category === 'figurine' || SUBPACKAGE_FIGURINE_BG_IDS.has(entry.assetId)) {
        subIds.push(entry.assetId);
      }
    }
    await Promise.all(subIds.map(id => this.loadOne(id)));
  }

  public get(assetId: string): HTMLImageElement | null {
    const existing = this.images.get(assetId);
    if (existing) return existing;
    const entry = this.catalog.get(assetId);
    if (
      this.platform.isWeChat &&
      !this.subpackageLoaded &&
      entry &&
      (entry.category === 'figurine' || SUBPACKAGE_FIGURINE_BG_IDS.has(entry.assetId))
    ) {
      return null;
    }
    // 按需异步触发加载
    void this.loadOne(assetId);
    return null;
  }

  /**
   * 白底切图程序着色（离屏缓存，运行期 drawImage 零损耗）
   */
  public getTinted(assetId: string, hexColor: string): HTMLCanvasElement | null {
    const key = `${assetId}|${hexColor}`;
    const cached = this.tintCache.get(key);
    if (cached) return cached;

    const img = this.get(assetId);
    if (!img || !img.width || !img.height) return null;

    const canvas = this.platform.createOffscreenCanvas();
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    // 仅在原图像素上正片叠底着色，并恢复原始 Alpha 轮廓
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = hexColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    this.tintCache.set(key, canvas);
    return canvas;
  }

  /**
   * 未解锁公仔星夜深靛蓝剪影（#1E294B，保留角色轮廓神秘感）
   */
  public getSilhouette(assetId: string, silhouetteHex = '#1E294B'): HTMLCanvasElement | null {
    const key = `${assetId}|${silhouetteHex}`;
    const cached = this.silhouetteCache.get(key);
    if (cached) return cached;

    const img = this.get(assetId);
    if (!img || !img.width || !img.height) return null;

    const canvas = this.platform.createOffscreenCanvas();
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = silhouetteHex;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';

    this.silhouetteCache.set(key, canvas);
    return canvas;
  }
}
