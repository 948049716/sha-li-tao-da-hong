import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Vite 双端配置：
 * - 开发期直接映射仓库根目录下的 /assets 静态压缩图片与 JSON 数据源；
 * - 生产构建输出精简静态站点至 dist/，供预览或由 scripts/build-wx.mjs 进一步装配为微信小游戏包 dist-wx/。
 */
export default defineConfig({
  publicDir: false,
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
  plugins: [
    {
      name: 'serve-and-copy-compressed-assets',
      configureServer(server) {
        server.middlewares.use('/assets', (req, res, next) => {
          const cleanUrl = (req.url || '').split('?')[0];
          const filePath = path.join(process.cwd(), 'assets', cleanUrl);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            const mime =
              ext === '.png'
                ? 'image/png'
                : ext === '.webp'
                  ? 'image/webp'
                  : ext === '.jpg' || ext === '.jpeg'
                    ? 'image/jpeg'
                    : ext === '.mp3'
                      ? 'audio/mpeg'
                      : ext === '.json'
                        ? 'application/json'
                        : 'application/octet-stream';
            res.setHeader('Content-Type', mime);
            res.setHeader('Cache-Control', 'no-cache');
            fs.createReadStream(filePath).pipe(res);
            return;
          }
          next();
        });
      },
      closeBundle() {
        const srcAssets = path.join(process.cwd(), 'assets');
        const dstAssets = path.join(process.cwd(), 'dist', 'assets');
        if (fs.existsSync(srcAssets)) {
          fs.cpSync(srcAssets, dstAssets, { recursive: true });
        }
      },
    },
  ],
});
