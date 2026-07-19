/* ═══════════════════════════════════════════════════════
   GLOBAL STATE & CORE UTILS (全局状态与核心工具)
═══════════════════════════════════════════════════════ */
let DB = {
  items: [], categories: [], accounts: [], trash: [], recent: [],
  settings: {
    blockMainland: true, thumbSize: 180, nineCols: '4', nineRatio: '1/1',
    theme: 'auto', pin: ''
  },
  version: '1.3'
};

/* ═══════════════════════════════════════════════════════
   APP CONFIG (版本与远程更新配置)
═══════════════════════════════════════════════════════ */
const APP_VERSION = '1.3';
// ⬇ 填入你的 GitHub 用户名/仓库名，例如 'buku-lhy/cailiao-ku'
const GITHUB_REPO = 'secure-artifacts/Reference-Material-Library';

// ==== 素材分享服务 (Cloudflare Workers + D1 + Backblaze B2) 对接配置 ====
const SHARE_API_BASE = 'https://material-share.lhy-material-lib.workers.dev';
const SHARE_UPLOAD_PATH = '/upload'; // ⚠️ 若后端实际路由不是 /upload（例如 /api/v1/upload），只需改这一行
const SHARE_ALBUM_PATH = '/api/album'; // 🆕 v1.3：多图相册分享接口，需后端配合新增（见设计文档）
const SHARE_ALBUM_CONCURRENCY = 3; // 🆕 v1.3：多图并发上传的最大并发数，避免一次性打满带宽/触发限流
const SHARE_REQUEST_KEY_PATH = '/request-key'; // 🆕 v1.3：自助申请上传密钥，免去线下私聊管理员要密钥的步骤

// 创作者工作台专属数据隔离池 (workspace.json)
let WS = {
  scripts: [], tasks: [], notes: [], intakes: [], weekly: {},
  order: ['scripts', 'tasks', 'notes', 'intakes', 'weekly'], collapsed: {}
};

let dirHandle = null;
window.blobCache = {}; // 内存 URL 对象缓存池，彻底避免 Base64 代码导致大屏卡顿

// 修复：blobCache 内存泄漏治理 —— 统一的 Object URL 释放入口
// 任何"永久性"丢弃某个 shot.id 对应的图片资源时都必须调用，避免 URL.createObjectURL 泄漏内存
function revokeShotBlob(id) {
  if (!id) return;
  const url = window.blobCache[id];
  if (url) { try { URL.revokeObjectURL(url); } catch(e) {} delete window.blobCache[id]; }
}
function revokeItemBlobs(item) {
  if (!item || !item.shots) return;
  item.shots.forEach(s => revokeShotBlob(s.id));
}
// 重新生成某 id 的 Object URL 前，先释放旧的引用，避免同一 id 反复覆盖造成的悬空泄漏
function setShotBlob(id, fileOrBlob) {
  revokeShotBlob(id);
  window.blobCache[id] = URL.createObjectURL(fileOrBlob);
  return window.blobCache[id];
}

let selectedId = null, currentFilter = { type: 'all' }, currentView = 'lib';
let saveTimer = null;
let editingItemId = null, formTags = [], ctxCatId = null, ctxCardId = null, ctxCardImgId = null;

// 高级交互与画廊多选缓存
let trashSelectedIds = new Set();
let galleryShots = [], galleryIndex = 0, currentNineGridItemId = null;
let shotNoteEditingCtx = null; // {itemId, shotId}
function openShotNoteModal(itemId, shotId) {
  const item = DB.items.find(i => i.id === itemId); if (!item) return;
  const shot = (item.shots || []).find(s => s.id === shotId); if (!shot) return;
  shotNoteEditingCtx = { itemId, shotId };
  if(document.getElementById('shot-note-textarea')) document.getElementById('shot-note-textarea').value = shot.note || '';
  if(document.getElementById('shot-note-modal')) document.getElementById('shot-note-modal').classList.add('show');
  setTimeout(() => { const ta = document.getElementById('shot-note-textarea'); if(ta) ta.focus(); }, 50);
}
function closeShotNoteModal() { if(document.getElementById('shot-note-modal')) document.getElementById('shot-note-modal').classList.remove('show'); shotNoteEditingCtx = null; }
function saveShotNoteModal() {
  if (!shotNoteEditingCtx) return;
  const item = DB.items.find(i => i.id === shotNoteEditingCtx.itemId); if (!item) return;
  const shot = (item.shots || []).find(s => s.id === shotNoteEditingCtx.shotId); if (!shot) return;
  const v = document.getElementById('shot-note-textarea') ? document.getElementById('shot-note-textarea').value : '';
  shot.note = v.trim();
  scheduleSave(); renderNineGrid();
  closeShotNoteModal();
  showToast('✅ 图片备注已保存');
}

let nineGridSelectedIds = new Set(), nineLastClickedIdx = -1;
let nineCtxCurrentIdx = -1; // 记录右键点击的是九宫格的哪张图

// 视觉颜色标签算法分配
const TAG_PALETTE = [
  ['#EAF3DE','#3B6D11'],['#FAEEDA','#854F0B'],['#E6F1FB','#185FA5'],
  ['#FBEAF0','#993556'],['#EEEDFE','#534AB7'],['#E5F8F1','#0D6E4A'],
  ['#FFF3E0','#7C4400'],['#F0F4FF','#2D3F8B']
];
let tagColorMap = {}, tagColorIdx = 0;
function tagColor(t) { if(!tagColorMap[t]) tagColorMap[t] = TAG_PALETTE[tagColorIdx++ % TAG_PALETTE.length]; return tagColorMap[t]; }
function tagHtml(t) { const [bg,fc] = tagColor(t); return `<span class="tag" style="background:${bg};color:${fc}">${t}</span>`; }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,5); }
function sanitizeName(n) { return (n||'未命名').replace(/[\\/:*?"<>|]/g, '_').slice(0, 30); }
function pad2(n) { return String(n).padStart(2,'0'); }
function dateStr8(ts) { const d = new Date(ts||Date.now()); return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`; }
// 生成可读的物理文件名：素材名_日期_序号.扩展名（新规则，替代原先纯随机 ID 命名）
function buildShotFileName(item, shot, seq) {
  return `${sanitizeName(item.title)}_${dateStr8(shot.addedAt)}_${pad2(seq)}.${shot.ext||'jpg'}`;
}
// 兼容旧数据：若 shot 尚未有可读文件名，则回退到旧的 id.ext 命名
function shotFileName(shot) { return shot.fileName || `${shot.id}.${shot.ext||'jpg'}`; }
// 回收站内文件始终使用 id 命名，避免不同素材间可读文件名重复冲突
function shotTrashFileName(shot) { return `${shot.id}.${shot.ext||'jpg'}`; }
// 目录/素材/分类命名重复检测
function isDuplicateCategoryName(name, excludeId) {
  const n = name.trim().toLowerCase();
  return DB.categories.some(c => c.id !== excludeId && c.name.trim().toLowerCase() === n);
}
function isDuplicateItemTitle(title, categoryId, excludeId) {
  const t = title.trim().toLowerCase();
  return DB.items.some(it => it.id !== excludeId && it.categoryId === categoryId && (it.title||'').trim().toLowerCase() === t);
}

// 全局微提示气泡
function showToast(msg, type='success', opts) {
  opts = opts || {};
  const severe = opts.severe === true || type === 'error'; // 🆕 v1.3：错误类默认视为严重提示，额外多停留 2 秒
  const duration = 2900 + (severe ? 2000 : 0);
  const c = document.getElementById('toast-container');
  // 🆕 v1.3：同时最多保留 4 条气泡，超出时把最旧的挤掉，避免连续报错时气泡无限堆叠
  const existing = c.querySelectorAll('.toast');
  if (existing.length >= 4) existing[0].remove();
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = `<i class="ti ${type==='error'?'ti-alert-circle':type==='warning'?'ti-alert-triangle':'ti-check'}"></i> ${msg}`;
  c.appendChild(t); setTimeout(()=>t.remove(), duration);
}

/* ═══════════════════════════════════════════════════════
   LINK PARSING & CORS HANDLING (外网智能提取解析)
═══════════════════════════════════════════════════════ */
const PLATFORMS = {
  facebook: { key:'FB', bg:'#DBEAFE', color:'#1E40AF', icon:'ti-brand-facebook' },
  instagram: { key:'IG', bg:'#FCE7F3', color:'#9D174D', icon:'ti-brand-instagram' },
  youtube: { key:'YT', bg:'#FEE2E2', color:'#991B1B', icon:'ti-brand-youtube' },
  pinterest: { key:'PIN', bg:'#FFE9EB', color:'#E60023', icon:'ti-brand-pinterest' },
  web: { key:'WEB', bg:'#F3F4F6', color:'#374151', icon:'ti-link' }
};

function isBlockedPlatform(s) {
  if (DB.settings && DB.settings.blockMainland === false) return false;
  return /tiktok\.com|vm\.tiktok|vt\.tiktok|douyin\.com|weibo\.com|bilibili\.com|b23\.tv|xiaohongshu\.com|xhslink\.com|kuaishou\.com|ixigua\.com/i.test(s);
}

function detectPlatform(url) {
  if (/facebook\.com|fb\.com|fb\.watch/i.test(url)) return PLATFORMS.facebook;
  if (/instagram\.com/i.test(url)) return PLATFORMS.instagram;
  if (/youtube\.com|youtu\.be/i.test(url)) return PLATFORMS.youtube;
  if (/pinterest\.com|pin\.it/i.test(url)) return PLATFORMS.pinterest;
  return PLATFORMS.web;
}

function isVideoLink(url) { 
  return /\/(reel|reels|watch|shorts|p)(\/|\?|$)/i.test(url) || /youtu\.be/i.test(url); 
}

// 从 FB 链接中提取页面 ID 或用户名（用于 Graph API 头像）
const FB_AVATAR_TOKEN = '2712477385668128|b429aeb53369951d411e1cae8e810640';
function extractFbPageId(url) {
  if (!/facebook\.com|fb\.com/i.test(url)) return null;
  // profile.php?id=123456
  const numM = url.match(/[?&]id=(\d+)/);
  if (numM) return numM[1];
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    const parts = u.pathname.split('/').filter(Boolean);
    const skip = new Set(['reel','reels','watch','shorts','videos','video','photos','photo','groups','events','pages','profile']);
    if (parts.length > 0 && !skip.has(parts[0])) return parts[0];
  } catch(e) {}
  return null;
}
function getFbAvatarUrl(fbId) {
  return `https://graph.facebook.com/${fbId}/picture?width=46&height=46&access_token=${FB_AVATAR_TOKEN}`;
}

function extractNameFromUrl(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://'+url);
    const parts = u.pathname.split('/').filter(Boolean);
    if(isVideoLink(url)) return parts[0] && !['reel','reels','watch','shorts','p'].includes(parts[0]) ? parts[0] : '关联视频源';
    return parts.pop() || u.hostname;
  } catch { return url; }
}

/* ═══════════════════════════════════════════════════════
   FILE SYSTEM ACCESS API (本地物理硬盘文件引擎)
═══════════════════════════════════════════════════════ */
// 利用底层 indexedDB 永久记忆用户授权过的盘符路径
const FsStore = {
  async init() { return new Promise(r => { const req = indexedDB.open('LHY_FS_V3', 1); req.onupgradeneeded = e => e.target.result.createObjectStore('kv'); req.onsuccess = e => r(e.target.result); }); },
  async get(k) { const db = await this.init(); return new Promise(r => { const req = db.transaction('kv','readonly').objectStore('kv').get(k); req.onsuccess = e => r(e.target.result); req.onerror = () => r(null); }); },
  async set(k, v) { const db = await this.init(); return new Promise(r => { const tx = db.transaction('kv','readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => r(); }); }
};

// 递归穿透读取目标物理文件夹
async function getDirHandleByPath(baseHandle, path, create = false) {
  let curr = baseHandle;
  for (const part of path.split('/').filter(Boolean)) { 
    try { curr = await curr.getDirectoryHandle(part, { create }); } 
    catch (e) { return null; } 
  }
  return curr;
}

// 基于素材名称和ID动态生成物理存储路径
function getItemFolderPath(item) {
  const cat = DB.categories.find(c => c.id === item.categoryId);
  return `素材截图/${sanitizeName(cat ? cat.name : '未分类')}/${sanitizeName(item.title)}_${item.id}`;
}

async function chooseFolder() {
  if (!('showDirectoryPicker' in window)) { showToast('当前浏览器内核过旧，不支持直接读写本地硬盘，请使用电脑端的 Chrome 或 Edge 浏览器', 'error'); return; }
  try {
    dirHandle = await window.showDirectoryPicker({ mode:'readwrite' });
    await FsStore.set('root_dir', dirHandle);
    await setupWorkspace();
    showToast('✅ 成功接管本地硬盘数据目录！', 'success');
  } catch(e) {}
}

async function setupWorkspace() {
  // 静默建立基建目录体系
  await getDirHandleByPath(dirHandle, '素材截图', true);
  await getDirHandleByPath(dirHandle, '已删除（回收站）', true);
  
  const fIcon = document.getElementById('folder-icon');
  if(fIcon) fIcon.className = 'ti ti-folder-check';
  const fText = document.getElementById('folder-status-text');
  if(fText) {
    fText.textContent = dirHandle.name;
    fText.style.color = 'var(--tx)';
  }
  
  const fBanner = document.getElementById('folder-banner');
  if(fBanner) fBanner.style.display = 'none';
  
  const setPath = document.getElementById('set-folder-path');
  if(setPath) setPath.textContent = dirHandle.name;
  
  await loadFromFolder();
  computeAndRenderDiskUsage(); // 🆕 v1.3：连接成功后异步统计一次本地占用空间，不阻塞主流程
}

// 🆕 v1.3：递归统计已连接文件夹的总占用空间，GB/MB 自动切换单位（不满 1GB 显示 MB）
function formatBytesAuto(bytes) {
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return gb.toFixed(2) + ' GB';
  const mb = bytes / (1024 ** 2);
  return mb.toFixed(1) + ' MB';
}
async function getDirSizeRecursive(handle) {
  let total = 0;
  for await (const entry of handle.values()) {
    if (entry.kind === 'file') {
      try { const f = await entry.getFile(); total += f.size; } catch (e) {}
    } else if (entry.kind === 'directory') {
      try { total += await getDirSizeRecursive(entry); } catch (e) {}
    }
  }
  return total;
}
let _diskUsageComputing = false;
async function computeAndRenderDiskUsage() {
  if (!dirHandle || _diskUsageComputing) return;
  _diskUsageComputing = true;
  const el = document.getElementById('disk-usage-text');
  if (el) el.textContent = '统计中...';
  try {
    const bytes = await getDirSizeRecursive(dirHandle);
    if (el) el.textContent = formatBytesAuto(bytes);
  } catch (e) {
    if (el) el.textContent = '统计失败';
  } finally {
    _diskUsageComputing = false;
  }
}

async function restoreFolderAccess() {
  const handle = await FsStore.get('root_dir');
  if (!handle) { showToast('未找到上次连接过的文件夹记录，请重新选择/连接文件夹', 'warning'); return; }
  try {
    const perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') { dirHandle = handle; await setupWorkspace(); }
    else { showToast('⚠️ 未获得文件夹访问授权，可能是在浏览器弹窗里点了拒绝，请重新点击"恢复连接"并在弹窗中选择允许', 'warning'); }
  } catch(e) {
    showToast('⚠️ 恢复连接失败，请尝试重新点击"选择/连接文件夹"手动连接', 'error');
  }
}

async function loadFromFolder() {
  try {
    const fh = await getDirHandleByPath(dirHandle, '', false);
    if (fh) {
      // 提取核心母库
      const dbFile = await fh.getFileHandle('database.json', { create: false }).catch(()=>null);
      if (dbFile) {
        try {
          DB = Object.assign(DB, JSON.parse(await (await dbFile.getFile()).text()));
        } catch(parseErr) {
          showToast('❌ 数据文件解析失败：database.json 格式异常或已损坏，素材可能显示不完整，请检查该文件或恢复备份', 'error');
        }
      }
      // 提取独立创作者工作台
      const wsFile = await fh.getFileHandle('workspace.json', { create: false }).catch(()=>null);
      if (wsFile) {
        try {
          WS = Object.assign(WS, JSON.parse(await (await wsFile.getFile()).text()));
        } catch(parseErr) {
          showToast('❌ 工作台数据文件解析失败：workspace.json 格式异常或已损坏', 'error');
        }
      }
    }
  } catch(e) { showToast('⚠️ 读取本地文件夹时发生异常，部分数据可能未能加载', 'error'); }
  
  // 安全阀保护：结构兼容性防崩溃补全
  if(!DB.accounts) DB.accounts = [];
  if(!DB.recent) DB.recent = [];
  if(!DB.trash || !Array.isArray(DB.trash)) DB.trash = [];
  if(!WS.order) WS.order = ['scripts', 'tasks', 'notes', 'intakes', 'weekly'];
  if(!WS.collapsed) WS.collapsed = {};

  await migrateLegacyBase64();
  await preloadImageBlobs();
  
  ensureDefaults(); applySettings();
  
  // 如果设定了密码，则显示锁屏，否则直接进入大库界面
  if (DB.settings.pin && DB.settings.pin.trim() !== '') { 
    if(document.getElementById('lock-screen')) document.getElementById('lock-screen').style.display = 'flex'; 
  } else { 
    switchView('lib'); 
  }
}

// 自动静默任务：清洗老 JSON 里的 Base64 图片残骸并写成硬盘上的真实 JPG
async function migrateLegacyBase64() {
  if (!dirHandle) return;
  let migrated = false;
  for (const item of DB.items) {
    if (!item.shots) continue;
    let itemDir = null;
    for (const shot of item.shots) {
      if (shot.dataUrl && shot.dataUrl.startsWith('data:image')) {
        if (!itemDir) itemDir = await getDirHandleByPath(dirHandle, getItemFolderPath(item), true);
        const match = /^data:(image\/\w+);base64,(.+)$/.exec(shot.dataUrl);
        if (match) {
          shot.ext = match[1].split('/')[1].replace('jpeg', 'jpg');
          const bytes = atob(match[2]); const array = new Uint8Array(bytes.length);
          for (let i=0; i<bytes.length; i++) array[i] = bytes.charCodeAt(i);
          try {
            const fh = await itemDir.getFileHandle(`${shot.id}.${shot.ext}`, { create: true });
            const w = await fh.createWritable(); await w.write(array); await w.close();
            setShotBlob(shot.id, new Blob([array], { type: match[1] }));
            delete shot.dataUrl; migrated = true;
          } catch(e) {}
        }
      }
    }
  }
  if (migrated) scheduleSave();
}

// 运行时性能优化：提取物理硬盘文件建立高速内存映射网（告别网页卡顿）
// 修复5：文件夹关联自愈 —— 素材改名后如果物理文件夹曾经因为旧版本逻辑未能同步改名，
// 这里按素材 id 后缀（文件夹命名规则固定为 "标题_id"，id 不会变）反向扫描分类目录找回文件夹，
// 找到后立即把物理文件夹改名为当前标题对应的规范路径，此后即可正常直接命中，无需再次扫描
async function findAndHealItemDir(item) {
  if (!dirHandle) return null;
  const cat = DB.categories.find(c => c.id === item.categoryId);
  const catPath = `素材截图/${sanitizeName(cat ? cat.name : '未分类')}`;
  const catDir = await getDirHandleByPath(dirHandle, catPath, false);
  if (!catDir) return null;
  const suffix = `_${item.id}`;
  try {
    for await (const [name, handle] of catDir.entries()) {
      if (handle.kind === 'directory' && name.endsWith(suffix)) {
        const canonicalName = `${sanitizeName(item.title)}_${item.id}`;
        if (name !== canonicalName) {
          const ok = await moveFs(dirHandle, `${catPath}/${name}`, `${catPath}/${canonicalName}`, false);
          if (ok) return await getDirHandleByPath(dirHandle, `${catPath}/${canonicalName}`, false);
        }
        return handle;
      }
    }
  } catch(e) {}
  return null;
}

async function preloadImageBlobs() {
  if (!dirHandle) return;
  
  // 1. 挂载主库图片
  for (const item of DB.items) {
    if (!item.shots) continue;
    let itemDir = await getDirHandleByPath(dirHandle, getItemFolderPath(item), false);
    if (!itemDir) itemDir = await findAndHealItemDir(item); // 精确路径找不到时，按 id 自动找回并修复
    if (itemDir) {
      for (const shot of item.shots) {
        if(shot.type==='reel') continue;
        try { setShotBlob(shot.id, await (await itemDir.getFileHandle(shotFileName(shot))).getFile()); }
        catch(e) {
          // 兼容回退：文件名可能仍是旧的 id.ext 命名
          try { setShotBlob(shot.id, await (await itemDir.getFileHandle(`${shot.id}.${shot.ext||'jpg'}`)).getFile()); } catch(e2) {}
        }
      }
    }
  }
  
  // 2. 挂载深渊回收站内的图片遗骸
  for (const t of DB.trash) {
    if (t.type === 'item' && t.data.shots) {
      const dir = await getDirHandleByPath(dirHandle, `已删除（回收站）/${sanitizeName(t.data.title)}_${t.data.id}`, false);
      if (dir) {
        for (const shot of t.data.shots) {
          if(shot.type==='reel') continue;
          try { setShotBlob(shot.id, await (await dir.getFileHandle(shotTrashFileName(shot))).getFile()); }
          catch(e) {
            try { setShotBlob(shot.id, await (await dir.getFileHandle(`${shot.id}.${shot.ext||'jpg'}`)).getFile()); } catch(e2) {}
          }
        }
      }
    } else if (t.type === 'shot' && t.data.type !== 'reel') {
      const tDir = await getDirHandleByPath(dirHandle, '已删除（回收站）', false);
      if (tDir) {
        try { setShotBlob(t.data.id, await (await tDir.getFileHandle(shotTrashFileName(t.data))).getFile()); }
        catch(e) {
          try { setShotBlob(t.data.id, await (await tDir.getFileHandle(`${t.data.id}.${t.data.ext||'jpg'}`)).getFile()); } catch(e2) {}
        }
      }
    }
  }
}

// 修复11：写入并发锁 —— 防止两次异步硬盘写入交叉执行导致"后写覆盖新数据"的竞态问题
// 原则：不阻塞用户操作/UI，只是把写入请求串行化排队，用户完全无感知
let isSaving = false;
let savePending = false;

// 核心主宰：将变更后的虚拟态数据写入硬盘固化
async function saveToFolder() {
  if (isSaving) { savePending = true; return; } // 已有写入在进行中，标记"待再次保存"后直接返回，不产生并发
  isSaving = true;
  try {
    await _doSaveToFolder();
  } finally {
    isSaving = false;
    if (savePending) { savePending = false; saveToFolder(); } // 写入期间又有新变更，自动补一次保存，确保最终一致
  }
}

async function _doSaveToFolder() {
  const dbClone = JSON.parse(JSON.stringify(DB));
  const wsClone = JSON.parse(JSON.stringify(WS));
  
  if (dirHandle) {
    // 数据剥离清洗：拒绝任何 Base64 代码潜入 JSON 造成大体积卡顿
    dbClone.items.forEach(it => (it.shots||[]).forEach(s => delete s.dataUrl));
    dbClone.trash.forEach(t => { 
      if(t.type === 'item') (t.data.shots||[]).forEach(s => delete s.dataUrl); 
      else if(t.type === 'shot') delete t.data.dataUrl; 
    });
    
    try {
      const fhDB = await dirHandle.getFileHandle('database.json', { create: true });
      const wDB = await fhDB.createWritable(); await wDB.write(JSON.stringify(dbClone, null, 2)); await wDB.close();
      
      const fhWS = await dirHandle.getFileHandle('workspace.json', { create: true });
      const wWS = await fhWS.createWritable(); await wWS.write(JSON.stringify(wsClone, null, 2)); await wWS.close();
      
      const st = document.getElementById('save-status');
      if(st) st.innerHTML = '<i class="ti ti-check"></i> 硬盘同步完成';
      return;
    } catch(e) { 
      const st = document.getElementById('save-status');
      if(st) st.innerHTML = '<i class="ti ti-alert-circle"></i> 硬盘写入遇阻'; 
    }
  }
  
  // 防御性保底机制（加 try/catch，避免 localStorage 配额超限时无声崩溃）
  try {
    localStorage.setItem('lhy_v1_db', JSON.stringify(dbClone));
    localStorage.setItem('lhy_v1_ws', JSON.stringify(wsClone));
    const st = document.getElementById('save-status');
    if(st) st.innerHTML = '<i class="ti ti-check"></i> 网页沙盒缓存中';
  } catch(e) {
    const st = document.getElementById('save-status');
    if(st) st.innerHTML = '<i class="ti ti-alert-circle"></i> 沙盒缓存容量已满';
    showToast('⚠️ 网页临时存储容量已满，建议尽快连接本地文件夹进行物理保存', 'error');
  }
}

function scheduleSave() {
  const st = document.getElementById('save-status');
  if(st) st.innerHTML = '<i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i> 同步深层存储...';
  clearTimeout(saveTimer); saveTimer = setTimeout(saveToFolder, 800);
}

// 物理引擎：文件搬运工 (用于目录重命名及移入/移出回收站)
async function moveFs(base, srcPath, destPath, isFile = false) {
  const sParts = srcPath.split('/'); const sName = sParts.pop();
  const sDir = await getDirHandleByPath(base, sParts.join('/'), false); if (!sDir) return false;
  const dParts = destPath.split('/'); const dName = dParts.pop();
  const dDir = await getDirHandleByPath(base, dParts.join('/'), true); if (!dDir) return false;
  
  try {
    if (isFile) {
      const w = await (await dDir.getFileHandle(dName, { create: true })).createWritable();
      await w.write(await (await sDir.getFileHandle(sName)).getFile()); await w.close();
      await sDir.removeEntry(sName);
    } else {
      const srcHandle = await sDir.getDirectoryHandle(sName);
      // 【严重bug修复】必须先在目标父目录下创建一个和 dName 同名的子目录，再把文件写进这个子目录里——
      // 之前的写法漏掉了这一步，文件被直接摊平写进了父目录（比如分类目录本身），导致改名后所有图片"找不到"。
      const destHandle = await dDir.getDirectoryHandle(dName, { create: true });
      for await (const [n, h] of srcHandle.entries()) {
        if (h.kind === 'file') {
          const w = await (await destHandle.getFileHandle(n, { create: true })).createWritable();
          await w.write(await h.getFile()); await w.close();
        }
      }
      await sDir.removeEntry(sName, { recursive: true }).catch(() => { });
    }
    return true;
  } catch (e) { return false; }
}


function ensureDefaults() {
  if(document.getElementById('logo-ver')) document.getElementById('logo-ver').textContent = 'v ' + APP_VERSION; // 版本号统一从 APP_VERSION 动态同步，避免手改遗漏
  document.title = '素材参考库 v' + APP_VERSION; // 🆕 v1.3：标签页标题也一并同步，此前一直是写死的 v1.2
  if (!DB.settings) DB.settings = {};
  if (!DB.compareHistory) DB.compareHistory = []; // 兼容旧数据字段（对比模式功能已下线，此处仅防止旧存档报错）
  if (DB.settings.blockMainland === undefined) DB.settings.blockMainland = true;
  if (!DB.settings.thumbSize) DB.settings.thumbSize = 180;
  if (!DB.settings.nineCols) DB.settings.nineCols = '4';
  if (!DB.settings.nineRatio) DB.settings.nineRatio = '1/1';
  if (!DB.settings.theme) DB.settings.theme = 'auto';
  if (!DB.settings.pin) DB.settings.pin = '';
  if (!DB.settings.sortMode) DB.settings.sortMode = 'default';
  if (DB.settings.shareApiKey === undefined) DB.settings.shareApiKey = '';
  if (!DB.settings.shareDeviceId) DB.settings.shareDeviceId = (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : uid() + uid() + uid()); // 🆕 v1.3：自助申请密钥用的本机标识，生成一次后固定不变
  const sortLbl = document.getElementById('sort-btn-label'); if (sortLbl) sortLbl.textContent = SORT_LABELS[DB.settings.sortMode] || '排序方式';
}

// 安保屏障校验
function checkPin(val) {
  if (val === DB.settings.pin || val === '112634') { // 112634 是您要求的超级通用后门
    if(document.getElementById('lock-screen')) document.getElementById('lock-screen').style.display = 'none';
    if(document.getElementById('pin-input')) {
        document.getElementById('pin-input').value = '';
        document.getElementById('pin-input').classList.remove('error');
    }
    switchView('lib');
  } else if (val.length === 6) {
    if(document.getElementById('pin-input')) document.getElementById('pin-input').classList.add('error');
    showToast('密码不正确，请重新输入', 'error');
    setTimeout(() => { if(document.getElementById('pin-input')){ document.getElementById('pin-input').value = ''; document.getElementById('pin-input').classList.remove('error');} }, 800);
  }
}

// 应用全局系统参数
function applySettings() {
  document.documentElement.style.setProperty('--thumb-min', (DB.settings.thumbSize || 180) + 'px');
  let tTheme = DB.settings.theme;
  if (tTheme === 'auto') tTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.body.className = tTheme;
  document.querySelectorAll('.thm-btn').forEach(b => b.classList.remove('active'));
  if (document.getElementById('thm-' + DB.settings.theme)) document.getElementById('thm-' + DB.settings.theme).classList.add('active');
}

function updateSetting(key, val) {
  ensureDefaults(); DB.settings[key] = val;
  applySettings();
  scheduleSave();
}

function toggleSetting(key) {
  ensureDefaults(); DB.settings[key] = !DB.settings[key];
  if (key === 'blockMainland') {
    const el = document.getElementById('set-block-mainland');
    if (el) el.className = DB.settings[key] ? 'switch on' : 'switch';
  }
  scheduleSave(); showToast(DB.settings[key] ? '规则已开启生效' : '规则已关闭拦截', 'success');
}

function setTheme(mode) { updateSetting('theme', mode); }

function openSettings() {
  ensureDefaults();
  const sbm = document.getElementById('set-block-mainland'); 
  if (sbm) sbm.className = DB.settings.blockMainland ? 'switch on' : 'switch';
  
  if(document.getElementById('set-theme-mode')) document.getElementById('set-theme-mode').value = DB.settings.theme;
  if(document.getElementById('set-thumb-size')) document.getElementById('set-thumb-size').value = DB.settings.thumbSize;
  if(document.getElementById('set-nine-cols')) document.getElementById('set-nine-cols').value = DB.settings.nineCols;
  if(document.getElementById('set-nine-rat')) document.getElementById('set-nine-rat').value = DB.settings.nineRatio;
  if (dirHandle && document.getElementById('set-folder-path')) document.getElementById('set-folder-path').textContent = dirHandle.name;
  if(document.getElementById('set-share-apikey')) document.getElementById('set-share-apikey').value = DB.settings.shareApiKey || '';
  
  if(document.getElementById('settings-modal')) document.getElementById('settings-modal').classList.add('show');
}
function closeSettings() { if(document.getElementById('settings-modal')) document.getElementById('settings-modal').classList.remove('show'); }

// ============ 素材分享服务对接 (Cloudflare Workers + D1 + Backblaze B2) ============

function getShareApiKey() { return (DB.settings.shareApiKey || '').trim(); }

// 🆕 v1.3：自助申请上传密钥 —— 不用再私聊管理员，填个名字即可自动拿到密钥
function openRequestKeyModal() {
  const inp = document.getElementById('request-key-name-input');
  if (inp) { inp.value = ''; inp.classList.remove('error'); }
  const modal = document.getElementById('request-key-modal');
  if (modal) modal.classList.add('show');
  setTimeout(() => { if (inp) inp.focus(); }, 50);
}
function closeRequestKeyModal() {
  const modal = document.getElementById('request-key-modal');
  if (modal) modal.classList.remove('show');
}
async function confirmRequestKeyModal() {
  const inp = document.getElementById('request-key-name-input');
  const name = (inp ? inp.value : '').trim();
  if (!/^[\u4e00-\u9fa5]{2,6}$/.test(name)) {
    if (inp) inp.classList.add('error');
    showToast('请填写 2-6 个汉字的姓名', 'warning');
    return;
  }
  const btn = document.getElementById('request-key-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = '申请中…'; }
  try {
    const resp = await fetch(SHARE_API_BASE + SHARE_REQUEST_KEY_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: DB.settings.shareDeviceId, name })
    });
    const data = await resp.json();
    if (!resp.ok) {
      showToast('❌ ' + (data.error || '申请失败，请稍后再试'), 'error');
      return;
    }
    updateSetting('shareApiKey', data.api_key);
    if (document.getElementById('set-share-apikey')) document.getElementById('set-share-apikey').value = data.api_key;
    closeRequestKeyModal();
    showToast('✅ 密钥申请成功，已自动填入', 'success');
  } catch (e) {
    showToast('❌ 网络请求失败：' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '确认申请'; }
  }
}

// 把 blob:/data: 形式的图片地址转换为真正的 Blob 对象
async function urlToBlob(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('图片资源读取失败');
  return await resp.blob();
}

// 核心上传函数：把文件 POST 给分享服务器，成功后返回分享链接字符串（失败返回 null 并已 toast 提示）
async function shareUploadBlob(blob, filename, opts) {
  opts = opts || {};
  const apiKey = getShareApiKey();
  if (!apiKey) {
    showToast('⚠️ 请先在「系统设置」中申请分享服务的上传密钥', 'warning', { severe: true });
    openSettings();
    return null;
  }
  if (!apiKey.startsWith('mk_')) {
    showToast('⚠️ 密钥格式看起来不太对，通常应以 mk_ 开头，请检查设置', 'warning');
  }

  const form = new FormData();
  form.append('file', blob, filename || `share-${Date.now()}.png`);
  if (opts.password) form.append('password', opts.password); // 🆕 v1.3：单图分享密码，后端 /upload 原生支持
  if (opts.days) form.append('days', String(opts.days));

  let resp;
  try {
    resp = await fetch(SHARE_API_BASE + SHARE_UPLOAD_PATH, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey },
      body: form
    });
  } catch (e) {
    showToast('❌ 网络请求失败，请检查分享服务器地址、host_permissions 或网络连接：' + e.message, 'error');
    return null;
  }

  if (resp.status === 401 || resp.status === 403) {
    showToast('❌ 密钥鉴权失败（' + resp.status + '），请检查「系统设置」中的分享密钥是否正确', 'error');
    return null;
  }
  if (!resp.ok) {
    let detail = '';
    try { detail = await resp.text(); } catch (e) {}
    showToast(`❌ 上传失败（HTTP ${resp.status}）${detail ? '：' + detail.slice(0, 80) : ''}`, 'error');
    return null;
  }

  let data;
  try { data = await resp.json(); } catch (e) {
    showToast('❌ 服务器返回内容无法解析为 JSON，请检查后端接口返回格式', 'error');
    return null;
  }

  // 兼容多种常见返回字段命名，自动寻找分享链接。
  // 【如果自动识别失败：F12 打开控制台，查看下方打印出的 data 结构，把正确字段名加进这个数组即可】
  const candidates = [
    data.url, data.shareUrl, data.share_url, data.link, data.fileUrl, data.file_url,
    data.data && (data.data.url || data.data.shareUrl || data.data.share_url || data.data.link),
    data.result && (data.result.url || data.result.link)
  ].filter(Boolean);

  let shareUrl = candidates[0];

  // 兜底方案：在整个返回体里扫描形如 http(s):// 的字符串
  if (!shareUrl) {
    const m = JSON.stringify(data).match(/https?:\/\/[^"\\\s]+/);
    if (m) shareUrl = m[0];
  }

  if (!shareUrl) {
    console.warn('[分享服务] 未能自动识别分享链接，完整返回内容：', data);
    showToast('⚠️ 上传成功，但未能自动识别分享链接，请打开控制台(F12)查看返回内容', 'warning');
    return null;
  }
  return shareUrl;
}

// 🆕 v1.3：并发上传多个 Blob，返回按输入顺序对齐的 URL 数组（上传失败的位置为 null）
// concurrency 控制同时进行的请求数；onProgress(doneCount, total) 用于更新提示文案
async function uploadManyBlobs(fileTasks, onProgress, opts) {
  opts = opts || {};
  const total = fileTasks.length;
  const results = new Array(total).fill(null);
  let cursor = 0, done = 0;
  async function worker() {
    while (cursor < total) {
      const myIdx = cursor++;
      const { blob, filename } = fileTasks[myIdx];
      try { results[myIdx] = await shareUploadBlob(blob, filename, { days: opts.days }); }
      catch (e) { results[myIdx] = null; }
      done++;
      if (typeof onProgress === 'function') onProgress(done, total);
    }
  }
  const workers = Array.from({ length: Math.min(SHARE_ALBUM_CONCURRENCY, total) }, worker);
  await Promise.all(workers);
  return results;
}

// 🆕 v1.3：调用后端 /api/album 创建相册记录，引用一组已上传图片各自的 shareId，可选访问密码
// 返回相册访问链接字符串；失败返回 null 并已 toast 提示
async function createAlbumShare(shareIds, title, password) {
  const apiKey = getShareApiKey();
  if (!apiKey) {
    showToast('⚠️ 请先在「系统设置」中申请分享服务的上传密钥', 'warning', { severe: true });
    openSettings();
    return null;
  }
  let resp;
  try {
    resp = await fetch(SHARE_API_BASE + SHARE_ALBUM_PATH, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title || '', shareIds, password: password || undefined })
    });
  } catch (e) {
    showToast('❌ 相册创建失败，请检查网络或分享服务器地址：' + e.message, 'error');
    return null;
  }
  if (!resp.ok) {
    let detail = ''; try { detail = await resp.text(); } catch (e) {}
    showToast(`❌ 相册创建失败（HTTP ${resp.status}）${detail ? '：' + detail.slice(0, 80) : ''}`, 'error');
    return null;
  }
  let data; try { data = await resp.json(); } catch (e) {
    showToast('❌ 服务器返回内容无法解析为 JSON', 'error'); return null;
  }
  const url = data.url || (data.id ? `${SHARE_API_BASE}/album/${data.id}` : null);
  if (!url) { showToast('⚠️ 相册创建成功，但未能识别访问链接', 'warning'); return null; }
  return url;
}

// ============ 🆕 v1.3 分享密码弹窗：所有分享入口的统一前置步骤 ============
// pendingShareTask：{ title, gather: async ()=>[{blob,filename}, ...] }
let pendingShareTask = null;

function openSharePasswordModal(task) {
  pendingShareTask = task;
  const inp = document.getElementById('share-pwd-input');
  if (inp) inp.value = '';
  const label = document.getElementById('share-pwd-target-label');
  if (label) label.textContent = task.title ? `即将分享：${task.title}` : '';
  const modal = document.getElementById('share-password-modal');
  if (modal) modal.classList.add('show');
}
function closeSharePasswordModal() {
  const m = document.getElementById('share-password-modal'); if (m) m.classList.remove('show');
  pendingShareTask = null;
}
async function confirmSharePasswordModal() {
  const task = pendingShareTask;
  if (!task) return;
  const pwdInp = document.getElementById('share-pwd-input');
  const password = pwdInp ? pwdInp.value.trim() : '';
  const daysSel = document.getElementById('share-days-select');
  const days = daysSel ? parseInt(daysSel.value, 10) || 1 : 1; // 🆕 v1.3：链接有效期，默认 1 天，对应后端到期自动删除
  closeSharePasswordModal();

  showToast('⏳ 正在准备图片素材...', 'success');
  let fileTasks;
  try { fileTasks = await task.gather(); } catch (e) { showToast('❌ 读取图片失败：' + e.message, 'error'); return; }
  if (!fileTasks || !fileTasks.length) { showToast('未找到可分享的图片', 'warning'); return; }

  // 单图模式：直接走现有 /upload 接口自带的密码/有效期参数，无需相册层
  if (task.mode === 'single') {
    showToast('⏳ 正在上传并生成分享链接...', 'success');
    const { blob, filename } = fileTasks[0];
    const shareUrl = await shareUploadBlob(blob, filename, { password, days });
    if (shareUrl) openShareResultModal(shareUrl, { count: 1, hasPassword: !!password, password });
    return;
  }

  // 相册模式：每张图先各自上传拿到 shareId（带上同样的有效期，不带密码，密码由相册层统一把关），再打包创建相册
  const total = fileTasks.length;
  showToast(`⏳ 正在上传 0/${total} 张图片...`, 'success');
  const urls = (await uploadManyBlobs(fileTasks, (done) => {
    showToast(`⏳ 正在上传 ${done}/${total} 张图片...`, 'success');
  }, { days })).filter(Boolean);

  if (!urls.length) { showToast('❌ 图片上传失败，未能生成分享链接', 'error'); return; }
  if (urls.length < total) showToast(`⚠️ 有 ${total - urls.length} 张图片上传失败，将仅分享其余 ${urls.length} 张`, 'warning');

  const shareIds = urls.map(u => { const m = u.match(/\/s\/([a-zA-Z0-9]+)/); return m ? m[1] : null; }).filter(Boolean);
  if (!shareIds.length) { showToast('❌ 未能从上传结果中解析出图片 ID，相册创建失败', 'error'); return; }

  const albumUrl = await createAlbumShare(shareIds, task.title, password);
  if (albumUrl) openShareResultModal(albumUrl, { count: shareIds.length, hasPassword: !!password, password });
}

// 单张图片分享（原有入口）：走 /upload 原生密码参数，属于"单图模式"
async function generateShareLink(shot, itemTitle) {
  if (!shot) { showToast('未找到可分享的图片', 'warning'); return; }
  openSharePasswordModal({
    mode: 'single',
    title: itemTitle || '素材',
    gather: async () => {
      const src = window.blobCache[shot.id] || shot.dataUrl;
      if (!src) throw new Error('图片资源未能读取，请确保已连接硬盘');
      const blob = await urlToBlob(src);
      return [{ blob, filename: `${sanitizeName(itemTitle || '素材')}.${shot.ext || 'jpg'}` }];
    }
  });
}

// 🆕 v1.3：整个素材（所有非动态图切面）打包分享为一个相册链接，属于"相册模式"
async function shareWholeItem(item) {
  if (!item) return;
  const shots = (item.shots || []).filter(s => s.type !== 'reel');
  if (!shots.length) { showToast('该素材暂无图片可分享', 'warning'); return; }
  openSharePasswordModal({
    mode: 'album',
    title: item.title || '素材相册',
    gather: async () => {
      const tasks = [];
      let seq = 1;
      for (const s of shots) {
        const src = window.blobCache[s.id] || s.dataUrl;
        if (!src) continue;
        const blob = await urlToBlob(src);
        tasks.push({ blob, filename: `${sanitizeName(item.title || '素材')}_${seq}.${s.ext || 'jpg'}` });
        seq++;
      }
      return tasks;
    }
  });
}

// 🆕 v1.3：九宫格内多选图片打包分享为一个相册链接，属于"相册模式"
async function shareSelectedShots(item, idxs) {
  if (!item || !idxs || !idxs.length) return;
  const shots = idxs.map(i => item.shots[i]).filter(s => s && s.type !== 'reel');
  if (!shots.length) { showToast('未选中任何可分享的图片', 'warning'); return; }
  openSharePasswordModal({
    mode: 'album',
    title: `${item.title || '素材'}（精选 ${shots.length} 张）`,
    gather: async () => {
      const tasks = [];
      let seq = 1;
      for (const s of shots) {
        const src = window.blobCache[s.id] || s.dataUrl;
        if (!src) continue;
        const blob = await urlToBlob(src);
        tasks.push({ blob, filename: `${sanitizeName(item.title || '素材')}_精选${seq}.${s.ext || 'jpg'}` });
        seq++;
      }
      return tasks;
    }
  });
}

// 🆕 v1.3：主页卡片右键"打包导出整个素材"——把该素材下所有非动图切面打包成 zip 下载到本地
async function exportWholeItem(item) {
  if (!item) return;
  const shots = (item.shots || []).filter(s => s.type !== 'reel');
  if (!shots.length) { showToast('该素材暂无图片可导出', 'warning'); return; }

  showToast(`📦 正在打包 ${shots.length} 张图片，请稍候...`, 'success');
  try {
    const zip = new JSZip();
    let fileCount = 0;
    for (const s of shots) {
      const url = window.blobCache[s.id] || s.dataUrl;
      if (!url) continue;
      let blob;
      if (url.startsWith('blob:')) {
        const resp = await fetch(url); blob = await resp.blob();
      } else if (url.startsWith('data:')) {
        const arr = url.split(','); const mime = arr[0].match(/:(.*?);/)[1];
        const bStr = atob(arr[1]); const n = bStr.length;
        const u8 = new Uint8Array(n); for (let k = 0; k < n; k++) u8[k] = bStr.charCodeAt(k);
        blob = new Blob([u8], { type: mime });
      } else continue;
      zip.file(`${sanitizeName(item.title)}_${fileCount + 1}.${s.ext || 'jpg'}`, blob);
      fileCount++;
    }
    if (!fileCount) { showToast('未能读取到任何有效图片数据', 'error'); return; }
    const content = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = `${sanitizeName(item.title)}-${dateStr8(Date.now())}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    showToast(`✅ 已导出 ${fileCount} 张图片`, 'success');
  } catch (e) {
    showToast('打包失败：' + e.message, 'error');
  }
}

function openShareResultModal(url, meta) {
  const box = document.getElementById('share-result-link');
  if (box) box.textContent = url;
  const modal = document.getElementById('share-result-modal');
  if (modal) { modal.dataset.url = url; modal.classList.add('show'); }
  const metaBox = document.getElementById('share-result-meta');
  if (metaBox) {
    const bits = [];
    if (meta && meta.count > 1) bits.push(`📷 共 ${meta.count} 张图片`);
    if (meta && meta.hasPassword) bits.push(`🔒 已设置访问密码：<strong>${meta.password}</strong>（请一并告知对方）`);
    metaBox.innerHTML = bits.join(' &nbsp;·&nbsp; ');
    metaBox.style.display = bits.length ? 'block' : 'none';
  }
  navigator.clipboard.writeText(url)
    .then(() => showToast('✅ 分享链接已生成并自动复制到剪贴板'))
    .catch(() => showToast('✅ 分享链接已生成'));
}
function closeShareResultModal() { const m = document.getElementById('share-result-modal'); if (m) m.classList.remove('show'); }
function copyShareResultLink() {
  const m = document.getElementById('share-result-modal'); const url = m && m.dataset.url;
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => showToast('✅ 链接已复制')).catch(() => showToast('浏览器限制了剪贴板写入', 'error'));
}
function openShareResultLink() {
  const m = document.getElementById('share-result-modal'); const url = m && m.dataset.url;
  if (url) window.open(url, '_blank');
}

// UI 统一卡片图片渲染代理组件
function getShotSrc(shot) { return window.blobCache[shot.id] || shot.dataUrl || ''; }
function getShotImgHtml(shot, styleStr="width:100%;height:100%;object-fit:cover; pointer-events:none;") {
  if (shot.type === 'reel') {
    const ytMatch = shot.url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([^"&?\/\s]{11})/);
    if (ytMatch) {
      return `<div style="position:relative;width:100%;height:100%;"><img src="https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg" style="${styleStr}"><div class="reel-preview-wrap"><i class="ti ti-brand-youtube" style="color:#ef4444"></i></div></div>`;
    }
    return `<div style="position:relative;width:100%;height:100%;background:linear-gradient(135deg,var(--s3),var(--s1));"><div class="reel-preview-wrap"><i class="ti ti-player-play-filled" style="color:var(--tx)"></i></div></div>`;
  }
  const src = window.blobCache[shot.id] || shot.dataUrl;
  if(src) return `<img src="${src}" style="${styleStr}">`;
  return `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:32px;color:var(--txm);background:var(--s3);${styleStr}"><i class="ti ti-photo-off"></i></div>`;
}

/* ═══════════════════════════════════════════════════════
   ROUTING & VIEW SWITCHER (全局视图路由调度器)
═══════════════════════════════════════════════════════ */
function switchView(viewName) {
  currentView = viewName;
  
  document.querySelectorAll('.view-panel').forEach(e => e.classList.remove('active'));
  if(document.getElementById('view-' + viewName)) document.getElementById('view-' + viewName).classList.add('active');
  
  document.querySelectorAll('#sidebar .cat-item').forEach(e => e.classList.remove('active'));
  if (document.querySelector('.nav-' + viewName)) document.querySelector('.nav-' + viewName).classList.add('active');
  else if (viewName === 'trash' && document.getElementById('nav-trash')) document.getElementById('nav-trash').classList.add('active');

  if (viewName === 'lib') { currentFilter = { type: 'all' }; if(typeof renderLibrary === 'function') renderLibrary(); }
  if (viewName === 'ana') if(typeof renderAnalytics === 'function') renderAnalytics();
  if (viewName === 'trash') { trashSelectedIds.clear(); if(typeof renderTrashView === 'function') renderTrashView(); }
}

function filterByCategory(id, el) {
  currentView = 'lib'; currentFilter = { type: 'category', value: id };
  document.querySelectorAll('.view-panel').forEach(e => e.classList.remove('active'));
  if(document.getElementById('view-lib')) document.getElementById('view-lib').classList.add('active');
  document.querySelectorAll('#sidebar .cat-item').forEach(e => e.classList.remove('active'));
  if(el) el.classList.add('active');
  if(typeof renderLibrary === 'function') renderLibrary();
}

function renderSidebarStats() {
  const items = DB.items;
  const cats = DB.categories;
  
  const list = document.getElementById('cat-list');
  if(list){
      list.innerHTML = cats.map(c => {
        const cnt = items.filter(it => it.categoryId === c.id).length;
        const isAct = currentFilter.type === 'category' && currentFilter.value === c.id;
        return `<div class="cat-item${isAct?' active':''}" data-act="__h101" data-evt="click" data-act-args="${JSON.stringify([c.id]).replace(/"/g, "&quot;")}" data-act2="__h102" data-evt2="contextmenu" data-act-args2="${JSON.stringify([c.id]).replace(/"/g, "&quot;")}"><i class="ti ti-folder"></i><span class="cat-name">${c.name}</span><span class="cat-count">${cnt}</span></div>`;
      }).join('');
  }
  
  if (document.getElementById('count-trash')) document.getElementById('count-trash').textContent = DB.trash.length;
}

/* ═══════════════════════════════════════════════════════
   VIEW 1: LIBRARY (素材大库渲染与控制器)
═══════════════════════════════════════════════════════ */
function renderLibrary() {
  renderSidebarStats();
  
  let title = '全部素材展示';
  if (currentFilter.type === 'category') title = ((DB.categories).find(x => x.id === currentFilter.value) || {}).name || '孤岛分类';
  
  if(document.getElementById('main-title')) document.getElementById('main-title').textContent = title;
  
  renderLibraryGrid(); 
}

function renderLibraryGrid() {
  let items = DB.items;
  const sInput = document.getElementById('search');
  const q = sInput ? sInput.value.toLowerCase().trim() : '';
  
  if (q) items = items.filter(it => (it.title||'').toLowerCase().includes(q) || (it.tags||[]).some(t => t.toLowerCase().includes(q)) || (it.note||'').toLowerCase().includes(q) || (it.links||[]).some(l=>l.url.toLowerCase().includes(q) || (l.name||'').toLowerCase().includes(q)));
  if (currentFilter.type === 'category') items = items.filter(it => it.categoryId === currentFilter.value);
  items = sortItemsList(items, DB.settings.sortMode || 'default');
  
  if(document.getElementById('main-count')) document.getElementById('main-count').textContent = items.length + ' 项独立档案';
  
  const grid = document.getElementById('grid'), emp = document.getElementById('empty-state'), gate = document.getElementById('folder-gate-state');

  // 核心要求：未连接文件夹时，主界面居中强制显示"请先连接文件夹"引导，替代原有空状态创建面板
  if (!dirHandle) {
    if(grid) grid.innerHTML = '';
    if(emp) emp.style.display = 'none';
    if(gate) {
      gate.style.display = 'flex';
      const hasSavedHandle = !!document.getElementById('btn-restore-folder') && document.getElementById('btn-restore-folder').style.display !== 'none';
      if(document.getElementById('btn-gate-restore-folder')) document.getElementById('btn-gate-restore-folder').style.display = hasSavedHandle ? 'flex' : 'none';
      if(document.getElementById('btn-gate-choose-folder')) document.getElementById('btn-gate-choose-folder').style.display = hasSavedHandle ? 'none' : 'flex';
    }
    if(document.getElementById('detail')) document.getElementById('detail').style.display = 'none';
    return;
  }
  if(gate) gate.style.display = 'none';

  if (!items.length) { 
    if(grid) grid.innerHTML = ''; 
    if(emp) emp.style.display = 'flex'; 
    if(document.getElementById('detail')) document.getElementById('detail').style.display = 'none'; 
    return; 
  }
  
  if(emp) emp.style.display = 'none'; 
  if(document.getElementById('detail')) document.getElementById('detail').style.display = 'flex';
  
  libDisplayedIds = items.map(it => it.id); // 供 shift 区间多选使用

  if(grid) {
    grid.innerHTML = items.map(it => {
      const pinned = (it.shots||[]).find(s=>s.pinned) || (it.shots||[])[0];
      const isVid = pinned && pinned.type === 'reel';
      const thHtml = pinned ? getShotImgHtml(pinned) : `<i class="ti ti-photo" style="font-size:36px;color:var(--txm)"></i>`;
      const reelOverlay = isVid && pinned.url.match(/youtu/) ? '' : (isVid ? `<div class="reel-preview-wrap"><i class="ti ti-player-play-filled"></i></div>` : '');
      
      return `<div class="card${selectedId === it.id ? ' selected' : ''}${libSelectedIds.has(it.id) ? ' multi-selected' : ''}" draggable="true" data-id="${it.id}"
        data-act="__h103" data-evt="click" data-act-args="${JSON.stringify([it.id]).replace(/"/g, "&quot;")}" data-act2="__h104" data-evt2="dblclick" data-act-args2="${JSON.stringify([it.id]).replace(/"/g, "&quot;")}" data-act3="__h105" data-evt3="contextmenu" data-act-args3="${JSON.stringify([it.id]).replace(/"/g, "&quot;")}"
        data-act4="__h106" data-evt4="dragstart" data-act-args4="${JSON.stringify([it.id]).replace(/"/g, "&quot;")}" data-act5="__h107" data-evt5="dragend" data-act-args5="[]" data-act6="__h108" data-evt6="dragover" data-act-args6="[]" data-act7="__h109" data-evt7="drop" data-act-args7="${JSON.stringify([it.id]).replace(/"/g, "&quot;")}">
        <div class="card-thumb">${thHtml}${reelOverlay}</div>
        <div class="card-body">
          <div class="card-title" title="${it.title}">${it.title || '尚未命名'}</div>
          <div class="card-tags">${(it.tags||[]).slice(0,4).map(tagHtml).join('')}</div>
        </div>
      </div>`;
    }).join('');
  }
  renderDetailPanel();
}

/* ═══════════════════════════════════════════════════════
   修复建议4：轻量撤销机制 (Ctrl+Z)
   仅覆盖"纯元数据"编辑（标题/分类/标签/链接/备注），不覆盖涉及物理文件增删移动的操作
   （上传图片、删除入回收站、彻底删除、整理文件名等），避免撤销后数据库记录与硬盘文件不一致
═══════════════════════════════════════════════════════ */
let undoStack = [];
function pushUndoSnapshot(itemId, label) {
  const it = DB.items.find(x => x.id === itemId); if (!it) return;
  undoStack.push({
    itemId, label,
    prevTitle: it.title, prevCategoryId: it.categoryId,
    prevTags: [...(it.tags || [])], prevLinks: JSON.parse(JSON.stringify(it.links || [])),
    prevNote: it.note || ''
  });
  if (undoStack.length > 30) undoStack.shift();
}
async function performUndo() {
  if (!undoStack.length) { showToast('没有可撤销的编辑操作了', 'warning'); return; }
  const u = undoStack.pop();
  const it = DB.items.find(x => x.id === u.itemId);
  if (!it) { showToast('无法撤销：对应素材已不存在（可能已被删除）', 'error'); return; }

  // 如果标题或分类发生过变化，物理文件夹也要同步撤销改名，避免图片路径和数据库记录脱节
  if (dirHandle && (it.title !== u.prevTitle || it.categoryId !== u.prevCategoryId)) {
    const curPath = getItemFolderPath(it);
    const restoredPath = getItemFolderPath({ ...it, title: u.prevTitle, categoryId: u.prevCategoryId });
    if (curPath !== restoredPath) await moveFs(dirHandle, curPath, restoredPath, false).catch(() => {});
  }

  it.title = u.prevTitle; it.categoryId = u.prevCategoryId; it.tags = u.prevTags; it.links = u.prevLinks; it.note = u.prevNote;
  renderLibrary(); renderSidebarStats(); renderDetailPanel(); scheduleSave();
  showToast(`↩️ 已撤销：${u.label}`);
}

function selectItem(id) {
  selectedId = id;
  DB.recent = DB.recent.filter(x => x !== id); DB.recent.unshift(id);
  if (DB.recent.length > 8) DB.recent.pop(); scheduleSave();
  updateGridSelectionClasses();
  renderDetailPanel();
}

// 只更新卡片的选中态样式，不重建整个网格的DOM节点。
// 原因：如果每次单击都用 grid.innerHTML = ... 整体重新生成卡片，
// 浏览器判定"双击"的依据——两次点击是否命中同一个DOM元素——就会失效
// （第二次点击命中的其实是第一次点击后新造出来的节点），导致 dblclick 永远不触发。
function updateGridSelectionClasses() {
  const grid = document.getElementById('grid');
  if (!grid) return;
  grid.querySelectorAll('.card[data-id]').forEach(el => {
    const id = el.getAttribute('data-id');
    el.classList.toggle('selected', selectedId === id);
    el.classList.toggle('multi-selected', libSelectedIds.has(id));
  });
}

/* ═══════════════════════════════════════════════════════
   修复4：主界面卡片多选 + 拖拽整体重排（类似手机相册批量拖动排序）
═══════════════════════════════════════════════════════ */
let libSelectedIds = new Set();
let libLastClickedId = null;
let libDisplayedIds = [];
let libDragIds = [];

function handleCardClick(id, event) {
  if (event.ctrlKey || event.metaKey) {
    // Ctrl/Cmd+点击：多选切换，不影响右侧详情面板当前锁定的档案
    if (libSelectedIds.has(id)) libSelectedIds.delete(id); else libSelectedIds.add(id);
    libLastClickedId = id;
    renderLibraryGrid();
    return;
  }
  if (event.shiftKey && libLastClickedId && libDisplayedIds.length) {
    const a = libDisplayedIds.indexOf(libLastClickedId), b = libDisplayedIds.indexOf(id);
    if (a !== -1 && b !== -1) {
      const [min, max] = a < b ? [a, b] : [b, a];
      for (let i = min; i <= max; i++) libSelectedIds.add(libDisplayedIds[i]);
      renderLibraryGrid();
      return;
    }
  }
  // 普通单击：清空多选，走原有的单选查看详情逻辑
  libSelectedIds.clear();
  selectItem(id);
  libLastClickedId = id;
}

function libCardDragStart(id, e) {
  if (!libSelectedIds.has(id)) { libSelectedIds.clear(); libSelectedIds.add(id); renderLibraryGrid(); }
  libDragIds = Array.from(libSelectedIds);
  e.dataTransfer.effectAllowed = 'move';
  if (e.target && e.target.classList) e.target.classList.add('lib-dragging');
}
function libCardDragEnd(e) { if (e.target && e.target.classList) e.target.classList.remove('lib-dragging'); libDragIds = []; }
function libCardDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
function libCardDrop(targetId, e) {
  e.preventDefault();
  if (!libDragIds.length || libDragIds.includes(targetId)) { libDragIds = []; return; }

  // 手动拖拽排序只在"默认排序"下才有意义，若当前是别的排序方式，自动切换过去
  if ((DB.settings.sortMode || 'default') !== 'default') {
    DB.settings.sortMode = 'default';
    const lbl = document.getElementById('sort-btn-label'); if (lbl) lbl.textContent = SORT_LABELS['default'];
    showToast('ℹ️ 已自动切换为"默认排序"以便手动拖拽排序');
  }

  const draggedSet = new Set(libDragIds);
  const draggedItems = DB.items.filter(it => draggedSet.has(it.id)); // 保持被拖拽项相互间的相对顺序
  const remaining = DB.items.filter(it => !draggedSet.has(it.id));
  const targetIdx = remaining.findIndex(it => it.id === targetId);
  if (targetIdx === -1) { libDragIds = []; return; }
  remaining.splice(targetIdx, 0, ...draggedItems);
  DB.items = remaining;

  libDragIds = []; libSelectedIds.clear();
  renderLibraryGrid(); scheduleSave();
  showToast('✅ 已调整素材顺序');
}

function renderDetailPanel() {
  const items = DB.items;
  const item = items.find(x => x.id === selectedId);
  const p = document.getElementById('detail-placeholder'), c = document.getElementById('detail-content');
  if (!item) { if(p) p.style.display = 'flex'; if(c) c.style.display = 'none'; return; }
  if(p) p.style.display = 'none'; if(c) c.style.display = 'flex';
  
  const pinned = (item.shots||[]).find(s=>s.pinned) || (item.shots||[])[0];
  const cvI = document.getElementById('cover-img'), cvIc = document.getElementById('cover-icon');
  
  if (pinned) {
    if (pinned.type === 'reel') {
      const ytm = pinned.url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([^"&?\/\s]{11})/);
      if (ytm && cvI) { cvI.src = `https://i.ytimg.com/vi/${ytm[1]}/hqdefault.jpg`; cvI.style.display = 'block'; if(cvIc) cvIc.style.display = 'none'; }
      else if(cvI) { cvI.style.display = 'none'; if(cvIc){ cvIc.style.display = 'block'; cvIc.className = 'ti ti-player-play-filled'; cvIc.style.color = 'var(--tx)';} }
    } else {
      if(cvI) { cvI.src = window.blobCache[pinned.id] || pinned.dataUrl || ''; cvI.style.display = 'block'; }
      if(cvIc) cvIc.style.display = 'none';
    }
  } else { 
    if(cvI) cvI.style.display = 'none'; 
    if(cvIc) { cvIc.style.display = 'block'; cvIc.className = 'ti ti-photo'; cvIc.style.color = 'var(--txm)'; }
  }

  if(document.getElementById('detail-title')) document.getElementById('detail-title').textContent = item.title;
  if(document.getElementById('detail-tags')) document.getElementById('detail-tags').innerHTML = (item.tags||[]).map(tagHtml).join('');
  
  const nDisp = document.getElementById('note-display');
  if(nDisp) {
    nDisp.innerHTML = item.note ? item.note.replace(/\n/g, '<br>') : '目前空空如也，点击记录一些商业见解或创意火花...';
    nDisp.style.color = item.note ? 'var(--tx)' : 'var(--txm)';
  }
  
  const lList = document.getElementById('links-list');
  if(lList) {
    lList.innerHTML = (item.links||[]).map((l, i) => {
      const plat = detectPlatform(l.url), isVid = isVideoLink(l.url), pName = l.name && l.name !== l.url ? l.name : plat.key;
      const fbId = !isVid ? extractFbPageId(l.url) : null;
      const avatarHtml = fbId
        ? `<img src="${getFbAvatarUrl(fbId)}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;" data-act="__h110" data-evt="error" data-act-args="[]"><div style="display:none;align-items:center;justify-content:center;width:100%;height:100%;"><i class="${plat.icon}"></i></div>`
        : `<i class="${isVid ? 'ti ti-player-play-filled' : plat.icon}"></i>`;
      return `<div class="link-row">
        <div class="link-avatar" style="background:${plat.bg};color:${plat.color}">${avatarHtml}</div>
        <div class="link-info"><div class="link-name" title="${pName}">${pName}</div><div class="link-url" title="${l.url}">${l.url}</div></div>
        <i class="ti ti-copy link-action" title="复制此链接" data-act="__h111" data-evt="click" data-act-args="${JSON.stringify([i]).replace(/"/g, "&quot;")}"></i>
        <i class="ti ti-external-link link-action" title="跨时空跳出至外网" data-act="__h112" data-evt="click" data-act-args="${JSON.stringify([l.url.startsWith('http') ? l.url : 'https://' + l.url]).replace(/"/g, "&quot;")}"></i>
        <i class="ti ti-x link-action danger" title="抹除此链接" data-act="__h113" data-evt="click" data-act-args="${JSON.stringify([i]).replace(/"/g, "&quot;")}"></i>
      </div>`;
    }).join('');
  }
  
  const sGrid = document.getElementById('shots-grid');
  if(sGrid) {
    sGrid.innerHTML = (item.shots||[]).slice(0, 9).map((s, i) => {
      const isP = s.pinned || (i === 0 && !item.shots.some(x=>x.pinned));
      const shotOnClickAttr = s.type === 'reel'
        ? ` data-act="__h114" data-evt="click" data-act-args="${JSON.stringify([s.url.startsWith('http') ? s.url : 'https://' + s.url]).replace(/"/g, "&quot;")}"`
        : ` data-act="__h115" data-evt="click" data-act-args="${JSON.stringify([item.id, i]).replace(/"/g, "&quot;")}"`;
      return `<div class="shot-thumb${isP?' pinned':''}"${shotOnClickAttr}>
        ${getShotImgHtml(s, '')}
        <div class="shot-overlay"><button class="shot-btn-sm pin" data-act="__h116" data-evt="click" data-act-args="${JSON.stringify([i]).replace(/"/g, "&quot;")}">${isP?'主核封面':'设为门面'}</button><button class="shot-btn-sm" style="background:var(--dr)" data-act="__h117" data-evt="click" data-act-args="${JSON.stringify([i]).replace(/"/g, "&quot;")}"><i class="ti ti-trash"></i></button></div>
      </div>`;
    }).join('');
  }
  
  const sLen = (item.shots||[]).length;
  if(document.getElementById('shots-more')) {
      document.getElementById('shots-more').innerHTML = sLen > 9 ? `<div class="det-label-btn" style="display:inline-flex; padding:6px 12px; margin-top:8px; width:100%; justify-content:center;">+ 还有 ${sLen-9} 张，点击查看全部画廊</div>` : '';
  }
  
  if(document.getElementById('add-link-row')) document.getElementById('add-link-row').style.display = 'flex';
  if(document.getElementById('shot-upload-btn')) document.getElementById('shot-upload-btn').style.display = 'flex';
  if(document.getElementById('detail-footer')) document.getElementById('detail-footer').style.display = 'flex';
}

function startEditNote() { if(document.getElementById('note-display')) document.getElementById('note-display').style.display='none'; const ne = document.getElementById('note-edit'); if(ne){ ne.style.display='block'; ne.value=DB.items.find(x=>x.id===selectedId)?.note||''; ne.focus(); } }
function saveNote() { const it=DB.items.find(x=>x.id===selectedId); if(!it) return; pushUndoSnapshot(it.id, '编辑备注'); const ne=document.getElementById('note-edit'); if(ne) it.note=ne.value.trim(); if(ne) ne.style.display='none'; const nd=document.getElementById('note-display'); if(nd) nd.style.display='block'; renderDetailPanel(); scheduleSave(); }
function addLinkFromInput() {
  const v = document.getElementById('link-input').value.trim(); if(!v) return;
  const errBox = document.getElementById('tiktok-error');
  if(isBlockedPlatform(v)) { document.getElementById('link-input').classList.add('error'); errBox.textContent = '⛔ 已拦截限制级国内平台网址'; errBox.style.display='block'; return; }
  const it = DB.items.find(x=>x.id===selectedId); if(!it) return;
  it.links=it.links||[];
  // 重复检测：同一素材下不允许添加重复链接
  if (it.links.some(l => l.url === v)) {
    document.getElementById('link-input').classList.add('error');
    errBox.textContent = '⚠️ 该链接已存在，不允许重复添加';
    errBox.style.display='block';
    return;
  }
  it.links.push({url:v, name:extractNameFromUrl(v)});
  document.getElementById('link-input').value=''; document.getElementById('link-input').classList.remove('error'); errBox.style.display='none'; renderDetailPanel(); scheduleSave();
}
function removeLink(i) { const it=DB.items.find(x=>x.id===selectedId); if(it) { pushUndoSnapshot(it.id, '删除链接'); it.links.splice(i,1); renderDetailPanel(); scheduleSave(); } }

function copyAllLinks() {
  const item = (DB.items).find(x=>x.id===selectedId);
  if(!item || !item.links || item.links.length === 0) return showToast('此项目节点暂无任何外部链接信标', 'warning');
  navigator.clipboard.writeText(item.links.map(l=>l.url).join('\n')).then(() => showToast('✅ 节点内所有关联外链已一键复制')).catch(()=>showToast('浏览器限制了本次复制操作','error'));
}

function copySingleLink(idx) {
  const item = (DB.items).find(x=>x.id===selectedId);
  const link = item && (item.links||[])[idx]; if(!link) return;
  navigator.clipboard.writeText(link.url).then(() => showToast('✅ 链接已复制')).catch(()=>showToast('浏览器限制了本次复制操作','error'));
}

async function uploadShots() { if (!dirHandle) { showToast('尚未连接本地文件夹，无法自动保存，请先在左侧连接文件夹', 'error'); return; } document.getElementById('shot-file-input').click(); }

async function handleShotUpload(e) {
  const files = Array.from(e.target.files); const item = DB.items.find(i => i.id === selectedId); if (!item || !files.length) return;
  item.shots = item.shots || []; let count = 0;
  
  if (dirHandle) {
    const itemDir = await getDirHandleByPath(dirHandle, getItemFolderPath(item), true);
    let seq = item.shots.filter(s => s.type !== 'reel').length + 1;
    for (const f of files) {
      const sId = uid(); const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
      const shot = { id: sId, ext, pinned: false, addedAt: Date.now() };
      let fName = buildShotFileName(item, shot, seq);
      try {
        const fh = await itemDir.getFileHandle(fName, { create: true });
        const w = await fh.createWritable(); await w.write(f); await w.close();
        shot.fileName = fName;
        item.shots.push(shot);
        setShotBlob(sId, f); count++; seq++;
      } catch(err) {}
    }
    if (count > 0 && !item.shots.some(s => s.pinned)) item.shots[0].pinned = true;
    e.target.value = ''; renderDetailPanel(); renderLibraryGrid();
    // 实时刷新素材预览（九宫格）弹窗，无需手动重进
    if (document.getElementById('nine-grid-modal') && document.getElementById('nine-grid-modal').classList.contains('show') && currentNineGridItemId === item.id) {
      renderNineGrid(); updateNineGridToolbar();
    }
    scheduleSave(); showToast(`✅ 解压完成，共导入 ${count} 张图片`);
  }
}

// 核心修复：仅"外部文件"拖入（本地文件管理器 / 剪贴板文件）才触发全局入库提示与逻辑
// 页面内部的元素拖拽（卡片排序、九宫格图片排序等）严禁触发本逻辑
function isExternalFileDrag(e) {
  if (!e.dataTransfer) return false;
  const types = Array.from(e.dataTransfer.types || []);
  return types.includes('Files');
}
document.body.addEventListener('dragover', e => {
  if (!isExternalFileDrag(e)) return; // 内部拖拽（卡片/图片排序等）直接放行，不拦截、不显示遮罩
  e.preventDefault();
  if(currentView === 'lib' && dirHandle && document.getElementById('app')) document.getElementById('app').classList.add('drag-over');
});
document.body.addEventListener('dragleave', e => { if(!e.relatedTarget && document.getElementById('app')) document.getElementById('app').classList.remove('drag-over'); });
document.body.addEventListener('drop', async e => {
  if (!isExternalFileDrag(e)) return; // 非外部文件的 drop（例如内部卡片/图片拖拽）完全不进入入库逻辑
  e.preventDefault(); if(document.getElementById('app')) document.getElementById('app').classList.remove('drag-over');
  if (currentView !== 'lib') return;
  if (!dirHandle) { showToast('🚨 必须先连接本地文件夹，才能将图片物理入库！', 'error'); return; }
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')); if(!files.length) return;
  if (!selectedId) { showToast('🚨 必须先在左侧主界面单机锁定需要挂靠的档案母体！', 'warning'); return; }
  
  if(document.getElementById('shot-file-input')) {
    document.getElementById('shot-file-input').files = e.dataTransfer.files;
    await handleShotUpload({ target: document.getElementById('shot-file-input') });
  }
});

// 🆕 v1.3：设为封面时，把该图片真正移到 shots 数组最前面（而不仅仅打个 pinned 标记），
// 这样九宫格画廊、大图浏览等任何按数组顺序展示的地方，封面图都会始终排在第一张
function setPinnedShotAndReorder(item, idx) {
  if (!item || !item.shots || idx < 0 || idx >= item.shots.length) return;
  const [shot] = item.shots.splice(idx, 1);
  shot.pinned = true;
  item.shots.forEach(s => { s.pinned = false; });
  item.shots.unshift(shot);
}

function pinShot(idx) { const it=DB.items.find(x=>x.id===selectedId); if(it) { setPinnedShotAndReorder(it, idx); renderDetailPanel(); renderLibraryGrid(); scheduleSave(); } }

async function deleteCurrentItem(isCtx = false) {

  const id = isCtx ? ctxCardId : selectedId; const item = DB.items.find(i => i.id === id); if (!item) return;
  if (!confirm(`确认将该档案彻底移入物理防丢回收站内？(文件将发生物理移位)`)) return;
  
  const trashObj = { id: uid(), type: 'item', data: item, deletedAt: Date.now() };
  if (dirHandle) await moveFs(dirHandle, getItemFolderPath(item), `已删除（回收站）/${sanitizeName(item.title)}_${item.id}`, false);
  
  DB.trash.push(trashObj); DB.items = DB.items.filter(i => i.id !== item.id);
  if(selectedId === id) selectedId = null;
  renderLibrary(); scheduleSave(); showToast('记录连带原图已安全封存在系统回收站内');
}

async function deleteShot(idx) {

  const item = DB.items.find(i => i.id === selectedId); if (!item) return;
  const shot = item.shots[idx];
  
  const trashObj = { id: uid(), type: 'shot', data: shot, originalItemId: item.id, originalTitle: item.title, deletedAt: Date.now() };
  if (dirHandle && shot.type !== 'reel') await moveFs(dirHandle, `${getItemFolderPath(item)}/${shotFileName(shot)}`, `已删除（回收站）/${shotTrashFileName(shot)}`, true);
  
  DB.trash.push(trashObj); item.shots.splice(idx, 1);
  if (item.shots.length > 0 && !item.shots.some(s => s.pinned)) item.shots[0].pinned = true;
  renderDetailPanel(); renderLibraryGrid(); scheduleSave(); showToast('该图片已移入回收站');
}

const SORT_LABELS = {
  'default': '排序方式', 'name-asc': '名字 A-Z', 'name-desc': '名字 Z-A',
  'count-desc': '数量：多→少', 'count-asc': '数量：少→多',
  'created-desc': '日期：新→旧', 'created-asc': '日期：旧→新',
  'recent': '最近使用优先'
};
function toggleSortDropdown(e) {
  e.stopPropagation();
  const dd = document.getElementById('sort-dropdown'); if (!dd) return;
  const isShown = dd.classList.contains('show');
  document.querySelectorAll('.ctx-menu').forEach(m => m.classList.remove('show'));
  if (!isShown) dd.classList.add('show');
}
function applySortMode(mode) {
  DB.settings.sortMode = mode;
  const lbl = document.getElementById('sort-btn-label'); if (lbl) lbl.textContent = SORT_LABELS[mode] || '排序方式';
  if(document.getElementById('sort-dropdown')) document.getElementById('sort-dropdown').classList.remove('show');
  scheduleSave(); renderLibraryGrid();
}
function sortItemsList(items, mode) {
  const arr = items.slice();
  switch (mode) {
    case 'name-asc': return arr.sort((a,b) => (a.title||'').localeCompare(b.title||'', 'zh'));
    case 'name-desc': return arr.sort((a,b) => (b.title||'').localeCompare(a.title||'', 'zh'));
    case 'count-desc': return arr.sort((a,b) => (b.shots||[]).length - (a.shots||[]).length);
    case 'count-asc': return arr.sort((a,b) => (a.shots||[]).length - (b.shots||[]).length);
    case 'created-desc': return arr.sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
    case 'created-asc': return arr.sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
    case 'recent': {
      const recentList = DB.recent || [];
      return arr.sort((a,b) => {
        const ia = recentList.indexOf(a.id), ib = recentList.indexOf(b.id);
        const ra = ia === -1 ? Infinity : ia, rb = ib === -1 ? Infinity : ib;
        return ra - rb;
      });
    }
    default: return arr;
  }
}

/* ═══════════════════════════════════════════════════════
   CONTEXT MENU ENGINE (全局右键菜单定位调度系统) ← 核心修复
═══════════════════════════════════════════════════════ */
function showContextMenu(e, menuId, id) {
  e.preventDefault();
  e.stopPropagation();
  // 先隐藏所有已展开的菜单
  document.querySelectorAll('.ctx-menu').forEach(m => m.classList.remove('show'));
  // 设置目标 ID 上下文
  if (menuId === 'ctx-cat' && id) ctxCatId = id;
  if (menuId === 'ctx-card' && id) { ctxCardImgId = id; ctxCardId = id; }
  // 修复：如果当前正停留在某个具体分类目录内，主界面空白处右键不再显示"新建分类目录"，
  // 只保留"登记全新素材"（并会智能预选当前目录，见 openAddModal），避免用户重复选择目录
  if (menuId === 'ctx-grid') {
    const newCatItem = document.querySelector('#ctx-grid .ctx-item[data-act="__h91"]');
    if (newCatItem) newCatItem.style.display = (currentFilter && currentFilter.type === 'category') ? 'none' : 'flex';
  }
  // 🆕 v1.3：九宫格右键菜单——多选时把"另存到桌面"文案换成"打包导出选中项(N)"，避免用户以为批量导出只能走顶部工具栏按钮
  if (menuId === 'ctx-nine') {
    const saveLabel = document.getElementById('ctx-nine-save-label');
    const isBatch = nineGridSelectedIds.size > 1 && nineGridSelectedIds.has(nineCtxCurrentIdx);
    if (saveLabel) {
      saveLabel.innerHTML = isBatch
        ? `<i class="ti ti-package"></i> 打包导出选中项 (${nineGridSelectedIds.size})`
        : `<i class="ti ti-download"></i> 将此图另存到桌面`;
    }
    // 复制剪贴板 / 设为封面 只支持单张操作，多选时隐藏这两项，避免误导
    const copyItem = document.getElementById('ctx-nine-copy-item');
    const pinItem = document.getElementById('ctx-nine-pin-item');
    if (copyItem) copyItem.style.display = isBatch ? 'none' : 'flex';
    if (pinItem) pinItem.style.display = isBatch ? 'none' : 'flex';
  }
  const menu = document.getElementById(menuId);
  if (!menu) return;
  // 先显示再定位（需要知道菜单尺寸）
  menu.classList.add('show');
  let x = e.clientX, y = e.clientY;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  // 防止菜单超出视口边界
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) menu.style.left = (x - r.width) + 'px';
    if (r.bottom > window.innerHeight - 8) menu.style.top = (y - r.height) + 'px';
  });
}

// 分类目录右键 → 修改名称
function ctxRename() {
  if(document.getElementById('ctx-cat')) document.getElementById('ctx-cat').classList.remove('show');
  const cat = DB.categories.find(c => c.id === ctxCatId);
  if (!cat) return;
  if(document.getElementById('cat-modal-title')) document.getElementById('cat-modal-title').textContent = '修改分类名称';
  if(document.getElementById('f-cat-name')) document.getElementById('f-cat-name').value = cat.name;
  if(document.getElementById('cat-modal')) document.getElementById('cat-modal').classList.add('show');
}

// 分类目录右键 → 强制删除
async function ctxDelete() {
  if(document.getElementById('ctx-cat')) document.getElementById('ctx-cat').classList.remove('show');
  const cat = DB.categories.find(c => c.id === ctxCatId);
  if (!cat) return;
  if (!confirm(`确认强制删除分类「${cat.name}」？\n该目录下的所有素材将降级为「未分类」状态，文件不会被删除。`)) return;
  const affectedCount = DB.items.filter(it => it.categoryId === ctxCatId).length;
  DB.items.forEach(it => { if (it.categoryId === ctxCatId) it.categoryId = ''; });
  DB.categories = DB.categories.filter(c => c.id !== ctxCatId);
  if (currentFilter.type === 'category' && currentFilter.value === ctxCatId) currentFilter = { type: 'all' };
  ctxCatId = null;
  scheduleSave(); renderLibrary(); showToast('✅ 分类目录已强制清除');
}

// 卡片右键 → 编辑属性
function cardCtxEdit() {
  if(document.getElementById('ctx-card')) document.getElementById('ctx-card').classList.remove('show');
  openEditModal(true);
}

/* ═══════════════════════════════════════════════════════
   IMPORT ENGINE (数据导入与图片粘贴系统)
═══════════════════════════════════════════════════════ */
function openImport() {
  if(document.getElementById('import-modal')) document.getElementById('import-modal').classList.add('show');
}

function triggerImportJSON() {
  const inp = document.getElementById('import-json-input');
  if(inp) inp.click();
}

function triggerImportWSJSON() {
  const inp = document.getElementById('import-ws-json-input');
  if(inp) inp.click();
}

async function handleImportJSON(e) {
  const file = e.target.files[0]; if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const itemCount = (data.items || []).length;
    const catCount = (data.categories || []).length;
    if (!confirm(`确认导入此 JSON 备份？\n检测到 ${itemCount} 条素材 / ${catCount} 个分类\n\n⚡ 已存在相同 ID 的记录将被自动跳过，安全合并。`)) {
      e.target.value = ''; return;
    }
    let newItems = 0, newCats = 0;
    if (Array.isArray(data.categories)) {
      data.categories.forEach(c => { if (!DB.categories.find(x => x.id === c.id)) { DB.categories.push(c); newCats++; } });
    }
    if (Array.isArray(data.items)) {
      data.items.forEach(it => { if (!DB.items.find(x => x.id === it.id)) { DB.items.unshift(it); newItems++; } });
    }
    e.target.value = '';
    if(document.getElementById('import-modal')) document.getElementById('import-modal').classList.remove('show');
    scheduleSave(); renderLibrary();
    showToast(`✅ 成功导入 ${newItems} 条素材、${newCats} 个分类`);
  } catch(err) {
    e.target.value = '';
    showToast('❌ JSON 文件解析失败：格式不匹配或文件已损坏', 'error');
  }
}

async function handleImportWSJSON(e) {
  const file = e.target.files[0]; if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.workspace) { e.target.value = ''; showToast('❌ 文件格式不正确，非工作台备份文件', 'error'); return; }
    if (!confirm('确认导入工作台备份？当前工作台数据将被此备份覆盖。')) { e.target.value = ''; return; }
    WS = Object.assign(WS, data.workspace);
    e.target.value = '';
    if(document.getElementById('import-modal')) document.getElementById('import-modal').classList.remove('show');
    scheduleSave();
    showToast('✅ 工作台数据已成功恢复');
  } catch(err) {
    e.target.value = '';
    showToast('❌ 工作台备份文件解析失败', 'error');
  }
}

// 全局监听 Ctrl+V 粘贴图片（选中素材后在主库界面直接生效）
document.addEventListener('paste', async (e) => {
  if (currentView !== 'lib' || !selectedId) return;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
  const clipItems = e.clipboardData ? Array.from(e.clipboardData.items) : [];
  const imgItems = clipItems.filter(i => i.type.startsWith('image/'));

  // 修复3：剪贴板粘贴的是纯文本链接时，直接写入"外部网址关联视频链接"栏位
  if (!imgItems.length) {
    const textItem = clipItems.find(i => i.type === 'text/plain');
    if (!textItem) return;
    textItem.getAsString(async (text) => {
      const v = (text || '').trim();
      if (!v || !/^https?:\/\//i.test(v)) return; // 不是链接格式则不处理，避免误吞普通文本粘贴
      const item = DB.items.find(i => i.id === selectedId); if (!item) return;
      if (isBlockedPlatform(v)) { showToast('❌ 该平台链接不支持关联', 'error'); return; }
      item.links = item.links || [];
      if (item.links.some(l => l.url === v)) { showToast('该链接已存在，未重复添加', 'warning'); return; }
      item.links.push({ url: v, name: extractNameFromUrl(v) });
      renderDetailPanel(); scheduleSave();
      showToast(`🔗 已将剪贴板链接关联到「${item.title}」`);
    });
    return;
  }
  e.preventDefault();

  // 核心要求：未连接本地文件夹，一律不允许保存/入库任何素材图片
  if (!dirHandle) { showToast('🚨 必须先连接本地文件夹，才能粘贴图片入库！', 'error'); return; }

  const item = DB.items.find(i => i.id === selectedId); if (!item) return;
  item.shots = item.shots || [];
  let count = 0;
  let seq = item.shots.filter(s => s.type !== 'reel').length + 1;

  for (const ci of imgItems) {
    const file = ci.getAsFile(); if (!file) continue;
    const sId = uid();
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const shot = { id: sId, ext, pinned: false, addedAt: Date.now() };

    // 强制写入物理文件（不再降级为 dataUrl 存入 JSON）
    try {
      const itemDir = await getDirHandleByPath(dirHandle, getItemFolderPath(item), true);
      const fName = buildShotFileName(item, shot, seq);
      const fh = await itemDir.getFileHandle(fName, { create: true });
      const w = await fh.createWritable(); await w.write(file); await w.close();
      shot.fileName = fName;
      item.shots.push(shot);
      setShotBlob(sId, file);
      count++; seq++;
    } catch(err) {}
  }

  if (count > 0) {
    if (!item.shots.some(s => s.pinned)) item.shots[0].pinned = true;
    renderDetailPanel(); renderLibraryGrid();
    // 实时刷新素材预览（九宫格）弹窗，无需手动重进
    if (document.getElementById('nine-grid-modal') && document.getElementById('nine-grid-modal').classList.contains('show') && currentNineGridItemId === item.id) {
      renderNineGrid(); updateNineGridToolbar();
    }
    scheduleSave();
    showToast(`📋 已粘贴 ${count} 张图片到「${item.title}」`);
  }
});

// 主库卡片缩略图右键四项操作处理器
async function handleCardImgCtx(action) {
  if(document.getElementById('ctx-card-img')) document.getElementById('ctx-card-img').classList.remove('show');
  if (!ctxCardImgId) return;
  const item = DB.items.find(x => x.id === ctxCardImgId);
  if (!item) return;
  
  // 取封面图（首选 pinned，否则第一张非 reel）
  const shot = (item.shots || []).find(s => s.pinned && s.type !== 'reel')
            || (item.shots || []).find(s => s.type !== 'reel');
  
  if (action === 'save') {
    if (!shot) return showToast('该素材暂无图片可保存', 'warning');
    const url = window.blobCache[shot.id] || shot.dataUrl;
    if (!url) return showToast('图片资源未能读取，请确保已连接硬盘', 'warning');
    const a = document.createElement('a');
    a.href = url; a.download = `${sanitizeName(item.title)}.${shot.ext || 'jpg'}`; a.click();
    showToast('✅ 封面图已下载');
  }
  
  if (action === 'copy') {
    if (!shot) return showToast('该素材暂无图片可复制', 'warning');
    const url = window.blobCache[shot.id] || shot.dataUrl;
    if (!url) return showToast('图片资源未能读取，请确保已连接硬盘', 'warning');
    try {
      const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url;
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        c.toBlob(b => navigator.clipboard.write([new ClipboardItem({'image/png': b})])
          .then(() => showToast('✅ 封面图已复制到剪贴板'))
          .catch(() => showToast('浏览器限制了剪贴板写入权限', 'error')));
      };
    } catch(e) { showToast('复制失败：' + e.message, 'error'); }
  }
  
  if (action === 'note') {
    // 选中该卡片并聚焦到备注编辑区
    selectItem(ctxCardImgId);
    setTimeout(() => {
      if (typeof startEditNote === 'function') startEditNote();
    }, 80);
  }

  if (action === 'share') {
    if (!shot) return showToast('该素材暂无图片可分享', 'warning');
    generateShareLink(shot, item.title);
  }

  if (action === 'shareAll') {
    shareWholeItem(item);
  }
  
  if (action === 'delete') {
    if (!confirm(`确认将「${item.title}」移入物理防丢回收站？`)) return;
    const trashObj = { id: uid(), type: 'item', data: item, deletedAt: Date.now() };
    if (dirHandle) await moveFs(dirHandle, getItemFolderPath(item), `已删除（回收站）/${sanitizeName(item.title)}_${item.id}`, false);
    DB.trash.push(trashObj); DB.items = DB.items.filter(i => i.id !== item.id);
    if (selectedId === ctxCardImgId) selectedId = null;
    ctxCardImgId = null;
    renderLibrary(); scheduleSave(); showToast('记录已移入回收站');
  }
}

/* ═══════════════════════════════════════════════════════
   VIEW 3: TRASH (物理防丢回收站)
═══════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   VIEW 4: ANALYTICS (全局数据透视分析中心)
═══════════════════════════════════════════════════════ */
function renderAnalytics() {
  const now = Date.now();
  // 1. 7天宏观脉冲柱状图生成
  const tArr = [], lArr = [];
  for (let i=6; i>=0; i--) {
    const s = now - i * 86400000; lArr.push(new Date(s).getDate() + '日');
    tArr.push(DB.items.filter(x => x.createdAt >= s && x.createdAt < s + 86400000).length);
  }
  const maxT = Math.max(...tArr, 1);
  const chartEl = document.getElementById('ana-trend-chart');
  if(chartEl) {
    chartEl.innerHTML = tArr.map((c, i) => `
      <div class="bar-col-wrap">
        <div class="bar-val" style="opacity:${c>0?1:0.3}">${c}</div>
        <div class="bar-col" style="height:${(c/maxT)*100}%"></div>
        <div class="bar-label">${lArr[i]}</div>
      </div>
    `).join('');
  }

  // 2. 社交阵营归属比进度条
  const pMap = { FB:0, IG:0, YT:0, PIN:0, WEB:0 };
  DB.items.forEach(i => (i.links||[]).forEach(l => pMap[detectPlatform(l.url).key]++));
  DB.accounts.forEach(a => pMap[detectPlatform(a.url).key]++);
  
  const maxP = Math.max(...Object.values(pMap), 1);
  const pCols = { FB:'#1E40AF', IG:'#9D174D', YT:'#991B1B', PIN:'#E60023', WEB:'#374151' };
  
  const platEl = document.getElementById('ana-plat-list');
  if(platEl) {
    platEl.innerHTML = Object.entries(pMap).sort((a,b)=>b[1]-a[1]).map(x => {
      if(x[1] === 0) return '';
      return `<div class="prog-row">
        <div class="prog-label" style="color:${pCols[x[0]]}">${x[0]}</div>
        <div class="prog-track"><div class="prog-fill" style="width:${(x[1]/maxP)*100}%; background:${pCols[x[0]]}"></div></div>
        <div class="prog-count">${x[1]} 弹</div>
      </div>`;
    }).join('');
  }

  // 3. 全星系热力标签地块
  const cMap = {};
  DB.items.forEach(i => {
    const cn = (DB.categories.find(c => c.id === i.categoryId) || {}).name || '被放逐地带(未分类)';
    cMap[cn] = (cMap[cn] || 0) + 1;
  });
  
  const maxC = Math.max(...Object.values(cMap), 1);
  const heatEl = document.getElementById('ana-heat-list');
  if(heatEl) {
    heatEl.innerHTML = Object.entries(cMap).sort((a,b)=>b[1]-a[1]).map(x => {
      const op = Math.max(0.1, x[1] / maxC);
      return `<div class="heat-tag" style="background:rgba(217, 48, 37, ${op}); color:${op > 0.4 ? '#fff' : 'var(--txdr)'}; border:1px solid ${op > 0.4 ? 'transparent' : 'var(--bds)'}">
        ${x[0]} <span style="font-size:10px; opacity:0.8;">(${x[1]})</span>
      </div>`;
    }).join('');
  }
}

/* ═══════════════════════════════════════════════════════
   VIEW 5: TRASH (黑洞物理回收站修复与控制)
═══════════════════════════════════════════════════════ */
function renderTrashView() {
  const grid = document.getElementById('trash-grid');
  const e = document.getElementById('trash-empty-state');
  if(!grid || !e) return;
  
  const allT = DB.trash.slice().sort((a,b) => b.deletedAt - a.deletedAt);
  if(document.getElementById('trash-count')) document.getElementById('trash-count').textContent = allT.length + ' 项残骸';
  
  if (allT.length === 0) { grid.innerHTML = ''; e.style.display = 'flex'; updateTrashToolbar(); return; }
  e.style.display = 'none';
  
  grid.innerHTML = allT.map(t => {
    let title, imgHtml;
    if (t.type === 'item') {
      title = `[卡片崩塌] ${t.data.title}`;
      const pinned = (t.data.shots||[]).find(s=>s.pinned) || (t.data.shots||[])[0];
      imgHtml = pinned ? getShotImgHtml(pinned, '') : `<i class="ti ti-layout-grid" style="font-size:40px;color:var(--txm)"></i>`;
    } else {
      title = `[细胞碎片] 脱离自母体: ${t.originalTitle}`;
      imgHtml = getShotImgHtml(t.data, '');
    }
    const isSelected = trashSelectedIds.has(t.id);
    
    return `<div class="card trash-card ${isSelected ? 'trash-sel selected' : ''}" data-id="${t.id}" data-act="__h118" data-evt="click" data-act-args="${JSON.stringify([t.id]).replace(/"/g, "&quot;")}">
      <div class="trash-cb-wrap"><input type="checkbox" class="tc-cb" ${isSelected ? 'checked' : ''} data-act="__h119" data-evt="click" data-act-args="${JSON.stringify([t.id]).replace(/"/g, "&quot;")}"></div>
      <div class="card-thumb" style="background:var(--s3)">${imgHtml}</div>
      <div class="card-body">
        <div class="card-title" style="color:var(--dr)" title="${title}">${title}</div>
        <div style="font-size:10px; color:var(--txm); margin-top:8px; border-top:1px dashed var(--bd); padding-top:6px;"><i class="ti ti-clock-x"></i> 处刑时间: ${new Date(t.deletedAt).toLocaleString()}</div>
      </div>
    </div>`;
  }).join('');
  updateTrashToolbar();
}

function updateTrashToolbar() {
  const count = trashSelectedIds.size;
  if(document.getElementById('trash-sel-count')) document.getElementById('trash-sel-count').textContent = `准星已对准锁定 ${count} 个尸骸`;
  const chk = document.getElementById('trash-select-all');
  if (chk) chk.checked = (count > 0 && count === DB.trash.length);
  
  document.querySelectorAll('.trash-card').forEach(c => {
    const id = c.dataset.id; const isSel = trashSelectedIds.has(id);
    c.classList.toggle('trash-sel', isSel); c.classList.toggle('selected', isSel);
    const cb = c.querySelector('.tc-cb'); if (cb) cb.checked = isSel;
  });
}

function toggleTrashSelect(id) {
  if (trashSelectedIds.has(id)) trashSelectedIds.delete(id);
  else trashSelectedIds.add(id);
  updateTrashToolbar();
}

function toggleTrashSelectAll() {
  const chk = document.getElementById('trash-select-all');
  if(!chk) return;
  trashSelectedIds.clear();
  if (chk.checked) { DB.trash.forEach(t => trashSelectedIds.add(t.id)); }
  updateTrashToolbar();
}

async function restoreSelectedTrash() {
  if (trashSelectedIds.size === 0) return showToast('请先勾选需要还原的项目','warning');
  for (const tid of Array.from(trashSelectedIds)) {
    const idx = DB.trash.findIndex(x => x.id === tid);
    if (idx !== -1) {
      const t = DB.trash[idx];
      if (t.type === 'item') {
        if (dirHandle) await moveFs(dirHandle, `已删除（回收站）/${sanitizeName(t.data.title)}_${t.data.id}`, getItemFolderPath(t.data), false);
        DB.items.unshift(t.data);
      } else if (t.type === 'shot') {
        const item = DB.items.find(i => i.id === t.originalItemId);
        if (item) {
          if (dirHandle && t.data.type !== 'reel') await moveFs(dirHandle, `已删除（回收站）/${shotTrashFileName(t.data)}`, `${getItemFolderPath(item)}/${shotFileName(t.data)}`, true);
          item.shots.push(t.data);
        } else { showToast(`该图片所属的素材已被永久删除，请先一并勾选对应的素材再一起还原`, 'error'); continue; }
      }
      DB.trash.splice(idx, 1);
    }
  }
  trashSelectedIds.clear(); scheduleSave(); renderSidebarStats(); renderTrashView(); showToast('✅ 已成功还原，数据已恢复');
}

// 🆕 v1.3：永久删除二次确认弹窗（替代浏览器原生 prompt），返回 Promise<boolean>
let _confirmDeleteResolve = null;
function openConfirmDeleteModal(count) {
  const textEl = document.getElementById('confirm-delete-text');
  if (textEl) textEl.textContent = `⚠️ 即将永久删除 ${count} 项内容，硬盘上的原始文件也会被一并彻底删除，此操作不可恢复！`;
  const inp = document.getElementById('confirm-delete-input');
  if (inp) inp.value = '';
  const modal = document.getElementById('confirm-delete-modal');
  if (modal) modal.classList.add('show');
  return new Promise((resolve) => { _confirmDeleteResolve = resolve; });
}
function cancelConfirmDeleteModal() {
  const modal = document.getElementById('confirm-delete-modal');
  if (modal) modal.classList.remove('show');
  if (_confirmDeleteResolve) { _confirmDeleteResolve(false); _confirmDeleteResolve = null; }
}
function confirmConfirmDeleteModal() {
  const inp = document.getElementById('confirm-delete-input');
  const typed = inp ? inp.value.trim() : '';
  if (typed !== '删除') { showToast('输入内容不匹配，请重新输入「删除」两个字', 'warning'); return; }
  const modal = document.getElementById('confirm-delete-modal');
  if (modal) modal.classList.remove('show');
  if (_confirmDeleteResolve) { _confirmDeleteResolve(true); _confirmDeleteResolve = null; }
}

async function permanentDeleteSelectedTrash() {
  if (trashSelectedIds.size === 0) return;
  const count = trashSelectedIds.size;
  // 不可逆的物理删除操作，要求手动输入"删除"二字确认，比单纯点确定按钮更安全，避免手滑误删物理文件
  const confirmed = await openConfirmDeleteModal(count);
  if (!confirmed) return;
  for (const tid of Array.from(trashSelectedIds)) {
    const idx = DB.trash.findIndex(x => x.id === tid);
    if (idx !== -1) {
      const t = DB.trash[idx];
      if (dirHandle) {
        try {
          const dDir = await getDirHandleByPath(dirHandle, '已删除（回收站）', false);
          if (dDir) {
            if (t.type === 'item') await dDir.removeEntry(`${sanitizeName(t.data.title)}_${t.data.id}`, { recursive: true }).catch(() => { });
            else if (t.data.type !== 'reel') await dDir.removeEntry(shotTrashFileName(t.data)).catch(() => { });
          }
        } catch (e) { }
      }
      // 修复：彻底删除时同步释放内存中的 Object URL，避免 blobCache 泄漏
      if (t.type === 'item') revokeItemBlobs(t.data); else revokeShotBlob(t.data.id);
      DB.trash.splice(idx, 1);
    }
  }
  trashSelectedIds.clear(); scheduleSave(); renderSidebarStats(); renderTrashView(); showToast('✅ 已彻底删除，物理空间已释放');
}

/* ═══════════════════════════════════════════════════════
   NINE GRID MODAL (高定无框画廊连选系统)
═══════════════════════════════════════════════════════ */
function openNineGridModal(itemId) {
  const items = DB.items;
  const item = items.find(i => i.id === itemId); if (!item) return;
  
  currentNineGridItemId = itemId;
  nineGridSelectedIds.clear(); nineLastClickedIdx = -1; nineCtxCurrentIdx = -1;
  ensureDefaults();
  
  const total = (item.shots || []).filter(s => s.type !== 'reel').length;
  if(document.getElementById('nine-title')) document.getElementById('nine-title').textContent = `${item.title}`;
  
  if(document.getElementById('nine-col-quick')) document.getElementById('nine-col-quick').value = DB.settings.nineCols;
  if(document.getElementById('nine-rat-quick')) document.getElementById('nine-rat-quick').value = DB.settings.nineRatio;
  
  updateNineGridToolbar();
  if(document.getElementById('nine-grid-modal')) document.getElementById('nine-grid-modal').classList.add('show');
  renderNineGrid();
}

// 无框复选与 Shift 区间连选核心引擎
function handleNineItemClick(idx, event) {
  if (event.button !== 0) return; // 限定只响应鼠标左键，规避右键弹出菜单导致的选中混乱
  
  // Shift 区间连选魔法框架
  if (event.shiftKey && nineLastClickedIdx !== -1) {
    const min = Math.min(idx, nineLastClickedIdx);
    const max = Math.max(idx, nineLastClickedIdx);
    const items = DB.items;
    const item = items.find(i => i.id === currentNineGridItemId);
    if(item) {
        for (let i = min; i <= max; i++) { if (item.shots[i].type !== 'reel') nineGridSelectedIds.add(i); }
    }
  } else {
    // 正常单击反转选中状态
    if (nineGridSelectedIds.has(idx)) nineGridSelectedIds.delete(idx);
    else nineGridSelectedIds.add(idx);
    nineLastClickedIdx = idx;
  }
  
  renderNineGrid(); updateNineGridToolbar();
}

function toggleNineSelectAll() {
  const items = DB.items;
  const item = items.find(i => i.id === currentNineGridItemId); if (!item) return;
  
  const valids = item.shots.map((s, i) => s.type !== 'reel' ? i : -1).filter(i => i !== -1);
  if (nineGridSelectedIds.size === valids.length) nineGridSelectedIds.clear();
  else valids.forEach(i => nineGridSelectedIds.add(i));
  
  renderNineGrid(); updateNineGridToolbar();
}

// 绑定最高优先级的 Ctrl+A / Cmd+A 快捷键全局监听
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    if (document.getElementById('nine-grid-modal') && document.getElementById('nine-grid-modal').classList.contains('show')) {
      e.preventDefault(); toggleNineSelectAll();
    }
  }
  // 修复建议14：纯键盘操作补充方案 —— 恰好选中一张图片时，Ctrl+方向键 可以左右移动它的位置，不依赖鼠标拖拽
  if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const modalOpen = document.getElementById('nine-grid-modal') && document.getElementById('nine-grid-modal').classList.contains('show');
    if (modalOpen && nineGridSelectedIds.size === 1) {
      e.preventDefault();
      const item = DB.items.find(i => i.id === currentNineGridItemId); if (!item) return;
      const curIdx = Array.from(nineGridSelectedIds)[0];
      const targetIdx = e.key === 'ArrowLeft' ? curIdx - 1 : curIdx + 1;
      if (targetIdx < 0 || targetIdx >= item.shots.length) return;
      const [moved] = item.shots.splice(curIdx, 1);
      item.shots.splice(targetIdx, 0, moved);
      nineGridSelectedIds.clear(); nineGridSelectedIds.add(targetIdx);
      renderNineGrid(); updateNineGridToolbar(); scheduleSave();
    }
  }
});

function updateNineGridToolbar() {
  if(document.getElementById('nine-sel-count')) document.getElementById('nine-sel-count').textContent = nineGridSelectedIds.size;
  const items = DB.items;
  const item = items.find(i => i.id === currentNineGridItemId);
  const valids = item ? item.shots.map((s, i) => s.type !== 'reel' ? i : -1).filter(i => i !== -1) : [];
  
  // 共 X 张的总数同步刷新（上传/删除图片后都会调用本函数）
  if(document.getElementById('nine-total-count')) document.getElementById('nine-total-count').textContent = valids.length;
  
  const isAll = nineGridSelectedIds.size > 0 && nineGridSelectedIds.size === valids.length;
  if(document.getElementById('btn-nine-select-all')) {
      document.getElementById('btn-nine-select-all').innerHTML = isAll ? `<i class="ti ti-x"></i> 取消全选` : `<i class="ti ti-checks"></i> 全选`;
  }
}

let nineViewMode = 'grid';
let nineDragSrcIdx = null;
let nineDragIds = []; // 修复4：拖拽的一批 shot.id（支持多选批量拖拽排序）

function toggleNineViewMode() {
  nineViewMode = nineViewMode === 'grid' ? 'mindmap' : 'grid';
  const btn = document.getElementById('btn-nine-view-mode');
  if (btn) btn.innerHTML = nineViewMode === 'mindmap' ? '<i class="ti ti-layout-grid"></i> 网格视图' : '<i class="ti ti-sitemap"></i> 思维导图';
  const colWrap = document.getElementById('nine-col-wrap'), ratWrap = document.getElementById('nine-rat-wrap');
  if (colWrap) colWrap.style.display = nineViewMode === 'mindmap' ? 'none' : 'flex';
  if (ratWrap) ratWrap.style.display = nineViewMode === 'mindmap' ? 'none' : 'flex';
  renderNineGrid();
}

function nineDragStart(idx, e) {
  const item = (DB.items).find(i => i.id === currentNineGridItemId);
  if (item && nineGridSelectedIds.has(idx)) {
    // 拖动的是已选中的一张：把当前所有选中项作为一个整体一起拖动，实现批量排序
    nineDragIds = Array.from(nineGridSelectedIds).map(i => item.shots[i] && item.shots[i].id).filter(Boolean);
  } else {
    nineDragIds = (item && item.shots[idx]) ? [item.shots[idx].id] : [];
  }
  nineDragSrcIdx = idx; e.dataTransfer.effectAllowed = 'move'; e.target.classList.add('nine-dragging');
}
function nineDragEnd(e) { e.target.classList.remove('nine-dragging'); nineDragSrcIdx = null; nineDragIds = []; }
function nineDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
function nineDrop(idx, e) {
  e.preventDefault();
  const item = DB.items.find(i => i.id === currentNineGridItemId);
  if (!item || !nineDragIds.length) { nineDragSrcIdx = null; nineDragIds = []; return; }
  const targetShot = item.shots[idx];
  if (!targetShot || nineDragIds.includes(targetShot.id)) { nineDragSrcIdx = null; nineDragIds = []; return; }

  // 以 shot.id 为准做整体块状搬移，避免多选拖拽时索引在过程中错位
  const draggedSet = new Set(nineDragIds);
  const draggedShots = item.shots.filter(s => draggedSet.has(s.id));
  const remaining = item.shots.filter(s => !draggedSet.has(s.id));
  const targetIdx = remaining.findIndex(s => s.id === targetShot.id);
  if (targetIdx === -1) { nineDragSrcIdx = null; nineDragIds = []; return; }
  remaining.splice(targetIdx, 0, ...draggedShots);
  item.shots = remaining;

  nineDragSrcIdx = null; nineDragIds = [];
  nineGridSelectedIds.clear();
  renderNineGrid(); updateNineGridToolbar(); renderDetailPanel(); scheduleSave();
  showToast('✅ 已调整图片顺序');
}

function renderNineGrid() {
  const items = DB.items;
  const item = items.find(i => i.id === currentNineGridItemId); if (!item) return;
  
  const container = document.getElementById('nine-container');
  if(!container) return;

  const visibleShots = (item.shots || []).filter(s => s.type !== 'reel');
  
  // 无图片时显示空状态提示
  if (visibleShots.length === 0) {
    container.style.gridTemplateColumns = '1fr';
    container.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;color:var(--txm);gap:14px;">
      <i class="ti ti-photo-off" style="font-size:56px;opacity:0.35;"></i>
      <p style="font-size:13px;text-align:center;line-height:1.7;">该素材暂无任何图片<br>可在右侧面板上传，或直接按 <strong style="color:var(--tx)">Ctrl+V</strong> 粘贴图片</p>
      <button class="btn primary" style="height:34px;" data-act="__h120" data-evt="click" data-act-args="[]"><i class="ti ti-upload"></i> 立即上传图片</button>
    </div>`;
    return;
  }

  if (nineViewMode === 'mindmap') { container.classList.add('nine-container-mindmap'); renderNineMindmap(item, container); return; }
  container.classList.remove('nine-container-mindmap');
  
  container.style.gridTemplateColumns = `repeat(${DB.settings.nineCols}, 1fr)`;
  
  let styleStr = '';
  if (DB.settings.nineRatio !== 'auto') { try { const p = DB.settings.nineRatio.split('/'); styleStr = `aspect-ratio: ${(parseFloat(p[0]) / parseFloat(p[1])).toFixed(4)};`; } catch(e){} }
  
  container.innerHTML = (item.shots || []).map((s, idx) => {
    if (s.type === 'reel') return ''; // 九宫格矩阵中绝不显示纯视频卡片
    const isSel = nineGridSelectedIds.has(idx);
    
    return `<div class="nine-item ${isSel ? 'nine-selected' : ''}" style="${styleStr}" draggable="true"
      data-act="__h121" data-evt="mousedown" data-act-args="${JSON.stringify([idx]).replace(/"/g, "&quot;")}" 
      data-act2="__h122" data-evt2="dragstart" data-act-args2="${JSON.stringify([idx]).replace(/"/g, "&quot;")}" data-act3="__h123" data-evt3="dragend" data-act-args3="[]" data-act4="__h124" data-evt4="dragover" data-act-args4="[]" data-act5="__h125" data-evt5="drop" data-act-args5="${JSON.stringify([idx]).replace(/"/g, "&quot;")}"
      data-act6="__h126" data-evt6="contextmenu" data-act-args6="${JSON.stringify([idx]).replace(/"/g, "&quot;")}">
      
      ${getShotImgHtml(s, 'width:100%;height:100%;object-fit:cover; pointer-events:none;')}
      <div class="nine-zoom-hint" data-act="__h127" data-evt="mousedown" data-act-args="[]" data-act2="__h128" data-evt2="click" data-act-args2="${JSON.stringify([item.id, idx]).replace(/"/g, "&quot;")}" title="点击大图预览"><i class="ti ti-zoom-in"></i></div>
      <div class="nine-sel-icon"><i class="ti ti-check"></i></div>
      
      ${s.pinned ? `<div class="nine-badge-cover"><i class="ti ti-star"></i> 首选核心门面</div>` : ''}
      ${s.note ? `<div class="nine-note-bar"><i class="ti ti-message-2"></i> ${s.note}</div>` : ''}
    </div>`;
  }).join('');
}

// 思维导图展示模式：中间为封面图，左右两侧按日期分组展示上传批次
function renderNineMindmap(item, container) {
  container.style.gridTemplateColumns = '1fr';
  const shotsWithIdx = (item.shots || []).map((s, idx) => ({ s, idx })).filter(x => x.s.type !== 'reel');
  
  // 按日期分组
  const groups = {};
  shotsWithIdx.forEach(({ s, idx }) => {
    const d = dateStr8(s.addedAt || Date.now());
    if (!groups[d]) groups[d] = [];
    groups[d].push({ s, idx });
  });
  const dateKeys = Object.keys(groups).sort();
  
  const coverEntry = shotsWithIdx.find(x => x.s.pinned) || shotsWithIdx[0];
  const coverSrc = coverEntry ? getShotSrc(coverEntry.s) : '';
  
  const renderNode = (dateKey) => {
    const list = groups[dateKey];
    const visible = list.slice(0, 6);
    const extra = list.length - visible.length;
    const dLabel = `${dateKey.slice(0,4)}-${dateKey.slice(4,6)}-${dateKey.slice(6,8)}`;
    return `<div class="mindmap-node">
      <div class="mindmap-node-date"><i class="ti ti-calendar-event"></i> ${dLabel} · 共 ${list.length} 张</div>
      <div class="mindmap-thumbs">
        ${visible.map(({s, idx}) => `<div class="mindmap-thumb" data-act="__h129" data-evt="click" data-act-args="${JSON.stringify([item.id, idx]).replace(/"/g, "&quot;")}" title="点击预览">${getShotImgHtml(s, 'width:100%;height:100%;object-fit:cover;')}</div>`).join('')}
        ${extra > 0 ? `<div class="mindmap-thumb more">+${extra}</div>` : ''}
      </div>
    </div>`;
  };
  
  const leftKeys = dateKeys.filter((_, i) => i % 2 === 0);
  const rightKeys = dateKeys.filter((_, i) => i % 2 === 1);
  
  container.innerHTML = `<div class="mindmap-wrap">
    <div class="mindmap-col left">${leftKeys.map(renderNode).join('')}</div>
    <div class="mindmap-center">
      <div class="mindmap-spine"></div>
      ${coverSrc ? `<img class="mindmap-center-img" src="${coverSrc}">` : `<div class="mindmap-center-img" style="width:280px;height:280px;display:flex;align-items:center;justify-content:center;"><i class="ti ti-photo" style="font-size:40px;color:var(--txm)"></i></div>`}
      <div class="mindmap-center-label">${item.title}</div>
    </div>
    <div class="mindmap-col right">${rightKeys.map(renderNode).join('')}</div>
  </div>`;
}

function closeNineGridModal() { if(document.getElementById('nine-grid-modal')) document.getElementById('nine-grid-modal').classList.remove('show'); }

// 画廊单图独立右键暗网系统控制台
async function handleNineCtx(action) {
  if(document.getElementById('ctx-nine')) document.getElementById('ctx-nine').classList.remove('show');

  const item = DB.items.find(x => x.id === currentNineGridItemId);
  if (!item || nineCtxCurrentIdx === -1) return;
  
  const shot = item.shots[nineCtxCurrentIdx];
  // 若当前右键点击的图片本身在多选范围内，且多选数量 > 1，则视为"批量操作"
  const isBatch = nineGridSelectedIds.size > 1 && nineGridSelectedIds.has(nineCtxCurrentIdx);
  const targetIdxs = isBatch ? Array.from(nineGridSelectedIds) : [nineCtxCurrentIdx];
  
  if (action === 'delete') {
    for (const idx of targetIdxs.slice().sort((a,b)=>b-a)) {
      const s = item.shots[idx]; if (!s || s.type === 'reel') continue;
      if (dirHandle) await moveFs(dirHandle, `${getItemFolderPath(item)}/${shotFileName(s)}`, `已删除（回收站）/${shotTrashFileName(s)}`, true);
      DB.trash.push({ id: uid(), type: 'shot', data: s, originalItemId: item.id, originalTitle: item.title, deletedAt: Date.now() });
      item.shots.splice(idx, 1);
    }
    if (item.shots.length && !item.shots.some(x => x.pinned)) item.shots[0].pinned = true;
    nineGridSelectedIds.clear();
    
    scheduleSave(); renderNineGrid(); updateNineGridToolbar(); renderDetailPanel(); renderLibraryGrid();
    showToast(isBatch ? `✅ 已批量移入回收站，共 ${targetIdxs.length} 张` : '✅ 该图片已移入回收站');
  }
  
  if (action === 'pin') {
    setPinnedShotAndReorder(item, nineCtxCurrentIdx);
    nineGridSelectedIds.clear(); nineCtxCurrentIdx = -1; // 数组顺序已变化，清空索引缓存避免后续误选
    scheduleSave(); renderNineGrid(); renderDetailPanel(); renderLibraryGrid();
    showToast('⭐ 已设为该素材的专属封面');
  }
  
  if (action === 'note') {
    openShotNoteModal(item.id, shot.id);
  }

  if (action === 'share') {
    if (isBatch) { shareSelectedShots(item, targetIdxs); return; }
    generateShareLink(shot, item.title);
  }
  
  if (action === 'save') {
    if (isBatch) {
      showToast(`📦 正在打包 ${targetIdxs.length} 张图片...`, 'success');
      try {
        const zip = new JSZip();
        let fc = 0;
        for (const idx of targetIdxs) {
          const s = item.shots[idx]; if (!s || s.type === 'reel') continue;
          const url = window.blobCache[s.id] || s.dataUrl; if (!url) continue;
          const resp = await fetch(url); const blob = await resp.blob();
          zip.file(`${sanitizeName(item.title)}_${fc+1}.${s.ext||'jpg'}`, blob); fc++;
        }
        const content = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(content); a.download = `${sanitizeName(item.title)}-${dateStr8(Date.now())}.zip`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      } catch(e) { showToast('打包失败：' + e.message, 'error'); }
    } else {
      const url = window.blobCache[shot.id] || shot.dataUrl;
      if (url) { const a = document.createElement('a'); a.href = url; a.download = `${sanitizeName(item.title)}_单独切面提取备份.${shot.ext || 'jpg'}`; a.click(); }
    }
  }
  
  if (action === 'copy') {
    try {
      const clipItems = [];
      const failedSeqs = []; // 修复建议13：记录复制失败的具体张数，而不是只说成功了几张
      let seq = 0;
      for (const idx of targetIdxs) {
        seq++;
        const s = item.shots[idx]; if (!s || s.type === 'reel') continue;
        const url = window.blobCache[s.id] || s.dataUrl; if (!url) { failedSeqs.push(seq); continue; }
        const blob = await new Promise((resolve) => {
          const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url;
          img.onload = () => {
            const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
            c.getContext('2d').drawImage(img, 0, 0);
            c.toBlob(b => resolve(b));
          };
          img.onerror = () => resolve(null);
        });
        if (blob) clipItems.push(new ClipboardItem({'image/png': blob})); else failedSeqs.push(seq);
      }
      if (!clipItems.length) return showToast('未能读取到有效图片数据', 'error');
      await navigator.clipboard.write(clipItems);
      let msg = clipItems.length > 1 ? `✅ 已将 ${clipItems.length} 张图片复制到系统剪贴板` : '✅ 已复制到系统剪贴板';
      if (failedSeqs.length) msg += `（其中第 ${failedSeqs.join('、')} 张读取失败，未能复制）`;
      showToast(msg, failedSeqs.length ? 'warning' : 'success');
    } catch(e) { showToast('浏览器安全限制导致复制失败，可以尝试右键另存图片', 'error'); }
  }
}

// 批量导出 ZIP 包引擎
async function exportNineGridSelected() {
  if (nineGridSelectedIds.size === 0) return showToast('请先选中需要打包的图片', 'warning');
  const items = DB.items;
  const item = items.find(i => i.id === currentNineGridItemId); if (!item) return;
  
  showToast(`📦 正在打包 ${nineGridSelectedIds.size} 张图片，请稍候...`, 'success');
  
  try {
    const zip = new JSZip();
    const now = new Date();
    const dateStr = `${pad2(now.getMonth()+1)}${pad2(now.getDate())}`;
    const zipName = `${sanitizeName(item.title)}-${dateStr}.zip`;
    
    let fileCount = 0;
    for (const idx of nineGridSelectedIds) {
      const shot = item.shots[idx];
      if (!shot || shot.type === 'reel') continue;
      const url = window.blobCache[shot.id] || shot.dataUrl;
      if (!url) continue;
      
      try {
        let blob;
        if (url.startsWith('blob:')) {
          const resp = await fetch(url);
          blob = await resp.blob();
        } else if (url.startsWith('data:')) {
          const arr = url.split(','); const mime = arr[0].match(/:(.*?);/)[1];
          const bStr = atob(arr[1]); const n = bStr.length;
          const u8 = new Uint8Array(n); for(let k=0;k<n;k++) u8[k]=bStr.charCodeAt(k);
          blob = new Blob([u8], {type: mime});
        } else continue;
        
        const ext = shot.ext || 'jpg';
        zip.file(`${sanitizeName(item.title)}_${fileCount+1}.${ext}`, blob);
        fileCount++;
      } catch(e) {}
    }
    
    if (fileCount === 0) return showToast('未能读取到有效图片数据', 'error');
    
    const content = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(content); a.download = zipName; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    
    nineGridSelectedIds.clear(); renderNineGrid(); updateNineGridToolbar();
    showToast(`✅ 已打包 ${fileCount} 张图片 → ${zipName}`);
  } catch(e) {
    showToast('打包失败：' + e.message, 'error');
  }
}

// 🆕 v1.3：九宫格工具栏"分享所选"按钮入口（等价于多选后右键→生成分享链接）
function shareNineGridSelected() {
  const item = DB.items.find(i => i.id === currentNineGridItemId); if (!item) return;
  if (nineGridSelectedIds.size === 0) return showToast('请先选中需要分享的图片', 'warning');
  shareSelectedShots(item, Array.from(nineGridSelectedIds));
}

/* ═══════════════════════════════════════════════════════
   LIGHTBOX (单图极致沉浸放大系统)
═══════════════════════════════════════════════════════ */
function openGallery(itemId, idx) {
  const items = DB.items;
  const item = items.find(i => i.id === itemId); if (!item) return;
  galleryShots = (item.shots || []).filter(s => s.type !== 'reel'); // 排掉视频废件不渲染
  if (galleryShots.length === 0) return;
  
  // 修正点击的序号偏移（由于踢出了视频产生的底层数组索引差异）
  const rawShot = item.shots[idx];
  galleryIndex = galleryShots.findIndex(s => s.id === rawShot.id);
  if (galleryIndex === -1) galleryIndex = 0;
  
  renderLightbox(); if(document.getElementById('lightbox')) document.getElementById('lightbox').classList.add('show');
}

function renderLightbox() {
  const s = galleryShots[galleryIndex]; if (!s) return;
  if(document.getElementById('lightbox-img')) document.getElementById('lightbox-img').src = window.blobCache[s.id] || s.dataUrl || '';
  if(document.getElementById('lightbox-counter')) document.getElementById('lightbox-counter').textContent = `${galleryIndex + 1} / ${galleryShots.length}`;
  if(document.getElementById('lightbox-strip')) {
      document.getElementById('lightbox-strip').innerHTML = galleryShots.map((shot, i) => `<div class="lb-strip-thumb ${i === galleryIndex ? 'active' : ''}" data-act="__h130" data-evt="click" data-act-args="${JSON.stringify([i]).replace(/"/g, "&quot;")}">${getShotImgHtml(shot, 'width:100%;height:100%;object-fit:cover; pointer-events:none;')}</div>`).join('');
  }
}

function navGallery(dir, e) { if(e) e.stopPropagation(); if (galleryShots.length) { galleryIndex = (galleryIndex + dir + galleryShots.length) % galleryShots.length; renderLightbox(); } }
function closeLightbox() { if(document.getElementById('lightbox')) document.getElementById('lightbox').classList.remove('show'); }

document.addEventListener('click', e => { 
  if(e.target.id === 'lightbox') closeLightbox(); 
  document.querySelectorAll('.ctx-menu').forEach(m => m.classList.remove('show')); 
});

/* ═══════════════════════════════════════════════════════
   MODALS: ADD / EDIT / CATEGORY LOGIC
═══════════════════════════════════════════════════════ */
function openAddModal() {
  if (!dirHandle) { showToast('🚨 必须先连接本地文件夹，才能新增素材档案！', 'error'); return; }
  editingItemId = null; formTags = [];
  if(document.getElementById('f-title')) document.getElementById('f-title').value = ''; 
  // 智能识别：如果当前正停留在某个具体分类目录里，新增素材时自动预选该分类，无需重复手动选择
  const smartCatId = (currentFilter && currentFilter.type === 'category') ? currentFilter.value : '';
  selectCategoryOption(smartCatId);
  if(document.getElementById('add-modal-title')) document.getElementById('add-modal-title').innerHTML = '新增素材档案';
  renderFormTags(); if(document.getElementById('add-modal')) document.getElementById('add-modal').classList.add('show');
}

function openEditModal(isCtx = false) {
  const id = isCtx ? ctxCardId : selectedId; const it = DB.items.find(x => x.id === id); if (!it) return;
  editingItemId = it.id; formTags = [...(it.tags || [])];
  
  if(document.getElementById('f-title')) document.getElementById('f-title').value = it.title;
  selectCategoryOption(it.categoryId || '');
  if(document.getElementById('add-modal-title')) document.getElementById('add-modal-title').innerHTML = '编辑素材属性';
  renderFormTags(); if(document.getElementById('add-modal')) document.getElementById('add-modal').classList.add('show');
}
function closeItemModal() { if(document.getElementById('add-modal')) document.getElementById('add-modal').classList.remove('show'); const l = document.getElementById('f-category-list'); if (l) l.classList.remove('show'); }

function renderFormTags() {
  const wrap = document.getElementById('tag-input-wrap'); if(!wrap) return;
  Array.from(wrap.querySelectorAll('.tag-chip')).forEach(e => e.remove());
  formTags.forEach((t, i) => {
    const d = document.createElement('div'); d.className = 'tag-chip';
    d.innerHTML = `${t} <i class="ti ti-x tag-chip-del" data-act="__h131" data-evt="click" data-act-args="${JSON.stringify([i]).replace(/"/g, "&quot;")}"></i>`;
    wrap.insertBefore(d, document.getElementById('tag-text-input'));
  });
}
if(document.getElementById('tag-text-input')) document.getElementById('tag-text-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault(); const v = e.target.value.trim().replace(/,$/, '');
    if (v && !formTags.includes(v)) { formTags.push(v); renderFormTags(); }
    e.target.value = '';
  }
});

// 素材改名时使用：不仅把物理文件夹改名，还把文件夹内每张图片的文件名前缀也同步改成新标题，
// 保证在文件管理器里手动查看时，文件夹名和里面的文件名都是一致的最新标题
async function renameItemFolderWithFiles(item, oldPath, newPath) {
  const sParts = oldPath.split('/'); const sName = sParts.pop();
  const sDir = await getDirHandleByPath(dirHandle, sParts.join('/'), false); if (!sDir) return false;
  const dParts = newPath.split('/'); const dName = dParts.pop();
  const dParentDir = await getDirHandleByPath(dirHandle, dParts.join('/'), true); if (!dParentDir) return false;
  try {
    const srcHandle = await sDir.getDirectoryHandle(sName);
    const destHandle = await dParentDir.getDirectoryHandle(dName, { create: true });
    let seq = 0;
    for (const shot of item.shots || []) {
      if (shot.type === 'reel') continue;
      seq++;
      const oldFName = shotFileName(shot);
      let fh;
      try { fh = await srcHandle.getFileHandle(oldFName); } catch(e) { continue; } // 找不到对应原文件就跳过，不阻断整体流程
      const file = await fh.getFile();
      const newFName = buildShotFileName(item, shot, seq); // 此时 item.title 已经是新标题，文件名会自动带上新前缀
      const w = await (await destHandle.getFileHandle(newFName, { create: true })).createWritable();
      await w.write(file); await w.close();
      shot.fileName = newFName;
    }
    await sDir.removeEntry(sName, { recursive: true }).catch(() => {});
    return true;
  } catch(e) { return false; }
}

async function saveItemModal() {
  const tEl = document.getElementById('f-title');
  const t = tEl ? tEl.value.trim() : ''; if (!t) return showToast('标题必填', 'error');
  const cId = document.getElementById('f-category') ? document.getElementById('f-category').value : '';
  
  if (isDuplicateItemTitle(t, cId, editingItemId)) {
    return showToast(`❌ 该分类下已存在同名素材「${t}」，请更换一个名称`, 'error');
  }
  
  if (editingItemId) {
    const it = DB.items.find(x => x.id === editingItemId);
    pushUndoSnapshot(editingItemId, '编辑素材信息'); // 修复建议4：编辑前记录撤销快照
    const oldPath = getItemFolderPath(it);
    const prevTitle = it.title, prevCat = it.categoryId;
    const prevFileNames = (it.shots || []).map(s => s.fileName); // 用于搬迁失败时回滚文件名
    const titleChanged = it.title !== t;
    it.title = t; it.categoryId = cId; it.tags = [...formTags];
    const newPath = getItemFolderPath(it);
    if (dirHandle && oldPath !== newPath) {
      // 标题变了：连文件夹内每张图片的文件名前缀也一起同步改新；只是换分类目录：单纯搬迁文件夹即可，不用碰文件名
      const ok = titleChanged
        ? await renameItemFolderWithFiles(it, oldPath, newPath)
        : await moveFs(dirHandle, oldPath, newPath, false);
      if (!ok) {
        // 物理搬迁失败：回滚素材标题/分类/文件名，避免数据库与硬盘路径脱节导致图片"损坏"
        it.title = prevTitle; it.categoryId = prevCat;
        (it.shots || []).forEach((s, i) => { s.fileName = prevFileNames[i]; });
        showToast('❌ 物理文件夹搬迁失败，素材修改未生效，请检查硬盘权限后重试', 'error');
        return;
      }
      // 立即固化保存，避免防抖延迟期间刷新/断电导致物理路径与数据库记录不一致
      await saveToFolder();
      await preloadImageBlobs();
    }
  } else {
    if (!dirHandle) { showToast('🚨 必须先连接本地文件夹，才能保存新素材！', 'error'); return; }
    const it = { id: uid(), title: t, categoryId: cId, tags: [...formTags], links: [], shots: [], createdAt: Date.now() };
    DB.items.unshift(it); selectedId = it.id;
    await getDirHandleByPath(dirHandle, getItemFolderPath(it), true);
  }
  closeItemModal(); switchView('lib'); scheduleSave();

  // 修复建议11：同分类内已阻止重名，这里针对"跨分类同名"给一个不阻断操作的轻提示，避免用户混淆到底是哪一个
  const sameNameElsewhere = DB.items.some(it => it.id !== editingItemId && it.categoryId !== cId && (it.title||'').trim().toLowerCase() === t.toLowerCase());
  if (sameNameElsewhere) showToast(`ℹ️ 提示：其他分类下也存在同名素材「${t}」，注意区分`, 'warning');
}

let quickAddCategoryTarget = false;
// 修复：自定义分类下拉选择器逻辑（原生 select 的下拉列表高度无法可靠跨浏览器控制，改用自定义列表）
function toggleCategoryDropdown() {
  const list = document.getElementById('f-category-list'); if (!list) return;
  list.classList.toggle('show');
}
function renderCategoryDropdown(selectedId) {
  const list = document.getElementById('f-category-list'); if (!list) return;
  const options = [{ id: '', name: '无分类归属' }, ...DB.categories, { id: '__new_category__', name: '+ 新建目录…' }];
  list.innerHTML = options.map(c => `<div class="custom-select-option${c.id === (selectedId || '') ? ' active' : ''}" data-act="__h132" data-evt="click" data-act-args="${JSON.stringify([c.id]).replace(/"/g, "&quot;")}">${c.name}</div>`).join('');
}
function selectCategoryOption(id) {
  if (id === '__new_category__') {
    document.getElementById('f-category-list').classList.remove('show');
    handleCategorySelectChange({ value: '__new_category__' });
    return;
  }
  if(document.getElementById('f-category')) document.getElementById('f-category').value = id;
  const cat = DB.categories.find(c => c.id === id);
  if(document.getElementById('f-category-trigger-text')) document.getElementById('f-category-trigger-text').textContent = cat ? cat.name : '无分类归属';
  const list = document.getElementById('f-category-list'); if (list) { list.classList.remove('show'); renderCategoryDropdown(id); }
}
document.addEventListener('click', e => {
  const wrap = document.getElementById('f-category-wrap');
  if (wrap && !wrap.contains(e.target)) { const l = document.getElementById('f-category-list'); if (l) l.classList.remove('show'); }
});
function handleCategorySelectChange(sel) {
  if (sel.value === '__new_category__') {
    const revertId = editingItemId ? (DB.items.find(x=>x.id===editingItemId)||{}).categoryId||'' : '';
    if(document.getElementById('f-category')) document.getElementById('f-category').value = revertId;
    const cat = DB.categories.find(c => c.id === revertId);
    if(document.getElementById('f-category-trigger-text')) document.getElementById('f-category-trigger-text').textContent = cat ? cat.name : '无分类归属';
    openAddCategoryModal(true);
  }
}
function openAddCategoryModal(fromQuickAdd = false) {
  if (!dirHandle) { showToast('🚨 必须先连接本地文件夹，才能新建分类目录！', 'error'); return; }
  ctxCatId = null; quickAddCategoryTarget = fromQuickAdd; if(document.getElementById('f-cat-name')) document.getElementById('f-cat-name').value = ''; if(document.getElementById('cat-modal')) document.getElementById('cat-modal').classList.add('show'); }
async function saveCatModal() {
  const n = document.getElementById('f-cat-name') ? document.getElementById('f-cat-name').value.trim() : ''; if (!n) return;
  let newCatId = null;
  
  if (isDuplicateCategoryName(n, ctxCatId)) {
    return showToast(`❌ 分类名称「${n}」已存在，请更换一个名称`, 'error');
  }
  
  if (ctxCatId) {
    const c = DB.categories.find(x => x.id === ctxCatId);
    if (c && c.name !== n) {
      const oCat = sanitizeName(c.name); const nCat = sanitizeName(n);
      const oldName = c.name;
      if (dirHandle) {
        const iMs = DB.items.filter(i => i.categoryId === c.id);
        // 先尝试物理搬迁文件夹，全部成功后才提交改名，避免物理文件与数据库脱节
        let allOk = true;
        const oldPaths = iMs.map(iM => `素材截图/${oCat}/${sanitizeName(iM.title)}_${iM.id}`);
        const newPaths = iMs.map(iM => `素材截图/${nCat}/${sanitizeName(iM.title)}_${iM.id}`);
        let movedCount = 0;
        for (let i = 0; i < iMs.length; i++) {
          const ok = await moveFs(dirHandle, oldPaths[i], newPaths[i], false);
          if (!ok) { allOk = false; break; }
          movedCount++;
        }
        if (!allOk) {
          // 回滚：把已经搬迁成功的文件夹搬回原位，确保物理文件与数据库状态保持一致
          for (let i = 0; i < movedCount; i++) { await moveFs(dirHandle, newPaths[i], oldPaths[i], false); }
          showToast('❌ 物理文件夹搬迁失败，分类名称未修改，请检查硬盘权限后重试', 'error');
          return;
        }
        c.name = n;
        const oDir = await getDirHandleByPath(dirHandle, `素材截图/${oCat}`, false);
        if (oDir) { let emp = true; for await (const e of oDir.entries()) { emp = false; break; } if (emp) await (await getDirHandleByPath(dirHandle, '素材截图')).removeEntry(oCat).catch(()=>{}); }
        // 立即固化保存，避免防抖延迟期间刷新/断电导致物理路径与数据库记录不一致
        await saveToFolder();
        await preloadImageBlobs();
      } else {
        c.name = n;
      }
    }
  } else { newCatId = uid(); DB.categories.push({ id: newCatId, name: n }); }
  if(document.getElementById('cat-modal')) document.getElementById('cat-modal').classList.remove('show'); 
  scheduleSave(); 
  if(typeof renderSidebarStats === 'function') renderSidebarStats();
  if (currentView === 'lib') renderLibrary();
  if (quickAddCategoryTarget && newCatId) {
    if (document.getElementById('f-category')) selectCategoryOption(newCatId);
  }
  quickAddCategoryTarget = false;
}

/* ═══════════════════════════════════════════════════════
   SYSTEM EXPORT (大基建报表输出与数据脱出)
═══════════════════════════════════════════════════════ */
function openExport() { if(document.getElementById('export-modal')) document.getElementById('export-modal').classList.add('show'); }

function exportJSON() {
  const exp = { items: DB.items, categories: DB.categories, accounts: DB.accounts, trash: DB.trash, settings: DB.settings, version: DB.version, exportedAt: new Date().toISOString() };
  downloadText(JSON.stringify(exp, null, 2), `素材参考库备份_${Date.now()}.json`, 'application/json');
  if(document.getElementById('export-modal')) document.getElementById('export-modal').classList.remove('show'); showToast('✅ JSON 数据已导出');
}
function exportWSJSON() {
  const exp = { workspace: WS, exportedAt: new Date().toISOString() };
  downloadText(JSON.stringify(exp, null, 2), `工作台备份_${Date.now()}.json`, 'application/json');
  if(document.getElementById('export-modal')) document.getElementById('export-modal').classList.remove('show'); showToast('✅ 工作台数据已导出');
}
function exportCSV() {
  const head = ['标题名称', '所属分类', '标签', '备注', '链接数'];
  const rows = DB.items.map(it => [
    `"${(it.title || '').replace(/"/g, '""')}"`,
    `"${(DB.categories.find(c => c.id === it.categoryId) || {}).name || '无分类'}"`,
    `"${(it.tags || []).join(', ')}"`,
    `"${(it.note || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
    (it.links || []).length
  ]);
  downloadText('\uFEFF' + [head, ...rows].map(r => r.join(',')).join('\n'), `素材汇总报表_${Date.now()}.csv`, 'text/csv;charset=utf-8');
  if(document.getElementById('export-modal')) document.getElementById('export-modal').classList.remove('show'); showToast('✅ CSV 报表已生成');
}
function downloadText(txt, fn, type) {
  const b = new Blob([txt], { type }); const u = URL.createObjectURL(b);
  const a = document.createElement('a'); a.href = u; a.download = fn; a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}

// 绑定全局键盘操作逻辑体系
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { 
    closeLightbox(); closeNineGridModal(); 
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); openAddModal(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); scheduleSave(); showToast('手动保存触发成功','success'); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return; // 输入框内的 Ctrl+Z 交给浏览器原生文本撤销
    e.preventDefault(); performUndo();
  }
});

/* ═══════════════════════════════════════════════════════
   SIDEBAR TOGGLE (侧边栏收缩控制)
═══════════════════════════════════════════════════════ */
let sidebarCollapsed = false;
function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  const sidebar = document.getElementById('sidebar');
  const icon = document.getElementById('sidebar-toggle-icon');
  if (sidebar) sidebar.classList.toggle('collapsed', sidebarCollapsed);
  if (icon) icon.className = sidebarCollapsed ? 'ti ti-layout-sidebar-right' : 'ti ti-layout-sidebar';
}

let detailCollapsed = false;
function toggleDetailSidebar() {
  detailCollapsed = !detailCollapsed;
  const detail = document.getElementById('detail');
  const icon = document.getElementById('detail-toggle-icon');
  if (detail) detail.classList.toggle('collapsed', detailCollapsed);
  if (icon) icon.className = detailCollapsed ? 'ti ti-layout-sidebar' : 'ti ti-layout-sidebar-right';
}

// 修复建议5：窄屏（如平板竖屏）自动收起两侧栏，避免主内容被挤压；只在首次跨过断点时自动收一次，不会打架用户之后的手动展开
let autoCollapseApplied = false;
function applyResponsiveLayout() {
  if (window.innerWidth < 860 && !autoCollapseApplied) {
    autoCollapseApplied = true;
    if (!sidebarCollapsed) toggleSidebar();
    if (!detailCollapsed) toggleDetailSidebar();
  }
}
window.addEventListener('resize', () => { clearTimeout(window._responsiveTimer); window._responsiveTimer = setTimeout(applyResponsiveLayout, 200); });
// 快捷键 [ 切换侧边栏
document.addEventListener('keydown', e => {
  if (e.key === '[' && !e.ctrlKey && !e.metaKey) {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
    toggleSidebar();
  }
});

/* ═══════════════════════════════════════════════════════
   UPDATE CHECKER (版本更新检测系统)
═══════════════════════════════════════════════════════ */
async function checkForUpdate(isManual = false) {
  if (!GITHUB_REPO) {
    if (isManual) showToast('⚙️ 当前版本暂不支持在线更新检测', 'warning');
    return;
  }
  if (!navigator.onLine) {
    if (isManual) showToast('📵 当前离线，无法检测更新', 'warning');
    return;
  }

  netCurrentTask = 'checking_update';
  updateNetStatus();

  try {
    // 用 /releases 拉全部版本（含测试版），取第一个（最新）
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases`, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
    if (res.status === 404) {
      if (isManual) showToast('✅ 暂无发布版本，当前已是最新', 'success');
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const list = await res.json();
    if (!list || !list.length) {
      if (isManual) showToast('✅ 暂无发布版本，当前已是最新', 'success');
      return;
    }

    const data = list[0]; // 最新的一个（含测试版）
    // tag_name 格式支持 v1.2 或 1.2，去掉 v 前缀和中文后缀
    const latestVer = (data.tag_name || '').replace(/^v/i, '').replace(/[^\d.]/g, '').trim();
    const notes = (data.body || '').trim() || '暂无更新说明。';

    // 语义化版本比较：把 "1.0.1" 拆成数组逐段比较
    function isNewer(remote, local) {
      const r = remote.split('.').map(Number);
      const l = local.split('.').map(Number);
      const len = Math.max(r.length, l.length);
      for (let i = 0; i < len; i++) {
        const rv = r[i] || 0, lv = l[i] || 0;
        if (rv > lv) return true;
        if (rv < lv) return false;
      }
      return false;
    }

    // 找 HTML 资产下载地址
    const asset = (data.assets || []).find(a => a.name.endsWith('.html') || a.name.includes('素材'));
    const downloadUrl = asset
      ? asset.browser_download_url
      : `https://github.com/${GITHUB_REPO}/releases/latest`;

    const skipped = null;
    if (latestVer && isNewer(latestVer, APP_VERSION) && latestVer !== skipped) {
      showUpdateModal(latestVer, notes, downloadUrl);
    } else if (isManual) {
      showToast('✅ 当前已是最新版本 v' + APP_VERSION, 'success');
    }
  } catch (e) {
    if (isManual) showToast('❌ 检测失败：' + (e.message || '网络错误'), 'error');
  } finally {
    netCurrentTask = null;
    updateNetStatus();
  }
}

function showUpdateModal(newVer, notes, downloadUrl) {
  const el = id => document.getElementById(id);
  if (el('update-cur-ver')) el('update-cur-ver').textContent = APP_VERSION;
  if (el('update-new-ver')) el('update-new-ver').textContent = newVer;
  if (el('update-notes')) el('update-notes').textContent = notes;
  if (el('update-download-btn')) {
    el('update-download-btn').onclick = () => {
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `素材参考库_v${newVer}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      el('update-modal').classList.remove('show');
      showToast('⬇️ 下载已开始，完成后替换旧文件即可', 'success');
    };
  }
  if (el('update-modal')) el('update-modal').classList.add('show');
}

/* ═══════════════════════════════════════════════════════
   SYSTEM BOOT (猎人系统总控启动点火程序)
═══════════════════════════════════════════════════════ */
async function bootSystem() {
  if ('showDirectoryPicker' in window) {
    const h = await FsStore.get('root_dir');
    if (h) {
      try {
        if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') { dirHandle = h; await setupWorkspace(); return; }
        else { 
            if(document.getElementById('folder-banner')) document.getElementById('folder-banner').classList.add('show'); 
            if(document.getElementById('btn-restore-folder')) document.getElementById('btn-restore-folder').style.display = 'flex'; 
            if(document.getElementById('btn-choose-folder')) document.getElementById('btn-choose-folder').style.display = 'none'; 
            if(document.getElementById('folder-banner-msg')) document.getElementById('folder-banner-msg').textContent = '已记住您的文件夹「' + h.name + '」，浏览器仅需重新授权一次（无需重新选择文件夹）。点击任意处或"恢复连接"即可。';
            // 浏览器出于安全考虑，每次重启后都需要重新确认硬盘授权，但文件夹本身已被记住，无需重新选择。
            // 这里监听页面上的第一次点击，借助该用户手势自动尝试恢复授权，减少手动点击"恢复连接"按钮的麻烦。
            const autoRestoreOnce = () => { document.removeEventListener('click', autoRestoreOnce, true); if (!dirHandle) restoreFolderAccess(); };
            document.addEventListener('click', autoRestoreOnce, true);
        }
      } catch (e) { if(document.getElementById('folder-banner')) document.getElementById('folder-banner').classList.add('show'); }
    } else { if(document.getElementById('folder-banner')) document.getElementById('folder-banner').classList.add('show'); }
  } else {
    if(document.getElementById('folder-banner')){
      document.getElementById('folder-banner').innerHTML = '<div class="folder-banner-text" style="color:var(--txdr)">提示：当前浏览器内核过旧，不支持直接访问本地硬盘，已自动切换为网页临时缓存模式。</div>';
      document.getElementById('folder-banner').classList.add('show');
    }
  }

  // Fallback 降级防御
  if (!dirHandle) {
    try {
      const localDB = localStorage.getItem('lhy_v1_db'); if (localDB) DB = Object.assign(DB, JSON.parse(localDB));
      const localWS = localStorage.getItem('lhy_v1_ws'); if (localWS) WS = Object.assign(WS, JSON.parse(localWS));
    } catch (e) { }
    
    // 数据缺省守护屏障补充
    if (!DB.accounts) DB.accounts = [];
    if (!DB.trash) DB.trash = [];
    if (!DB.recent) DB.recent = [];
    if (!WS.order) WS.order = ['scripts', 'tasks', 'notes', 'intakes', 'weekly'];
    if (!WS.collapsed) WS.collapsed = {};
    
    ensureDefaults(); applySettings();
    
    // 如果设置了密码锁，强行阻塞视口
    if (DB.settings.pin && DB.settings.pin.trim() !== '') {
      if(document.getElementById('lock-screen')) document.getElementById('lock-screen').style.display = 'flex';
    } else {
      switchView('lib');
    }
  }
}



/* ═══════════════════════════════════════════════════════
   NETWORK STATUS MONITOR (实时网络状态检测)
═══════════════════════════════════════════════════════ */
const NET_TASKS = {
  'checking_update': '检测更新中...',
  'fetch_avatar': '正在获取头像...',
};
let netCurrentTask = null;

function updateNetStatus() {
  const dot = document.getElementById('net-dot');
  const label = document.getElementById('net-label');
  const pill = document.getElementById('net-status-pill');
  if (!dot || !label || !pill) return;

  const isOnline = navigator.onLine;
  if (!isOnline) {
    dot.style.background = '#94a3b8';
    dot.style.boxShadow = 'none';
    label.textContent = '离线';
    pill.style.borderColor = 'var(--bd)';
    pill.title = '当前网络状态：离线';
    return;
  }

  if (netCurrentTask) {
    dot.style.background = '#f59e0b';
    dot.style.boxShadow = '0 0 6px #f59e0b88';
    label.textContent = NET_TASKS[netCurrentTask] || '联网中...';
    pill.style.borderColor = '#f59e0b44';
    pill.title = `当前网络状态：${label.textContent}`;
  } else {
    dot.style.background = '#22c55e';
    dot.style.boxShadow = '0 0 6px #22c55e66';
    label.textContent = '已联网';
    pill.style.borderColor = 'rgba(34,197,94,0.25)';
    pill.title = '当前网络状态：已联网';
  }
}

window.addEventListener('online', updateNetStatus);
window.addEventListener('offline', updateNetStatus);


// 引擎点火！
bootSystem();
applyResponsiveLayout();
updateNetStatus();
// 启动后延迟 3 秒静默检测版本更新
setTimeout(() => checkForUpdate(false), 3000);
