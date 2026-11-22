/**
 * iOS / Android 微信小游戏 Canvas 2D 与高精度计时器跨端兼容垫片
 * 修复 iOS 微信小游戏（JavaScriptCore + Ejecta/Skia 2D Context）缺失 ctx.roundRect 与 globalThis.performance 的问题
 */

type RoundRectRadius = number | { tl?: number; tr?: number; br?: number; bl?: number } | number[];

export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radii?: RoundRectRadius
): void {
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }

  let r = 0;
  if (typeof radii === 'number') {
    r = radii;
  } else if (Array.isArray(radii)) {
    r = radii.length > 0 ? Number(radii[0]) || 0 : 0;
  } else if (radii && typeof radii === 'object') {
    r = Number(radii.tl ?? 0) || 0;
  }

  const clamped = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
  if (clamped <= 0.01 || w <= 0 || h <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }

  ctx.moveTo(x + clamped, y);
  ctx.arcTo(x + w, y, x + w, y + h, clamped);
  ctx.arcTo(x + w, y + h, x, y + h, clamped);
  ctx.arcTo(x, y + h, x, y, clamped);
  ctx.arcTo(x, y, x + w, y, clamped);
  ctx.closePath();
}

export function polyfillRoundRectImpl(
  this: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radii?: RoundRectRadius
): void {
  roundRectPath(this, x, y, w, h, radii);
}

export function ensureRoundRect(ctx: CanvasRenderingContext2D | null | undefined): void {
  if (
    typeof CanvasRenderingContext2D !== 'undefined' &&
    CanvasRenderingContext2D.prototype &&
    typeof CanvasRenderingContext2D.prototype.roundRect !== 'function'
  ) {
    try {
      (CanvasRenderingContext2D.prototype as unknown as { roundRect: typeof polyfillRoundRectImpl }).roundRect =
        polyfillRoundRectImpl;
    } catch {
      // ignore frozen prototype
    }
  }

  if (!ctx) return;
  if (typeof (ctx as unknown as { roundRect?: unknown }).roundRect !== 'function') {
    try {
      const proto = Object.getPrototypeOf(ctx);
      if (proto && typeof proto.roundRect !== 'function') {
        proto.roundRect = polyfillRoundRectImpl;
      }
    } catch {
      // ignore prototype assignment failure on host object
    }
    try {
      (ctx as unknown as { roundRect: typeof polyfillRoundRectImpl }).roundRect = polyfillRoundRectImpl;
    } catch {
      // ignore read-only host object
    }
  }
}

export function wrapCanvasWithPolyfill<T extends HTMLCanvasElement>(canvas: T): T {
  const rawGetContext = canvas.getContext?.bind(canvas);
  if (rawGetContext && !(canvas as unknown as { __rrWrapped?: boolean }).__rrWrapped) {
    try {
      (canvas as unknown as { __rrWrapped?: boolean }).__rrWrapped = true;
      canvas.getContext = ((contextId: string, options?: unknown) => {
        const ctx = rawGetContext(contextId as '2d', options as CanvasRenderingContext2DSettings);
        if (contextId === '2d' && ctx) {
          ensureRoundRect(ctx as CanvasRenderingContext2D);
        }
        return ctx;
      }) as typeof canvas.getContext;
    } catch {
      // If canvas.getContext is non-writable on host object, callers still call ensureRoundRect(ctx)
    }
  }
  return canvas;
}

export function safeNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}
