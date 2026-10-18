// ============================================================
// アセットパイプライン（名言の書 v2）
//   node scripts/build-assets.mjs [glb|rain|pages|all]
//
//   glb   : ../assets/book.glb → public/book.glb（Draco + テクスチャ1024・WebP）
//   rain  : ../assets/rain/study.mp3 → 30〜45秒のシームレスループを切り出し、
//           Opus(WebM) 64kbps + mp3 の2本を ../assets/rain/ に出す（ffmpeg 必須）
//   pages : ../assets/pages/*.jpg（1200x1600, 790枚）→ ../assets/pages-avif/*.avif
//           900x1200 / AVIF q52。時間がかかる（1時間前後）ので単独で回すこと。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');            // v2/
const ASSETS = path.resolve(ROOT, '..', 'assets');
const PUBLIC = path.join(ROOT, 'public');

const task = process.argv[2] || 'all';
const log = (...a) => console.log('[assets]', ...a);

// ------------------------------------------------------------ glb
async function buildGlb() {
  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const { draco, prune, dedup } = await import('@gltf-transform/functions');
  const draco3d = await import('draco3dgltf');
  const sharp = (await import('sharp')).default;

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });

  const src = path.join(ASSETS, 'book.glb');
  const dst = path.join(PUBLIC, 'book.glb');
  const doc = await io.read(src);
  await doc.transform(dedup(), prune());
  // テクスチャは自前の sharp で 1024 上限 + WebP に落とす
  // （@gltf-transform の textureCompress は同梱 vips と噛み合わず落ちるため使わない）
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    const before = img.byteLength;
    const buf = await sharp(Buffer.from(img))
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84 })
      .toBuffer();
    tex.setImage(new Uint8Array(buf)).setMimeType('image/webp');
    const name = tex.getName() || tex.getURI() || 'texture';
    log('  tex', name, (before / 1e6).toFixed(2) + 'MB →', (buf.length / 1e6).toFixed(2) + 'MB');
  }
  await doc.transform(draco({ method: 'edgebreaker' }));
  await io.write(dst, doc);
  log('glb', (fs.statSync(src).size / 1e6).toFixed(2) + 'MB', '→', (fs.statSync(dst).size / 1e6).toFixed(2) + 'MB');
}

// ------------------------------------------------------------ rain
// 環境音ループ。2026-09-08 から元の12分を丸ごと（Opus 40k ≈3.6MB / mp3 64k ≈5.8MB。preload=none で音が要る時だけ流し込み）
function buildRain() {
  const src = path.join(ASSETS, 'rain', 'study.mp3');
  if (!fs.existsSync(src)) { log('rain: 元ファイルが無い', src); return; }
  const outDir = path.join(ASSETS, 'rain');
  const START = 0, DUR = 720;                     // 2026-09-08 KEI「同じ所のループが気になる・10分は流れてほしい」→ 元の12分を丸ごと
  const wav = path.join(outDir, '_study-loop.wav');
  execFileSync('ffmpeg', ['-y', '-ss', String(START), '-t', String(DUR), '-i', src,
    '-af', 'afade=t=in:st=0:d=0.35,afade=t=out:st=' + (DUR - 0.35) + ':d=0.35', '-ac', '2', '-ar', '48000', wav], { stdio: 'ignore' });
  execFileSync('ffmpeg', ['-y', '-i', wav, '-c:a', 'libopus', '-b:a', '40k', '-vbr', 'on',
    path.join(outDir, 'study-loop.webm')], { stdio: 'ignore' });
  execFileSync('ffmpeg', ['-y', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '64k',
    path.join(outDir, 'study-loop.mp3')], { stdio: 'ignore' });
  fs.unlinkSync(wav);
  for (const f of ['study-loop.webm', 'study-loop.mp3']) {
    log('rain', f, (fs.statSync(path.join(outDir, f)).size / 1e6).toFixed(2) + 'MB');
  }
}

// ------------------------------------------------------------ pages
async function buildPages() {
  const sharp = (await import('sharp')).default;
  const inDir = path.join(ASSETS, 'pages');
  const outDir = path.join(ASSETS, 'pages-avif');
  fs.mkdirSync(outDir, { recursive: true });
  const files = fs.readdirSync(inDir).filter(f => /\.jpg$/i.test(f));
  let done = 0, saved = 0;
  const CONC = 4;
  const queue = files.slice();
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (queue.length) {
      const f = queue.pop();
      const out = path.join(outDir, f.replace(/\.jpg$/i, '.avif'));
      if (!fs.existsSync(out)) {
        await sharp(path.join(inDir, f)).resize(900, 1200, { fit: 'inside' }).avif({ quality: 52, effort: 4 }).toFile(out);
      }
      saved += fs.statSync(out).size;
      if (++done % 50 === 0) log('pages', done + '/' + files.length);
    }
  }));
  log('pages done', done, (saved / 1e6).toFixed(1) + 'MB');
}

// ------------------------------------------------------------ ui（枠素材と表紙の法線マップを軽くする）
async function buildUi() {
  const sharp = (await import('sharp')).default;
  const jobs = [
    // 9スライスの枠。border-image は 92px のスライスを使うので寸法は変えない。
    { src: path.join(ASSETS, 'ui2', 'panel.png'), dst: path.join(ASSETS, 'ui2', 'panel.webp'), w: null, q: 82 },
    // 表紙の法線マップ。1024 あれば足りる（表示は最大でも画面の半分）。
    { src: path.join(ASSETS, 'cover-normal.jpg'), dst: path.join(ASSETS, 'cover-normal.webp'), w: 1024, q: 76 },
  ];
  for (const j of jobs) {
    if (!fs.existsSync(j.src)) { log('ui: 元ファイルが無い', j.src); continue; }
    let im = sharp(j.src);
    if (j.w) im = im.resize(j.w, j.w, { fit: 'inside', withoutEnlargement: true });
    await im.webp({ quality: j.q }).toFile(j.dst);
    log('ui', path.basename(j.src), (fs.statSync(j.src).size / 1e3).toFixed(0) + 'KB →',
      path.basename(j.dst), (fs.statSync(j.dst).size / 1e3).toFixed(0) + 'KB');
  }
}

// ------------------------------------------------------------ pbr（2026-10-19 試作版 beta・fx 'pbr'）
// ambientCG（CC0）の 1K JPG を展開したフォルダから、3Dの本の革と小口の地図を作る。
//   node scripts/build-assets.mjs pbr <展開先フォルダ>（中に Leather037/ Paper005/ がある）
//   出力 ../assets/pbr/:
//     cover-normal-pbr.webp : 既存 cover-normal（目の型押し）に Leather037 の革目を 3 回繰り返して重ねる（whiteout 合成）
//     cover-rough-pbr.webp  : 既存 cover-rough × (0.80 + 0.20 × 革の roughness)＝擦れた所だけわずかに艶
//     edge-normal.webp      : 小口。V 方向に 1 枚ずつ紙の重なり（行ごとの高さの揺らぎ）＋ Paper005 の凹凸を薄く
//     paper-normal.webp     : Paper005 の NormalGL を 1024 webp に（紙束の上面）
async function buildPbr() {
  const sharp = (await import('sharp')).default;
  const src = process.argv[3];
  if (!src || !fs.existsSync(src)) { log('pbr: 展開先フォルダを指定する', src); return; }
  const out = path.join(ASSETS, 'pbr'); fs.mkdirSync(out, { recursive: true });
  const raw = async (file, w, h) => (await sharp(file).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })).data;
  const tile = async (file, w, h, rep) => {          // rep 回繰り返した w×h
    const tw = Math.round(w / rep), th = Math.round(h / rep);
    const one = await sharp(file).resize(tw, th, { fit: 'fill' }).removeAlpha().toBuffer();
    const comp = [];
    for (let y = 0; y < h; y += th) for (let x = 0; x < w; x += tw) comp.push({ input: one, left: x, top: y });
    return (await sharp({ create: { width: w, height: h, channels: 3, background: '#000' } }).composite(comp).raw().toBuffer({ resolveWithObject: true })).data;
  };
  const W = 768, H = 1024;                          // 既存の表紙地図と同じ縦横比
  const L = path.join(src, 'Leather037', 'Leather037_1K-JPG_');
  const P = path.join(src, 'Paper005', 'Paper005_1K-JPG_');
  // 表紙の法線：whiteout 合成 n = normalize(a.xy + b.xy, a.z * b.z)
  const cn = await raw(path.join(ASSETS, 'cover-normal.webp'), W, H);
  const ln = await tile(L + 'NormalGL.jpg', W, H, 3);
  const nOut = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    const ax = cn[i*3]/127.5-1, ay = cn[i*3+1]/127.5-1, az = cn[i*3+2]/127.5-1;
    const bx = (ln[i*3]/127.5-1)*0.9, by = (ln[i*3+1]/127.5-1)*0.9, bz = ln[i*3+2]/127.5-1;
    let x = ax + bx, y = ay + by, z = az * bz; const d = Math.hypot(x, y, z) || 1; x /= d; y /= d; z /= d;
    nOut[i*3] = Math.round((x+1)*127.5); nOut[i*3+1] = Math.round((y+1)*127.5); nOut[i*3+2] = Math.round((z+1)*127.5);
  }
  await sharp(nOut, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: 90 }).toFile(path.join(out, 'cover-normal-pbr.webp'));
  // 表紙の roughness
  const cr = await raw(path.join(ASSETS, 'cover-rough.jpg'), W, H);
  const lr = await tile(L + 'Roughness.jpg', W, H, 3);
  const rOut = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H * 3; i++) rOut[i] = Math.round(cr[i] * (0.80 + 0.20 * lr[i] / 255));
  await sharp(rOut, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: 88 }).toFile(path.join(out, 'cover-rough-pbr.webp'));
  // 小口：行ごとの高さ（紙1枚ずつの重なり）→ 法線。U に沿って筋、V 方向に細かく
  const EW = 1024, EH = 1024;
  const pd = await raw(P + 'Displacement.jpg', EW, EH);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // 1枚＝2px（紙と隙間）＋ 折丁（約24枚の束）ごとの段差。遠目でミップが筋を均しても束の段差は残る
  const rowH = new Float32Array(EH); { let v = 0.5, b = 0, nb = 0; for (let y = 0; y < EH; y++) { if (y % 2 === 0) v = 0.25 + rnd() * 0.75; if (y >= nb) { b = rnd(); nb = y + 36 + Math.floor(rnd() * 28); } rowH[y] = ((y % 2 === 1) ? v * 0.35 : v) * 0.6 + b * 0.9 + (y < nb - 2 ? 0 : -0.6); } }
  const hgt = new Float32Array(EW * EH);
  for (let y = 0; y < EH; y++) for (let x = 0; x < EW; x++) hgt[y*EW+x] = rowH[y] + (pd[(y*EW+x)*3] / 255 - 0.5) * 0.35;
  const eOut = Buffer.alloc(EW * EH * 3), S = 2.2;
  for (let y = 0; y < EH; y++) for (let x = 0; x < EW; x++) {
    const hx = hgt[y*EW+((x+1)%EW)] - hgt[y*EW+((x-1+EW)%EW)];
    const hy = hgt[((y+1)%EH)*EW+x] - hgt[((y-1+EH)%EH)*EW+x];
    let nx = -hx * S, ny = hy * S, nz = 1; const d = Math.hypot(nx, ny, nz); nx /= d; ny /= d; nz /= d;
    const i = (y*EW+x)*3; eOut[i] = Math.round((nx+1)*127.5); eOut[i+1] = Math.round((ny+1)*127.5); eOut[i+2] = Math.round((nz+1)*127.5);
  }
  await sharp(eOut, { raw: { width: EW, height: EH, channels: 3 } }).webp({ quality: 90 }).toFile(path.join(out, 'edge-normal.webp'));
  await sharp(P + 'NormalGL.jpg').resize(1024, 1024, { fit: 'inside' }).webp({ quality: 88 }).toFile(path.join(out, 'paper-normal.webp'));
  for (const f of fs.readdirSync(out)) log('pbr', f, (fs.statSync(path.join(out, f)).size / 1e3).toFixed(0) + 'KB');
}

if (task === 'pbr') await buildPbr();
if (task === 'ui' || task === 'all') await buildUi();
if (task === 'glb' || task === 'all') await buildGlb();
if (task === 'rain' || task === 'all') buildRain();
if (task === 'pages') await buildPages();
