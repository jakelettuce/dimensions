export function generatePortalChromeHtml(portalId: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #141414;
    color: #e5e5e5;
    overflow: hidden;
    user-select: none;
    -webkit-app-region: no-drag;
  }
  #chrome {
    display: flex;
    flex-direction: column;
    height: 36px;
  }

  /* Navigation bar */
  #navbar {
    display: flex;
    align-items: center;
    height: 28px;
    min-height: 28px;
    padding: 0 4px;
    gap: 2px;
  }
  .nav-btn {
    background: none;
    border: none;
    color: #e5e5e5;
    font-size: 14px;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .nav-btn:hover { background: #2e2e2e; }
  .nav-btn:disabled { color: #666; cursor: default; }
  .nav-btn:disabled:hover { background: none; }
  #url-input {
    flex: 1;
    height: 22px;
    background: #0a0a0a;
    border: 1px solid #2e2e2e;
    border-radius: 4px;
    color: #e5e5e5;
    font-size: 12px;
    padding: 0 8px;
    outline: none;
    min-width: 0;
  }
  #url-input:focus { border-color: #7c3aed; }

  /* Loading bar */
  #loading-bar {
    height: 2px;
    background: #7c3aed;
    width: 0%;
    transition: width 0.3s ease;
    opacity: 0;
  }
  #loading-bar.active {
    opacity: 1;
    animation: loading 1.5s ease-in-out infinite;
  }
  @keyframes loading {
    0% { width: 10%; }
    50% { width: 80%; }
    100% { width: 95%; }
  }
  #loading-bar.done {
    width: 100%;
    opacity: 0;
    transition: width 0.1s ease, opacity 0.3s ease 0.2s;
  }

  /* Tab bar */
  #tabbar {
    display: none;
    align-items: center;
    height: 8px;
    min-height: 8px;
    padding: 0 4px;
    overflow: hidden;
  }
  #tabbar.visible {
    display: flex;
    height: auto;
    min-height: auto;
  }
  /* When tab bar is visible, shift layout */
  #chrome.has-tabs #navbar { height: 22px; min-height: 22px; }
  #chrome.has-tabs .nav-btn { width: 20px; height: 20px; font-size: 12px; }
  #chrome.has-tabs #url-input { height: 18px; font-size: 11px; }
  #chrome.has-tabs #tabbar {
    height: 12px;
    min-height: 12px;
  }
  .tab {
    display: flex;
    align-items: center;
    height: 12px;
    padding: 0 4px;
    font-size: 9px;
    color: #666;
    border-radius: 3px 3px 0 0;
    cursor: pointer;
    max-width: 120px;
    flex-shrink: 0;
  }
  .tab:hover { background: #1e1e1e; }
  .tab.active { color: #e5e5e5; background: #1e1e1e; }
  .tab-title {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .tab-close {
    margin-left: 3px;
    font-size: 8px;
    color: #666;
    cursor: pointer;
    flex-shrink: 0;
    line-height: 1;
  }
  .tab-close:hover { color: #e5e5e5; }
  .tab-new {
    font-size: 10px;
    color: #666;
    cursor: pointer;
    padding: 0 4px;
    flex-shrink: 0;
  }
  .tab-new:hover { color: #e5e5e5; }
</style>
</head>
<body>
<div id="chrome">
  <div id="navbar">
    <button class="nav-btn" id="btn-back" disabled title="Back">\u2190</button>
    <button class="nav-btn" id="btn-forward" disabled title="Forward">\u2192</button>
    <button class="nav-btn" id="btn-reload" title="Reload">\u27F3</button>
    <input type="text" id="url-input" placeholder="Enter URL..." spellcheck="false">
  </div>
  <div id="loading-bar"></div>
  <div id="tabbar"></div>
</div>
<script>
  const chrome = window.portalChrome;
  const urlInput = document.getElementById('url-input');
  const btnBack = document.getElementById('btn-back');
  const btnForward = document.getElementById('btn-forward');
  const btnReload = document.getElementById('btn-reload');
  const loadingBar = document.getElementById('loading-bar');
  const tabbar = document.getElementById('tabbar');
  const chromeEl = document.getElementById('chrome');

  let isLoading = false;

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = urlInput.value.trim();
      if (val) chrome.navigate(val);
    }
  });

  btnBack.addEventListener('click', () => chrome.goBack());
  btnForward.addEventListener('click', () => chrome.goForward());
  btnReload.addEventListener('click', () => {
    if (isLoading) {
      chrome.stop();
    } else {
      chrome.reload();
    }
  });

  chrome.onNavigationUpdate((state) => {
    if (state.url != null && document.activeElement !== urlInput) {
      urlInput.value = state.url;
    }
    if (state.canGoBack != null) btnBack.disabled = !state.canGoBack;
    if (state.canGoForward != null) btnForward.disabled = !state.canGoForward;
    if (state.loading != null) {
      isLoading = state.loading;
      if (state.loading) {
        loadingBar.className = 'active';
        btnReload.textContent = '\u00D7';
        btnReload.title = 'Stop';
      } else {
        loadingBar.className = 'done';
        btnReload.textContent = '\u27F3';
        btnReload.title = 'Reload';
        setTimeout(() => {
          if (!isLoading) loadingBar.className = '';
        }, 500);
      }
    }
  });

  chrome.onTabsUpdate((tabs) => {
    if (!tabs || tabs.length < 2) {
      tabbar.classList.remove('visible');
      chromeEl.classList.remove('has-tabs');
      tabbar.innerHTML = '';
      return;
    }
    tabbar.classList.add('visible');
    chromeEl.classList.add('has-tabs');
    let html = '';
    for (const tab of tabs) {
      const title = (tab.title || 'New Tab').length > 20
        ? (tab.title || 'New Tab').slice(0, 20) + '\u2026'
        : (tab.title || 'New Tab');
      const cls = tab.active ? 'tab active' : 'tab';
      html += '<div class="' + cls + '" data-tab-id="' + tab.id + '">'
        + '<span class="tab-title">' + title.replace(/</g, '&lt;') + '</span>'
        + '<span class="tab-close" data-close-id="' + tab.id + '">\u00D7</span>'
        + '</div>';
    }
    html += '<span class="tab-new" id="tab-new-btn">+</span>';
    tabbar.innerHTML = html;

    tabbar.querySelectorAll('.tab').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-close')) return;
        chrome.switchTab(el.dataset.tabId);
      });
    });
    tabbar.querySelectorAll('.tab-close').forEach((el) => {
      el.addEventListener('click', () => {
        chrome.closeTab(el.dataset.closeId);
      });
    });
    document.getElementById('tab-new-btn').addEventListener('click', () => {
      chrome.newTab();
    });
  });
</script>
</body>
</html>`;
}
