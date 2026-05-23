//content.js - JD analysis and tools
async function analyzeJD() {
  const jobText = getJobDescription();
  if (!jobText) return {
    status: 'error',
    message: 'Could not find job description. Try refreshing.'
  };

  const API_URL = "http://localhost:8000/analyze-jd";
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: jobText })
    });
    return await res.json();
  } catch (err) {
    return {
      status: 'error',
      message: 'Cannot connect to backend. Ensure FastAPI server is running.'
    };
  }
}
function getJobDescription() {
  const selectors = [
    '#job-details',                        // most reliable — has the id
    '.jobs-box__html-content',             // parent div visible in your screenshot
    '.jobs-description__content',          // grandparent article
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 50) {
      return el.innerText.trim();
    }
  }
  return null;
}
function injectBanner(intent) {
    if (document.getElementById('accessplus-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'accessplus-banner';
    banner.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
    background: #0a66c2; color: white;
    padding: 10px 20px;
    display: flex; align-items: center; justify-content: space-between;
    font-family: -apple-system, sans-serif; font-size: 14px;
  `;
    banner.innerHTML = `
    <span>🎯 Focus: <strong>${intent}</strong></span>
    <span id="accessplus-done" style="cursor:pointer; background:white; color:#0a66c2;
      padding:4px 12px; border-radius:20px; font-size:12px; font-weight:600;">
      Done ✓
    </span>
  `;
    document.body.prepend(banner);
    document.body.style.marginTop = '44px';

    // Hide the feed
    hideFeed();

    document.getElementById('accessplus-done').addEventListener('click', () => {
        chrome.storage.local.set({ lockActive: false });
        removeBanner();
    });
}

function hideFeed() {
    const feedSelectors = [
        '.scaffold-finite-scroll',    // main feed container
        '[data-view-name="feed-full-recommendations"]'
    ];
    feedSelectors.forEach(sel => {
        const el = document.querySelector(sel);
        if (el) el.style.display = 'none';
    });
}

function removeBanner() {
    const banner = document.getElementById('accessplus-banner');
    if (banner) banner.remove();
    document.body.style.marginTop = '';
    // Restore feed
    const feedSelectors = ['.scaffold-finite-scroll', '[data-view-name="feed-full-recommendations"]'];
    feedSelectors.forEach(sel => {
        const el = document.querySelector(sel);
        if (el) el.style.display = '';
    });
}

// Check state on every page load
chrome.storage.local.get(['intentLock', 'lockActive'], (data) => {
    if (data.lockActive && data.intentLock) {
        injectBanner(data.intentLock);
    }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'ACTIVATE_LOCK') injectBanner(msg.intent);
    if (msg.type === 'DEACTIVATE_LOCK') removeBanner();
});