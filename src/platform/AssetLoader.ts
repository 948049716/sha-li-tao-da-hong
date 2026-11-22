import promptsData from '../../data/art/prompts.json';
import type { SpriteProvider } from '../engine/SandRenderer';
import type { IPlatformBridge } from './PlatformBridge';

interface ArtEntry {
  assetId: string;
  category: string;
  output: string;
}

/**
 * 极简轻量化美术资产加载器 + 离屏 Multiply 程序着色缓存
 * 全部核心局内素材直驻主包（< 0.9 MB），零二级分包等待，秒开直入关卡
 */
export class AssetLoader implements SpriteProvider {
  private platform: IPlatformBridge;
  private catalog = new Map<string, ArtEntry>();
  private images = new Map<string, HTMLImageElement>();
  private loading = new Map<string, Promise<HTMLImageElement | null>>();
  private tintCache = new Map<string, HTMLCanvasElement>();

  constructor(platform: IPlatformBridge) {
    this.platform = platform;
    for (const item of promptsData.assets as ArtEntry[]) {
      this.catalog.set(item.assetId, item);
    }
  }

  private resolveAssetUrl(entry: ArtEntry): string {
    return this.platform.isWeChat ? entry.output : `/${entry.output}`;
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
   * 首屏预加载全部核心局内资产（进度回调 0..1），确保 < 1s 秒进当前关卡
   */
  public async preloadCoreAssets(onProgress?: (ratio: number) => void): Promise<void> {
    const coreIds = [...this.catalog.keys()];
    let done = 0;
    await Promise.all(
      coreIds.map(async id => {
        await this.loadOne(id);
        done++;
        onProgress?.(done / Math.max(1, coreIds.length));
      })
    );
  }

  public get(assetId: string): HTMLImageElement | null {
    const existing = this.images.get(assetId);
    if (existing) return existing;
    if (!this.catalog.has(assetId)) return null;
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

    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = hexColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    this.tintCache.set(key, canvas);
    return canvas;
  }
}
