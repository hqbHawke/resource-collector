/**
 * Background Service Worker
 * 负责存储和管理收集到的资源数据
 */

const store = {
  resources: new Map(),
  apiRequests: new Map()
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'ADD_RESOURCE':
      handleAddResource(message.data);
      sendResponse({ success: true });
      break;

    case 'ADD_API_REQUEST':
      handleAddApiRequest(message.data);
      sendResponse({ success: true });
      break;

    case 'GET_ALL_DATA':
      sendResponse({
        resources: Array.from(store.resources.values()),
        apiRequests: Array.from(store.apiRequests.values())
      });
      break;

    case 'GET_RESOURCE_TYPES':
      const types = new Set();
      store.resources.forEach(r => types.add(r.type));
      sendResponse({ types: Array.from(types).sort() });
      break;

    case 'GET_STATS':
      sendResponse({
        resourceCount: store.resources.size,
        apiCount: store.apiRequests.size
      });
      break;

    case 'CLEAR_DATA':
      store.resources.clear();
      store.apiRequests.clear();
      sendResponse({ success: true });
      break;
  }
  return true;
});

function handleAddResource(data) {
  const key = data.url;
  if (!store.resources.has(key)) {
    store.resources.set(key, {
      url: data.url,
      type: data.type,
      mimeType: data.mimeType,
      content: data.content,
      encoding: data.encoding,
      size: data.size,
      timestamp: data.timestamp || new Date().toISOString()
    });
  }
}

function handleAddApiRequest(data) {
  const key = `${data.method}_${data.url}_${Date.now()}`;
  store.apiRequests.set(key, {
    url: data.url,
    method: data.method,
    requestBody: data.requestBody,
    responseBody: data.responseBody,
    status: data.status,
    timestamp: data.timestamp || new Date().toISOString()
  });
}
