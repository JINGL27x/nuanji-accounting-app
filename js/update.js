// 应用内更新：比对站点上的 version.json；有新版本就给按钮亮红点，点一下在 App 内下载并调起安装。
// 网页版（浏览器打开）没有安装能力，只提供下载链接。
// 依赖原生桥 AndroidSpeech.appInfo() / downloadAndInstall(url)（App v3.3+ 才有）。

const VERSION_URL = 'version.json';

export const APP = (() => {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  // 苹果设备：iPhone / iPad / iPod；iPadOS 13+ 的 UA 伪装成 Mac，靠触点数认出来
  const ios = /iPhone|iPad|iPod/.test(ua)
    || (/Macintosh/.test(ua) && (typeof navigator !== 'undefined' && (navigator.maxTouchPoints || 0) > 1));
  // 从主屏幕图标启动（iOS 专属字段 window.navigator.standalone）
  const standalone = ios
    ? (typeof navigator !== 'undefined' && (navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches))
    : false;
  let info = null;
  try {
    if (window.AndroidSpeech && window.AndroidSpeech.appInfo) {
      info = JSON.parse(window.AndroidSpeech.appInfo());
    }
  } catch (_) { info = null; }
  const inApp = !!(info && info.inApp) || /NuanjiApp\//.test(ua);
  const m = /NuanjiApp\/([\d.]+)/.exec(ua);
  return {
    ios,
    standalone,
    inApp,
    vc: info && info.vc != null ? Number(info.vc) : null,
    vn: (info && info.vn) || (m ? m[1] : null),
    // 苹果上永远装不了安卓 APK（苹果不允许侧载）
    canInstallApk: !ios && !!(window.AndroidSpeech && window.AndroidSpeech.downloadAndInstall),
  };
})();

let remote = null;          // 远端 version.json
let checking = false;
const listeners = [];

export function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }
function emit() { listeners.forEach((f) => { try { f(); } catch (_) { } }); }

export function currentVersionText() {
  if (APP.vn) return 'v' + APP.vn;
  if (APP.inApp) return '未知';
  return APP.ios ? '网页版（iPhone 自动更新）' : '网页版';
}

export function latest() { return remote; }

/** 语义化版本比较：a 是否比 b 新 */
function newerThan(a, b) {
  const pa = String(a || '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').split('.').map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function hasUpdate() {
  // iPhone / iPad 走的就是网页版，页面上永远是最新版，不存在「升级」这件事
  if (APP.ios) return false;
  if (!remote) return false;
  // 首选 versionCode 精确比较
  if (APP.vc != null && remote.versionCode != null) return Number(remote.versionCode) > APP.vc;
  // 老版本 App 没有 appInfo()，退回用 UA 里的版本号比较
  if (APP.vn && remote.versionName) return newerThan(remote.versionName, APP.vn);
  return false;
}

export function updateNotes() {
  if (!remote) return '';
  const parts = [];
  if (remote.versionName) parts.push('新版本 v' + remote.versionName);
  if (remote.size) parts.push('大小约 ' + (remote.size / 1048576).toFixed(1) + ' MB');
  if (remote.notes) parts.push(remote.notes);
  return parts.join('\n');
}

/** 拉取站点上的 version.json */
export async function checkUpdate() {
  if (checking) return { ok: false, busy: true };
  checking = true;
  try {
    const res = await fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    remote = await res.json();
  } catch (_) {
    remote = null;
    checking = false;
    emit();
    return { ok: false, error: '网络不通，稍后再试' };
  }
  checking = false;
  emit();
  return { ok: true, update: hasUpdate() };
}

/** 开始更新：App 内下载并调起安装；网页版只能跳转下载；过老的 App 需手动装一次 */
export function startUpdate() {
  // 兜底：苹果设备绝不引导去下载 .apk（装了也打不开，白下载 25MB）
  if (APP.ios) return 'ios';
  if (!remote || !remote.apk) return 'none';
  if (APP.canInstallApk) {
    window.AndroidSpeech.downloadAndInstall(remote.apk, remote.sha256 || '');
    return 'app';
  }
  if (APP.inApp) return 'old-app';
  window.open(remote.apk, '_blank');
  return 'browser';
}

export function apkUrl() { return remote ? remote.apk : ''; }

// ---- 原生回调挂载 ----
if (typeof window !== 'undefined') {
  window.__nuanjiUpd = {
    onProgress(pct) { progressCb && progressCb(pct); },
    onDone() { doneCb && doneCb(); },
    onError(msg) { errorCb && errorCb(msg); },
  };
}
let progressCb = null, doneCb = null, errorCb = null;
export function onInstallProgress(fn) { progressCb = fn; }
export function onInstallDone(fn) { doneCb = fn; }
export function onInstallError(fn) { errorCb = fn; }
