import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// 名言の書 v2
//  - ソース: v2/  → ビルド出力: ../app2/（コミットして GitHub Pages で公開）
//  - 試作版URL: https://isekai-no-eichi.github.io/meigen-no-sho-beta/app2/（2026-10-19 beta 複製）
//  - 本番URL: https://isekai-no-eichi.github.io/meigen-no-sho/app2/（2026-09-17 リポジトリ名変更・旧 page-flip-proto）
//  - three.js は npm から自ホスト（CDN依存ゼロ）
//  - 名言画像や glb は リポジトリ直下 assets/ をそのまま参照する（バンドルしない）
export default defineConfig({
  base: '/meigen-no-sho-beta/app2/',
  build: {
    outDir: '../app2',
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: false,               // public/manifest.webmanifest（現行 app/ の名前・アイコンを流用）を使う
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
        navigateFallback: null,
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            // 名言ページ（AVIF / JPG）。読んだ順に最大150枚まで残す
            urlPattern: /\/assets\/pages(-avif)?\/.*\.(avif|jpg)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'beta-pages-v1',
              expiration: { maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // 本体・音・テクスチャ
            urlPattern: /(\/assets\/(book\.glb|.*\.(jpg|png|webp|mp3|webm))|\/book\.glb|\/draco\/.*)(\?.*)?$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'beta-shell-assets-v2',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
