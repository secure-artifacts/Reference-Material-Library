// 素材参考库依赖“选择本地文件夹”这类原生弹窗（File System Access API），
// 而浏览器扩展的小弹窗（popup）在这种系统对话框弹出、抢走焦点时会被自动关闭，
// 导致选择文件夹功能失效。所以这里改为点击工具栏图标时，打开/切换到一个完整的浏览器标签页。
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('index.html');
  const existing = await chrome.tabs.query({ url });
  if (existing.length > 0) {
    const tab = existing[0];
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({ url });
  }
});
