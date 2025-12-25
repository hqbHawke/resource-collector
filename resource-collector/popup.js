/**
 * Popup 页面逻辑
 */

let allData = { resources: [], apiRequests: [] };
let selectedTypes = new Set();

document.addEventListener('DOMContentLoaded', init);

function init() {
  refreshData();
  bindEvents();
}

function bindEvents() {
  document.getElementById('downloadBtn').addEventListener('click', handleDownload);
  document.getElementById('refreshBtn').addEventListener('click', refreshData);
  document.getElementById('clearBtn').addEventListener('click', handleClear);
  document.getElementById('selectAll').addEventListener('click', () => toggleAll(true));
  document.getElementById('selectNone').addEventListener('click', () => toggleAll(false));
}

function sendMessage(message, callback) {
  try {
    if (!chrome.runtime?.id) {
      console.warn('扩展已重新加载');
      return;
    }
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('扩展上下文已失效');
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
      renderTypeList();
    }
  });
}

function updateStats() {
  document.getElementById('resourceCount').textContent = allData.resources?.length || 0;
  document.getElementById('apiCount').textContent = allData.apiRequests?.length || 0;
}

function renderTypeList() {
  const container = document.getElementById('typeList');
  const resources = allData.resources || [];

  if (!resources.length) {
    container.innerHTML = '<div class="empty-tip">暂无资源，请先在 DevTools 中收集</div>';
    return;
  }

  // 统计各类型数量
  const typeCounts = {};
  resources.forEach(r => {
    typeCounts[r.type] = (typeCounts[r.type] || 0) + 1;
  });

  const types = Object.keys(typeCounts).sort();

  // 默认全选
  if (selectedTypes.size === 0) {
    types.forEach(t => selectedTypes.add(t));
  }

  container.innerHTML = types.map(type => `
    <div class="type-item">
      <input type="checkbox" id="type_${type}" value="${type}" ${selectedTypes.has(type) ? 'checked' : ''}>
      <label for="type_${type}">${type}</label>
      <span class="count">(${typeCounts[type]})</span>
    </div>
  `).join('');

  // 绑定复选框事件
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      if (e.target.checked) {
        selectedTypes.add(e.target.value);
      } else {
        selectedTypes.delete(e.target.value);
      }
    });
  });
}

function toggleAll(checked) {
  const checkboxes = document.querySelectorAll('#typeList input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = checked;
    if (checked) {
      selectedTypes.add(cb.value);
    } else {
      selectedTypes.delete(cb.value);
    }
  });
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

  // 添加静态资源
  if (filteredResources.length) {
    const resourcesFolder = zip.folder('resources');
    const typeGroups = groupByType(filteredResources);

    for (const [type, items] of Object.entries(typeGroups)) {
      const typeFolder = resourcesFolder.folder(type);
      const usedNames = new Set();

      items.forEach((item, index) => {
        let filename = getFilenameFromUrl(item.url, index);
        // 处理重名
        if (usedNames.has(filename)) {
          const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
          const base = filename.replace(ext, '');
          filename = `${base}_${index}${ext}`;
        }
        usedNames.add(filename);

        const content = decodeContent(item.content, item.mimeType);
        typeFolder.file(filename, content);
      });
    }

    // 添加资源记录 MD
    const resourceLog = formatResourceLog(filteredResources);
    zip.file('resources-log.md', resourceLog);
  }

  // 添加 API 请求记录 MD
  if (apiRequests?.length) {
    const apiMd = formatApiRequestsMd(apiRequests);
    zip.file('api-requests.md', apiMd);
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
  const binaryTypes = ['image', 'font', 'octet-stream', 'gzip', 'zip', 'wasm',
    'audio', 'video', 'pdf', 'glb', 'gltf', '3ds'];
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

  // 按时间排序
  const sorted = [...requests].sort((a, b) =>
    new Date(a.timestamp) - new Date(b.timestamp)
  );

  sorted.forEach((req, index) => {
    const time = new Date(req.timestamp).toLocaleString();
    lines.push(`## ${index + 1}. ${req.method} ${req.url}`);
    lines.push('');
    lines.push(`- **时间**: ${time}`);
    lines.push(`- **状态**: ${req.status}`);
    lines.push('');

    lines.push('### 请求参数');
    lines.push('```json');
    if (req.requestBody) {
      lines.push(typeof req.requestBody === 'object'
        ? JSON.stringify(req.requestBody, null, 2)
        : String(req.requestBody));
    } else {
      lines.push('(无)');
    }
    lines.push('```');
    lines.push('');

    lines.push('### 响应内容');
    lines.push('```json');
    if (req.responseBody === '[FILE]') {
      lines.push('[文件类型响应]');
    } else if (req.responseBody) {
      lines.push(typeof req.responseBody === 'object'
        ? JSON.stringify(req.responseBody, null, 2)
        : String(req.responseBody));
    } else {
      lines.push('(无)');
    }
    lines.push('```');
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}

function formatSize(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: true });
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
