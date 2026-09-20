/* AI U盘 Launcher 渲染进程 —— 原生 JS，无构建步骤。 */

const STATUS_TEXT = {
  Unknown: '未知',
  NotInstalled: '未安装',
  Stopped: '未运行',
  Starting: '启动中',
  Running: '运行中',
  Stopping: '停止中',
  Error: '错误',
  Updating: '更新中',
};

const STATUS_DOT = {
  Unknown: 'dot-gray',
  NotInstalled: 'dot-gray',
  Stopped: 'dot-gray',
  Starting: 'dot-yellow',
  Running: 'dot-green',
  Stopping: 'dot-yellow',
  Error: 'dot-red',
  Updating: 'dot-blue',
};

let selectedId = null;
let currentStatus = {};
let autoCloseAfterStart = true;

const $ = (sel) => document.querySelector(sel);

function showToast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), ms);
}

async function refresh() {
  try {
    currentStatus = await window.aiUsb.status();
    render();
  } catch (err) {
    showToast('状态刷新失败: ' + err.message);
  }
}

function render() {
  const list = $('#agentList');
  list.innerHTML = '';

  const entries = Object.values(currentStatus);
  for (const a of entries) {
    const card = document.createElement('div');
    card.className = 'agent-card' + (a.id === selectedId ? ' selected' : '');
    card.dataset.id = a.id;

    const dot = document.createElement('span');
    dot.className = 'dot ' + STATUS_DOT[a.status];

    const name = document.createElement('span');
    name.className = 'agent-name';
    name.textContent = a.name;

    const status = document.createElement('span');
    status.className = 'agent-status ' + STATUS_DOT[a.status];
    status.textContent = STATUS_TEXT[a.status] ?? a.status;

    card.appendChild(dot);
    card.appendChild(name);
    card.appendChild(status);

    card.addEventListener('click', () => {
      selectedId = a.id;
      render();
    });

    list.appendChild(card);
  }

  $('#btnStartSelected').disabled = !selectedId;
}

function selectFor(id) {
  selectedId = id;
}

async function startSelected() {
  if (!selectedId) return;
  const r = await window.aiUsb.start(selectedId);
  handleStartResult(selectedId, r);
}

async function startAll() {
  const results = await window.aiUsb.startAll();
  const running = Object.values(results).filter((r) => r.ok).length;
  showToast(`已启动 ${running} 个 Agent`);
  await refresh();
}

async function stopAll() {
  await window.aiUsb.stopAll();
  showToast('已全部停止');
  await refresh();
}

function handleStartResult(id, r) {
  if (r.ok) {
    showToast('已启动');
    if (autoCloseAfterStart) {
      setTimeout(() => window.aiUsb.close(), 1500);
      return;
    }
  } else {
    const reason = { 'not-installed': '未安装', 'already-running': '已在运行', 'startup-timeout': '启动超时', 'exited-during-startup': '启动即退出' }[r.reason] ?? r.reason;
    showToast('启动失败：' + reason);
  }
  refresh();
}

async function runDoctor() {
  $('#diagOutput').textContent = '诊断中…';
  const d = await window.aiUsb.doctor();
  $('#diagOutput').textContent = JSON.stringify(d, null, 2);
}

async function checkUpdate() {
  $('#updateOutput').textContent = '检查中…';
  const r = await window.aiUsb.checkUpdate();
  if (r.hasUpdate) {
    $('#updateOutput').textContent = `发现新版本 ${r.latest}（当前 ${r.current}）\n` +
      (r.asset ? `更新包：${r.asset.name}` : '⚠️ 未找到匹配本平台的更新包');
  } else {
    $('#updateOutput').textContent = r.reason === 'not-configured'
      ? '未配置更新源（config/update.json → githubRepo）'
      : `已是最新版本（${r.current}）`;
  }
}

function bind() {
  $('#btnStartSelected').addEventListener('click', startSelected);
  $('#btnStartAll').addEventListener('click', startAll);
  $('#btnStopAll').addEventListener('click', stopAll);
  $('#btnSettings').addEventListener('click', () => $('#settingsModal').classList.remove('hidden'));
  $('#btnCloseSettings').addEventListener('click', () => $('#settingsModal').classList.add('hidden'));
  $('#btnDoctor').addEventListener('click', runDoctor);
  $('#btnCheckUpdate').addEventListener('click', checkUpdate);

  document.querySelectorAll('#settingsTabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#settingsTabs .tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.add('hidden'));
      $('#tab-' + tab.dataset.tab).classList.remove('hidden');
    });
  });

  $('#linkAbout').addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelector('[data-tab="about"]').click();
    $('#settingsModal').classList.remove('hidden');
  });
  $('#linkTutorial').addEventListener('click', (e) => {
    e.preventDefault();
    showToast('使用教程：见 README.md');
  });

  // 点击遮罩关闭设置
  $('#settingsModal').addEventListener('click', (e) => {
    if (e.target === $('#settingsModal')) $('#settingsModal').classList.add('hidden');
  });
}

async function init() {
  bind();
  const info = await window.aiUsb.appInfo();
  $('#portableRoot').textContent = info.portableRoot;
  $('#aboutRoot').textContent = info.portableRoot;
  autoCloseAfterStart = info.autoCloseAfterStart ?? true;
  await refresh();
  setInterval(refresh, 2000); // 每 2 秒轮询真实状态
}

init();
