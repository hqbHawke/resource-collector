/**
 * DevTools 入口
 * 创建 panel 并初始化网络监听
 */

chrome.devtools.panels.create(
  'Resource Collector',
  'icons/icon16.png',
  'panel.html'
);

chrome.devtools.network.onRequestFinished.addListener(handleRequest);

/**
 * 资源类型映射表
 */
const RESOURCE_TYPE_MAP = {
  // 脚本
  'javascript': 'js',
  'text/javascript': 'js',
  'application/javascript': 'js',
  // 样式
  'text/css': 'css',
  // 图片
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  // 字体
  'font/woff': 'woff',
  'font/woff2': 'woff2',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'application/font-woff': 'woff',
  'application/font-woff2': 'woff2',
  // 3D 模型
  'model/gltf-binary': 'glb',
  'model/gltf+json': 'gltf',
  // 压缩
  'application/gzip': 'gzip',
  'application/x-gzip': 'gzip',
  // 数据
  'application/json': 'json',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'text/html': 'html',
  // 二进制
  'application/octet-stream': 'bin',
  'application/wasm': 'wasm'
};

/**
 * 从 URL 提取文件扩展名
 */
function getExtFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split('/').pop();
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext && ext.length <= 10 && ext !== filename) {
      return ext;
    }
  } catch {}
  return null;
}

/**
 * 判断资源类型
 */
function getResourceType(mimeType, url) {
  // 优先从 URL 扩展名判断
  const urlExt = getExtFromUrl(url);
  if (urlExt) {
    // 常见扩展名直接返回
    const knownExts = ['js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico',
      'woff', 'woff2', 'ttf', 'otf', 'eot', 'glb', 'gltf', '3ds', 'obj', 'fbx',
      'gzip', 'gz', 'zip', 'json', 'xml', 'html', 'htm', 'wasm', 'bin', 'mp3',
      'mp4', 'webm', 'ogg', 'wav', 'pdf', 'doc', 'xls', 'ppt'];
    if (knownExts.includes(urlExt)) {
      return urlExt === 'jpeg' ? 'jpg' : urlExt;
    }
  }

  // 从 MIME 类型判断
  const mime = (mimeType || '').toLowerCase();
  for (const [key, value] of Object.entries(RESOURCE_TYPE_MAP)) {
    if (mime.includes(key)) {
      return value;
    }
  }

  // 返回 URL 扩展名或 other
  return urlExt || 'other';
}

/**
 * 判断是否为 API 请求
 */
function isApiRequest(mimeType, url) {
  const mime = (mimeType || '').toLowerCase();
  return mime.includes('json') && (
    url.includes('/api/') ||
    url.includes('/v1/') ||
    url.includes('/v2/') ||
    !url.match(/\.(json)$/i)
  );
}

/**
 * 处理网络请求
 */
function handleRequest(request) {
  const url = request.request.url;
  const mimeType = request.response.content.mimeType || '';
  const resourceType = getResourceType(mimeType, url);

  request.getContent((content, encoding) => {
    const timestamp = new Date().toISOString();

    if (isApiRequest(mimeType, url)) {
      // API 请求
      chrome.runtime.sendMessage({
        type: 'ADD_API_REQUEST',
        data: {
          url,
          method: request.request.method,
          requestBody: parseRequestBody(request.request.postData),
          responseBody: parseResponseBody(content, mimeType),
          status: request.response.status,
          timestamp
        }
      });
    } else {
      // 静态资源
      chrome.runtime.sendMessage({
        type: 'ADD_RESOURCE',
        data: {
          url,
          type: resourceType,
          mimeType,
          content,
          encoding,
          size: request.response.content.size || 0,
          timestamp
        }
      });
    }
  });
}

/**
 * 解析请求体
 */
function parseRequestBody(postData) {
  if (!postData) return null;
  try {
    return postData.text ? JSON.parse(postData.text) : postData.params || null;
  } catch {
    return postData.text || null;
  }
}

/**
 * 解析响应体
 */
function parseResponseBody(content, mimeType) {
  if (!content) return null;
  if (mimeType.includes('json')) {
    try {
      return JSON.parse(content);
    } catch {
      return content;
    }
  }
  if (mimeType.includes('octet-stream') || mimeType.includes('image') ||
      mimeType.includes('video') || mimeType.includes('audio')) {
    return '[FILE]';
  }
  return content;
}
