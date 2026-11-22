/**
 * 零 GC 粒子与吸沙飞线对象池（上限 120 颗，低帧率自适应折半至 60 颗）
 * 严格遵循《UI/UX 交互与视听资产规范》§3.3
 */
export type ParticleKind =
  | 'suction_line'
  | 'ice_shard'
  | 'star_sparkle'
  | 'confetti'
  | 'wood_dust';

const MAX_POOL = 120;

export class ParticleSystem {
  private active = new Uint8Array(MAX_POOL);
  private kind = new Uint8Array(MAX_POOL); // 0..4
  private x = new Float32Array(MAX_POOL);
  private y = new Float32Array(MAX_POOL);
  private vx = new Float32Array(MAX_POOL);
  private vy = new Float32Array(MAX_POOL);
  private tx = new Float32Array(MAX_POOL); // 贝塞尔目标 x
  private ty = new Float32Array(MAX_POOL); // 贝塞尔目标 y
  private life = new Float32Array(MAX_POOL);
  private maxLife = new Float32Array(MAX_POOL);
  private size = new Float32Array(MAX_POOL);
  private rot = new Float32Array(MAX_POOL);
  private colors: string[] = new Array(MAX_POOL).fill('#FFB81C');

  private cursor = 0;
  private lowPerfMode = false;
  private slowFrameStreak = 0;

  public clear(): void {
    this.active.fill(0);
  }

  public reportFrameTime(dtMs: number): void {
    if (dtMs > 20) {
      this.slowFrameStreak++;
      if (this.slowFrameStreak >= 30) {
        this.lowPerfMode = true;
      }
    } else {
      this.slowFrameStreak = Math.max(0, this.slowFrameStreak - 1);
      if (this.slowFrameStreak === 0) {
        this.lowPerfMode = false;
      }
    }
  }

  private alloc(): number {
    const cap = this.lowPerfMode ? 60 : MAX_POOL;
    for (let k = 0; k < cap; k++) {
      const idx = (this.cursor + k) % cap;
      if (!this.active[idx]) {
        this.cursor = (idx + 1) % cap;
        this.active[idx] = 1;
        return idx;
      }
    }
    const idx = this.cursor % cap;
    this.cursor = (idx + 1) % cap;
    this.active[idx] = 1;
    return idx;
  }

  public spawnSuctionStream(
    sx: number,
    sy: number,
    tx: number,
    ty: number,
    colorHex: string,
    rainbowMode: boolean,
    frameCount: number
  ): void {
    const idx = this.alloc();
    this.kind[idx] = 0;
    this.x[idx] = sx + (Math.random() - 0.5) * 6;
    this.y[idx] = sy;
    this.tx[idx] = tx + (Math.random() - 0.5) * 9;
    this.ty[idx] = ty + (Math.random() - 0.5) * 2.5;
    this.vx[idx] = (Math.random() - 0.5) * 10;
    this.vy[idx] = 8 + Math.random() * 14;
    this.life[idx] = 0;
    this.maxLife[idx] = 0.22 + Math.random() * 0.08;
    this.size[idx] = rainbowMode ? 1.9 : 1.15 + Math.random() * 0.75;
    if (rainbowMode) {
      const hue = (frameCount * 6 + idx * 30) % 360;
      this.colors[idx] = `hsl(${hue}, 86%, 72%)`;
    } else {
      this.colors[idx] = colorHex;
    }
  }

  public spawnIceShatter(cx: number, cy: number): void {
    const count = this.lowPerfMode ? 9 : 18;
    for (let i = 0; i < count; i++) {
      const idx = this.alloc();
      const angle = -Math.PI * (0.1 + 0.8 * Math.random());
      const speed = 75 + Math.random() * 130;
      this.kind[idx] = 1;
      this.x[idx] = cx + (Math.random() - 0.5) * 26;
      this.y[idx] = cy + (Math.random() - 0.5) * 8;
      this.vx[idx] = Math.cos(angle) * speed;
      this.vy[idx] = Math.sin(angle) * speed;
      this.life[idx] = 0;
      this.maxLife[idx] = 0.34 + Math.random() * 0.16;
      this.size[idx] = 3.5 + Math.random() * 3.5;
      this.rot[idx] = Math.random() * Math.PI * 2;
      this.colors[idx] = i % 2 === 0 ? '#E0F2FE' : '#7DD3FC';
    }
  }

  public spawnStarBurst(cx: number, cy: number, colorHex: string, count = 6): void {
    const n = this.lowPerfMode ? Math.ceil(count / 2) : count;
    for (let i = 0; i < n; i++) {
      const idx = this.alloc();
      const angle = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const speed = 45 + Math.random() * 85;
      this.kind[idx] = 2;
      this.x[idx] = cx;
      this.y[idx] = cy;
      this.vx[idx] = Math.cos(angle) * speed;
      this.vy[idx] = Math.sin(angle) * speed - 20;
      this.life[idx] = 0;
      this.maxLife[idx] = 0.38 + Math.random() * 0.18;
      this.size[idx] = 4 + Math.random() * 3;
      this.rot[idx] = 0;
      this.colors[idx] = i % 3 === 0 ? '#FFFBEB' : colorHex;
    }
  }

  public spawnRedJackpotConfetti(screenW: number, screenH: number): void {
    const n = this.lowPerfMode ? 22 : 45;
    const palette = ['#EF4444', '#FBBF24', '#F59E0B', '#FFFBEB', '#FB7185'];
    for (let i = 0; i < n; i++) {
      const idx = this.alloc();
      this.kind[idx] = 3;
      this.x[idx] = Math.random() * screenW;
      this.y[idx] = screenH * 0.15 + (Math.random() - 0.5) * 100;
      this.vx[idx] = (Math.random() - 0.5) * 140;
      this.vy[idx] = -60 + Math.random() * 190;
      this.life[idx] = 0;
      this.maxLife[idx] = 1.2 + Math.random() * 1.1;
      this.size[idx] = 5 + Math.random() * 5;
      this.rot[idx] = Math.random() * Math.PI * 2;
      this.colors[idx] = palette[i % palette.length];
    }
  }

  public update(dtSec: number): void {
    for (let i = 0; i < MAX_POOL; i++) {
      if (!this.active[i]) continue;
      this.life[i] += dtSec;
      if (this.life[i] >= this.maxLife[i]) {
        this.active[i] = 0;
        continue;
      }
      const k = this.kind[i];
      if (k === 1 || k === 3) {
        this.x[i] += this.vx[i] * dtSec;
        this.y[i] += this.vy[i] * dtSec;
        this.vy[i] += (k === 1 ? 460 : 180) * dtSec;
        this.rot[i] += 5 * dtSec;
      } else if (k === 2 || k === 4) {
        this.x[i] += this.vx[i] * dtSec;
        this.y[i] += this.vy[i] * dtSec;
        this.vx[i] *= 0.94;
        this.vy[i] *= 0.94;
      }
    }
  }

  public render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (let i = 0; i < MAX_POOL; i++) {
      if (!this.active[i]) continue;
      const t = this.life[i] / this.maxLife[i];
      const alpha = Math.max(0, 1 - t * t);
      const k = this.kind[i];

      if (k === 0) {
        // 绘本圆润飞砂颗粒（沿重力 S 曲线落入桶口并在末端微溅）
        const sx = this.x[i];
        const sy = this.y[i];
        const ex = this.tx[i];
        const ey = this.ty[i];
        const c1x = sx + this.vx[i] * 0.35;
        const c1y = sy + (ey - sy) * 0.45 + this.vy[i] * 0.4;
        const c2x = ex - this.vx[i] * 0.25;
        const c2y = ey - Math.max(10, (ey - sy) * 0.25);
        const u = 1 - t;
        const px =
          u * u * u * sx +
          3 * u * u * t * c1x +
          3 * u * t * t * c2x +
          t * t * t * ex;
        const py =
          u * u * u * sy +
          3 * u * u * t * c1y +
          3 * u * t * t * c2y +
          t * t * t * ey;
        const r = this.size[i] * (0.85 + 0.25 * (1 - t));

        ctx.globalAlpha = Math.min(0.92, alpha + 0.12);
        ctx.fillStyle = this.colors[i];
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (k === 2) {
        // 四角星芒
        const r = this.size[i] * (1 - 0.3 * t);
        const px = this.x[i];
        const py = this.y[i];
        ctx.globalAlpha = alpha;
        ctx.fillStyle = this.colors[i];
        ctx.beginPath();
        ctx.moveTo(px, py - r * 1.4);
        ctx.quadraticCurveTo(px, py, px + r * 1.4, py);
        ctx.quadraticCurveTo(px, py, px, py + r * 1.4);
        ctx.quadraticCurveTo(px, py, px - r * 1.4, py);
        ctx.quadraticCurveTo(px, py, px, py - r * 1.4);
        ctx.fill();
      } else {
        // 冰碴棱块 / 庆典彩纸
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(this.x[i], this.y[i]);
        ctx.rotate(this.rot[i]);
        ctx.fillStyle = this.colors[i];
        const s = this.size[i];
        ctx.fillRect(-s * 0.6, -s * 0.4, s * 1.2, s * 0.8);
        ctx.strokeStyle = '#5A3A22';
        ctx.lineWidth = 1;
        ctx.strokeRect(-s * 0.6, -s * 0.4, s * 1.2, s * 0.8);
        ctx.restore();
      }
    }
    ctx.restore();
  }
}
