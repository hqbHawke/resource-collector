/**
 * Panel 页面逻辑
 */

let currentTab = 'resources';
let allData = { resources: [], apiRequests: [] };
let selectedTypes = new Set();

document.addEventListener('DOMContentLoaded', init);

function init() {
  bindEvents();
  refreshData();
  setInterval(refreshData, 2000);
}

function bindEvents() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      updateFilterBar();
      renderList();
    });
  });

  document.getElementById('downloadBtn').addEventListener('click', handleDownload);
  document.getElementById('clearBtn').addEventListener('click', handleClear);
  document.getElementById('selectAll').addEventListener('click', () => toggleAll(true));
  document.getElementById('selectNone').addEventListener('click', () => toggleAll(false));
}

function sendMessage(message, callback) {
  try {
    if (!chrome.runtime?.id) {
      console.warn('扩展已重新加载，请关闭并重新打开 DevTools');
      return;
    }
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('扩展上下文已失效，请重新打开 DevTools');
        return;
      }
      callback?.(response);
    });
  } catch (e) {
    console.warn('扩展上下文已失效');
  }
}

function refreshData() {
  sendMessage({ type: 'GET_ALL_DATA' }, (response) => {
    if (response) {
      allData = response;
      updateStats();
      updateFilterBar();
      renderList();
    }
  });
}

function updateStats() {
  document.getElementById('resourceCount').textContent = allData.resources?.length || 0;
  document.getElementById('apiCount').textContent = allData.apiRequests?.length || 0;
}

function updateFilterBar() {
  const filterBar = document.getElementById('filterBar');
  const filterList = document.getElementById('filterList');

  if (currentTab !== 'resources') {
    filterBar.classList.remove('show');
    return;
  }

  const resources = allData.resources || [];
  if (!resources.length) {
    filterBar.classList.remove('show');
    return;
  }

  filterBar.classList.add('show');

  const typeCounts = {};
  resources.forEach(r => {
    typeCounts[r.type] = (typeCounts[r.type] || 0) + 1;
  });

  const types = Object.keys(typeCounts).sort();

  if (selectedTypes.size === 0) {
    types.forEach(t => selectedTypes.add(t));
  }

  filterList.innerHTML = types.map(type => `
    <div class="filter-item">
      <input type="checkbox" id="filter_${type}" value="${type}" ${selectedTypes.has(type) ? 'checked' : ''}>
      <label for="filter_${type}">${type}</label>
      <span class="count">(${typeCounts[type]})</span>
    </div>
  `).join('');

  filterList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      if (e.target.checked) {
        selectedTypes.add(e.target.value);
      } else {
        selectedTypes.delete(e.target.value);
      }
      renderList();
    });
  });
}

function toggleAll(checked) {
  const checkboxes = document.querySelectorAll('#filterList input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = checked;
    if (checked) {
      selectedTypes.add(cb.value);
    } else {
      selectedTypes.delete(cb.value);
    }
  });
  renderList();
}

function renderList() {
  const container = document.getElementById('resourceList');

  if (currentTab === 'resources') {
    const items = (allData.resources || []).filter(r => selectedTypes.has(r.type));
    if (!items.length) {
      container.innerHTML = '<div class="empty"><div>暂无数据</div><div style="margin-top:8px">浏览页面后数据将自动收集</div></div>';
      return;
    }

    const sorted = [...items].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    container.innerHTML = sorted.map(item => {
      const time = new Date(item.timestamp).toLocaleTimeString();
      return `
        <div class="list-item" title="${item.url}">
          <span class="list-item-type">${item.type}</span>
          <span class="list-item-url">${item.url}</span>
          <span class="list-item-size">${formatSize(item.size)}</span>
          <span class="list-item-time">${time}</span>
        </div>
      `;
    }).join('');
  } else {
    const items = allData.apiRequests || [];
    if (!items.length) {
      container.innerHTML = '<div class="empty"><div>暂无 API 请求</div></div>';
      return;
    }

    const sorted = [...items].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    container.innerHTML = sorted.map(item => {
      const time = new Date(item.timestamp).toLocaleTimeString();
      return `
        <div class="list-item" title="${item.url}">
          <span class="list-item-type">${item.method}</span>
          <span class="list-item-url">${item.url}</span>
          <span class="list-item-size">${item.status}</span>
          <span class="list-item-time">${time}</span>
        </div>
      `;
    }).join('');
  }
}

function formatSize(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function handleDownload() {
  const btn = document.getElementById('downloadBtn');
  btn.disabled = true;
  btn.textContent = '打包中...';

  try {
    await createAndDownloadZip();
  } catch (error) {
    alert('下载失败: ' + error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '下载 ZIP';
  }
}

async function createAndDownloadZip() {
  const { resources, apiRequests } = allData;
  const filteredResources = (resources || []).filter(r => selectedTypes.has(r.type));

  if (!filteredResources.length && !apiRequests?.length) {
    alert('没有选中任何资源');
    return;
  }

  const zip = new JSZip();

  if (filteredResources.length) {
    const resourcesFolder = zip.folder('resources');
    const typeGroups = groupByType(filteredResources);

    for (const [type, items] of Object.entries(typeGroups)) {
      const typeFolder = resourcesFolder.folder(type);
      const usedNames = new Set();

      items.forEach((item, index) => {
        let filename = getFilenameFromUrl(item.url, index);
        if (usedNames.has(filename)) {
          const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
          const base = filename.replace(ext, '');
          filename = `${base}_${index}${ext}`;
        }
        usedNames.add(filename);
        typeFolder.file(filename, decodeContent(item.content, item.mimeType));
      });
    }

    zip.file('resources-log.md', formatResourceLog(filteredResources));
  }

  if (apiRequests?.length) {
    zip.file('api-requests.md', formatApiRequestsMd(apiRequests));
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `resources_${getTimestamp()}.zip`);
}

function groupByType(resources) {
  return resources.reduce((acc, item) => {
    const type = item.type || 'other';
    if (!acc[type]) acc[type] = [];
    acc[type].push(item);
    return acc;
  }, {});
}

function getFilenameFromUrl(url, index) {
  try {
    const pathname = new URL(url).pathname;
    let filename = pathname.split('/').pop() || `file_${index}`;
    filename = filename.split('?')[0] || `file_${index}`;
    return decodeURIComponent(filename);
  } catch {
    return `file_${index}`;
  }
}

function decodeContent(content, mimeType) {
  if (!content) return '';
  const binaryTypes = ['image', 'font', 'octet-stream', 'gzip', 'zip', 'wasm', 'audio', 'video', 'pdf', 'glb', 'gltf', '3ds'];
  if (binaryTypes.some(t => mimeType?.includes(t))) {
    try {
      return Uint8Array.from(atob(content), c => c.charCodeAt(0));
    } catch {
      return content;
    }
  }
  return content;
}

function formatResourceLog(resources) {
  const lines = [
    '# 资源获取记录',
    '',
    `**生成时间**: ${new Date().toLocaleString()}`,
    '',
    `**资源总数**: ${resources.length}`,
    ''
  ];

  // 按类型分组
  const grouped = {};
  resources.forEach(item => {
    const type = item.type || 'other';
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(item);
  });

  // 统计概览
  lines.push('## 资源概览');
  lines.push('');
  lines.push('| 类型 | 数量 | 总大小 |');
  lines.push('|------|------|--------|');

  const typeKeys = Object.keys(grouped).sort();
  typeKeys.forEach(type => {
    const items = grouped[type];
    const totalSize = items.reduce((sum, item) => sum + (item.size || 0), 0);
    lines.push(`| ${type} | ${items.length} | ${formatSize(totalSize)} |`);
  });
  lines.push('');

  // 按类型详细列表
  lines.push('## 资源详情');
  lines.push('');

  typeKeys.forEach(type => {
    const items = grouped[type];
    // 按时间排序
    items.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    lines.push(`### ${type.toUpperCase()} (${items.length})`);
    lines.push('');

    items.forEach((item, index) => {
      const time = new Date(item.timestamp).toLocaleString();
      const filename = getFilenameFromUrl(item.url, index);
      lines.push(`${index + 1}. **${filename}**`);
      lines.push(`   - 大小: ${formatSize(item.size)}`);
      lines.push(`   - 时间: ${time}`);
      lines.push(`   - URL: \`${item.url}\``);
      lines.push('');
    });
  });

  return lines.join('\n');
}

function formatApiRequestsMd(requests) {
  const lines = [
    '# API 请求记录',
    '',
    `> 生成时间: ${new Date().toLocaleString()}`,
    `> 请求总数: ${requests.length}`,
    ''
  ];

  const sorted = [...requests].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  sorted.forEach((req, index) => {
    const time = new Date(req.timestamp).toLocaleString();
    lines.push(`## ${index + 1}. ${req.method} ${req.url}`);
    lines.push('');
    lines.push(`- **时间**: ${time}`);
    lines.push(`- **状态**: ${req.status}`);
    lines.push('');
    lines.push('### 请求参数');
    lines.push('```json');
    lines.push(req.requestBody ? (typeof req.requestBody === 'object' ? JSON.stringify(req.requestBody, null, 2) : String(req.requestBody)) : '(无)');
    lines.push('```');
    lines.push('');
    lines.push('### 响应内容');
    lines.push('```json');
    if (req.responseBody === '[FILE]') {
      lines.push('[文件类型响应]');
    } else {
      lines.push(req.responseBody ? (typeof req.responseBody === 'object' ? JSON.stringify(req.responseBody, null, 2) : String(req.responseBody)) : '(无)');
    }
    lines.push('```');
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function getTimestamp() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
}

function handleClear() {
  if (confirm('确定要清空所有数据吗？')) {
    sendMessage({ type: 'CLEAR_DATA' }, () => {
      selectedTypes.clear();
      refreshData();
    });
  }
}
