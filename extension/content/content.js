// ==========================================
// FEATURE 1: INTENT LOCK & BANNER LOGIC
// ==========================================

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

    hideFeed();

    document.getElementById('accessplus-done').addEventListener('click', () => {
        chrome.storage.local.set({ lockActive: false });
        removeBanner();
    });
}

function hideFeed() {
    const feedSelectors = ['.scaffold-finite-scroll', '[data-view-name="feed-full-recommendations"]'];
    feedSelectors.forEach(sel => {
        const el = document.querySelector(sel);
        if (el) el.style.display = 'none';
    });
}

function removeBanner() {
    const banner = document.getElementById('accessplus-banner');
    if (banner) banner.remove();
    document.body.style.marginTop = '';
    const feedSelectors = ['.scaffold-finite-scroll', '[data-view-name="feed-full-recommendations"]'];
    feedSelectors.forEach(sel => {
        const el = document.querySelector(sel);
        if (el) el.style.display = '';
    });
}

// ==========================================
// FEATURE 2: 2D SPATIAL TEXT-TO-SPEECH
// ==========================================

let isReading = false;
let currentSpeed = 0.9;
let currentItemIndex = -1; 
let textBlocks = []; 

function refreshTextBlocks() {
    const allElements = document.querySelectorAll('p, span[dir="ltr"], h1, h2, h3');
    
    textBlocks = Array.from(allElements).filter(el => {
        const text = el.innerText ? el.innerText.trim() : "";

        // Must have meaningful content — skip short labels, numbers, badges
        if (text.length < 2) return false;

        // Skip our own injected captions
        if (el.classList.contains('accessin-caption')) return false;

        // Skip UI chrome
        if (el.closest('button, nav, header, footer, [role="button"], [role="navigation"], .global-nav, .search-global-typeahead')) {
            return false;
        }

        // Skip notification badges, counters, reaction counts
        if (/^\d+$/.test(text)) return false;

        // Skip elements that are inside image containers
        if (el.closest('figure, [data-view-name*="image"], .feed-shared-image, .update-components-image')) {
            return false;
        }

        return true;
    });
}

// --- THE NEW GEOMETRY ENGINE ---
// Calculates distances to find the nearest element in a specific direction
function findNearestItem(direction) {
    refreshTextBlocks();
    if (textBlocks.length === 0) return -1;
    
    // If nothing is selected yet, just grab the first item on the screen
    if (currentItemIndex < 0 || currentItemIndex >= textBlocks.length) return 0; 

    const currentEl = textBlocks[currentItemIndex];
    const currentRect = currentEl.getBoundingClientRect();
    
    // Get the exact center X and Y coordinates of our current box
    const cx = currentRect.left + currentRect.width / 2;
    const cy = currentRect.top + currentRect.height / 2;

    let bestIndex = -1;
    let minDistance = Infinity;

    textBlocks.forEach((el, index) => {
        if (index === currentItemIndex) return; // Skip ourselves

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return; // Skip invisible things

        const ex = rect.left + rect.width / 2;
        const ey = rect.top + rect.height / 2;

        let isValidDirection = false;
        
        // Check if the target is genuinely in the direction we want to go
        // We add a tiny 10px buffer to handle slightly misaligned grid items
        if (direction === 'up' && ey < cy - 10) isValidDirection = true;
        if (direction === 'down' && ey > cy + 10) isValidDirection = true;
        if (direction === 'left' && ex < cx - 10) isValidDirection = true;
        if (direction === 'right' && ex > cx + 10) isValidDirection = true;

        if (isValidDirection) {
            // Weight vertical distance less than horizontal so navigation
            // stays in the reading flow (top-to-bottom) rather than jumping sideways
            const dx = ex - cx;
            const dy = ey - cy;
            const distance = Math.sqrt(Math.pow(dx * 0.5, 2) + Math.pow(dy, 2));
            if (distance < minDistance) {
                minDistance = distance;
                bestIndex = index;
            }
        }
    });

    return bestIndex;
}

function readItemAt(index) {
    refreshTextBlocks();

    if (textBlocks.length === 0) {
        let highlightedText = window.getSelection().toString().trim();
        if (highlightedText) {
            speakText(highlightedText);
        } else {
            speakText("No readable text found.");
        }
        return;
    }

    if (index < 0 || index >= textBlocks.length) return;

    window.speechSynthesis.cancel();
    currentItemIndex = index;

    textBlocks.forEach(item => {
        if(item) item.style.outline = 'none'; 
    });
    
    const activeItem = textBlocks[currentItemIndex];
    if (activeItem) {
        activeItem.style.outline = '4px solid #0a66c2';
        activeItem.style.outlineOffset = '4px'; 
        activeItem.style.borderRadius = '4px';
        activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        speakText(activeItem.innerText);
    }
}

function speakText(text) {
    let cleanText = text.replace(/Like|Comment|Share|Send|Reply/g, '').trim();
    
    // If nothing meaningful to read, don't speak (avoids silent jumps)
    if (!cleanText || cleanText.length < 2) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = currentSpeed;
    
    utterance.onend = () => { 
        isReading = false; 
        updateButtonUI("🔊 Read Aloud\n(Alt+Arrows)");
    };
    
    window.speechSynthesis.speak(utterance);
    isReading = true;
    updateButtonUI("⏹️ Stop\n(Alt+S)");
}

function announceSpeed() {
    window.speechSynthesis.cancel();
    speakText(`Speed ${currentSpeed.toFixed(1)}`);
}

// ==========================================
// THE VISUAL BUTTON
// ==========================================

function injectTTSButton() {
    if (document.getElementById('accessplus-tts-btn')) return;

    const readButton = document.createElement('button');
    readButton.id = 'accessplus-tts-btn';
    readButton.innerText = "🔊 Read Aloud\n(Alt+Arrows)";

    Object.assign(readButton.style, {
        position: 'fixed', bottom: '20px', right: '20px', zIndex: '999999',
        padding: '10px 16px', backgroundColor: '#0a66c2', color: 'white',
        border: 'none', borderRadius: '8px', cursor: 'pointer',
        boxShadow: '0 4px 6px rgba(0,0,0,0.2)', fontFamily: '-apple-system, sans-serif',
        fontWeight: 'bold', fontSize: '13px', textAlign: 'center', lineHeight: '1.4'
    });

    document.body.appendChild(readButton);

    readButton.addEventListener('click', () => {
        if (isReading) {
            window.speechSynthesis.cancel();
            isReading = false;
            updateButtonUI("🔊 Read Aloud\n(Alt+Arrows)");
            if (currentItemIndex >= 0 && textBlocks[currentItemIndex]) {
                textBlocks[currentItemIndex].style.outline = 'none'; 
            }
        } else {
            readItemAt(0); 
        }
    });
}

function updateButtonUI(text) {
    const btn = document.getElementById('accessplus-tts-btn');
    if (btn) btn.innerText = text;
}

// ==========================================
// THE NEW SPATIAL KEYBOARD LISTENER
// ==========================================
document.addEventListener('keydown', (e) => {
    if (!e.altKey) return; 

    // ---- SPATIAL NAVIGATION (The Magic) ----
    if (e.code === 'ArrowUp') {
        e.preventDefault();
        const nextIdx = findNearestItem('up');
        if (nextIdx !== -1) readItemAt(nextIdx);
    }

    if (e.code === 'ArrowDown') {
        e.preventDefault();
        // If we haven't started reading yet, down arrow starts at index 0
        if (currentItemIndex === -1) {
            readItemAt(0);
        } else {
            const nextIdx = findNearestItem('down');
            if (nextIdx !== -1) readItemAt(nextIdx);
        }
    }

    if (e.code === 'ArrowLeft') {
        e.preventDefault();
        const nextIdx = findNearestItem('left');
        if (nextIdx !== -1) readItemAt(nextIdx);
    }

    if (e.code === 'ArrowRight') {
        e.preventDefault();
        const nextIdx = findNearestItem('right');
        if (nextIdx !== -1) readItemAt(nextIdx);
    }
    
    // ---- CORE CONTROLS ----
    if (e.code === 'KeyS') {
        e.preventDefault();
        window.speechSynthesis.cancel();
        isReading = false;
        updateButtonUI("🔊 Read Aloud\n(Alt+Arrows)");
        if (currentItemIndex >= 0 && textBlocks[currentItemIndex]) {
            textBlocks[currentItemIndex].style.outline = 'none'; 
        }
    }

    // ---- NEW SPEED CONTROLS (+ and -) ----
    if (e.code === 'Equal' || e.key === '+') {
        e.preventDefault();
        currentSpeed = Math.min(2.0, currentSpeed + 0.1);
        announceSpeed();
    }

    if (e.code === 'Minus' || e.key === '-') {
        e.preventDefault();
        currentSpeed = Math.max(0.5, currentSpeed - 0.1);
        announceSpeed();
    }
});

window.addEventListener('beforeunload', () => window.speechSynthesis.cancel());

// ==========================================
// FEATURE 3: JOB ANALYZER
// Extracts job description from LinkedIn job
// pages and injects simplified results inline.
// ==========================================

function extractJobDescription() {
    // Strategy 1: known stable class names (may work on /jobs/view/ pages)
    const stableSelectors = [
        '.jobs-description__content',
        '.jobs-description-content__text',
        '.jobs-box__html-content',
        '[class*="jobs-description"]',
        '.description__text',
    ];
    for (const sel of stableSelectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim().length > 100) return el.innerText.trim();
    }

    // Strategy 2: find "About the job" heading and collect all text after it
    const allElements = Array.from(document.querySelectorAll('h1, h2, h3, h4'));
    for (const heading of allElements) {
        const text = heading.innerText.trim().toLowerCase();
        if (text === 'about the job' || text === 'job description') {
            // Walk up to find a container with meaningful text
            let container = heading.parentElement;
            for (let i = 0; i < 4; i++) {
                if (container && container.innerText.trim().length > 150) {
                    return container.innerText.trim();
                }
                container = container?.parentElement;
            }
        }
    }

    // Strategy 3: grab the entire right-side job detail panel
    // On search results pages, the job detail is in the right column
    const rightPanel = document.querySelector(
        '.jobs-search__job-details, .job-details, [class*="job-details"], .scaffold-layout__detail'
    );
    if (rightPanel && rightPanel.innerText.trim().length > 150) {
        return rightPanel.innerText.trim();
    }

    // Strategy 4: last resort — find any div/section with 200+ chars that contains job keywords
    const candidates = Array.from(document.querySelectorAll('div, section, article'));
    for (const el of candidates) {
        // Only direct text, not deeply nested containers
        if (el.children.length > 20) continue;
        const t = el.innerText.trim();
        if (t.length > 200 && t.length < 8000 &&
            (t.toLowerCase().includes('responsibilities') ||
             t.toLowerCase().includes('requirements') ||
             t.toLowerCase().includes('qualifications') ||
             t.toLowerCase().includes('about the job'))) {
            return t;
        }
    }

    return null;
}

function removeAnalysisPanel() {
    const existing = document.getElementById('accessin-analysis-panel');
    if (existing) existing.remove();
}

function injectAnalysisPanel(data) {
    removeAnalysisPanel();

    const scoreColor = data.sensory_load_score <= 3 ? '#27ae60'
        : data.sensory_load_score <= 6 ? '#e67e22' : '#c0392b';

    const biasHTML = data.bias_flags && data.bias_flags.length > 0
        ? `<div class="ain-section">
            <div class="ain-title">⚠️ Bias Flags</div>
            ${data.bias_flags.map(f => `
                <div class="ain-bias-item">
                    <span class="ain-bias-phrase">"${f.phrase}"</span>
                    <span class="ain-bias-issue">${f.issue}</span>
                    <span class="ain-bias-fix">✅ ${f.suggestion}</span>
                </div>`).join('')}
           </div>`
        : '';

    const highlightsHTML = (data.key_highlights || [])
        .map(h => `<li>${h}</li>`).join('');

    const skillsHTML = (data.key_skills || [])
        .map(s => `<span class="ain-tag">${s}</span>`).join('');

    const tipsHTML = (data.match_tips || [])
        .map(t => `<li>${t}</li>`).join('');

    const panel = document.createElement('div');
    panel.id = 'accessin-analysis-panel';
    panel.innerHTML = `
        <style>
            #accessin-analysis-panel {
                position: fixed;
                top: 72px;
                right: 24px;
                bottom: 24px;
                width: 420px;
                max-width: calc(100vw - 32px);
                min-width: 320px;
                z-index: 999999;
                border: 2px solid #0a66c2;
                border-radius: 10px;
                font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                font-size: 13px;
                background: #fff;
                box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22);
                overflow: hidden;
                box-sizing: border-box;
                color: #333;
            }
            .ain-header {
                background: #0a66c2;
                color: white;
                padding: 12px 16px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            }
            .ain-header-title {
                font-weight: 700;
                font-size: 15px;
                line-height: 1.3;
                white-space: normal;
            }
            .ain-close {
                flex: 0 0 auto;
                cursor: pointer;
                background: rgba(255,255,255,0.2);
                border: none;
                color: white;
                border-radius: 50%;
                width: 28px;
                height: 28px;
                font-size: 16px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .ain-body {
                height: calc(100% - 52px);
                padding: 14px 16px 18px;
                display: flex;
                flex-direction: column;
                gap: 14px;
                overflow-y: auto;
                box-sizing: border-box;
            }
            .ain-score-row {
                display: flex;
                align-items: center;
                gap: 10px;
                flex-wrap: wrap;
            }
            .ain-score-badge {
                padding: 3px 12px; border-radius: 20px;
                font-weight: 700; color: white; font-size: 13px;
                background: ${scoreColor};
            }
            .ain-score-label { font-weight: 600; }
            .ain-score-explain { font-size: 12px; color: #555; margin-top: 4px; line-height: 1.5; }
            .ain-section { display: flex; flex-direction: column; gap: 6px; }
            .ain-title {
                font-weight: 700; font-size: 12px; color: #0a66c2;
                text-transform: uppercase; letter-spacing: 0.03em;
            }
            .ain-summary { line-height: 1.6; color: #333; overflow-wrap: anywhere; }
            ul.ain-list { padding-left: 18px; margin: 0; display: flex; flex-direction: column; gap: 4px; }
            ul.ain-list li { line-height: 1.5; color: #333; overflow-wrap: anywhere; }
            .ain-tags { display: flex; flex-wrap: wrap; gap: 5px; }
            .ain-tag {
                background: #e8f0fe; color: #0a66c2;
                padding: 2px 10px; border-radius: 12px;
                font-size: 11px; font-weight: 600;
            }
            .ain-bias-item {
                background: #fff8e1; border-left: 3px solid #e67e22;
                padding: 6px 10px; border-radius: 0 4px 4px 0;
                display: flex; flex-direction: column; gap: 2px;
            }
            .ain-bias-phrase { font-weight: 700; color: #c0392b; font-size: 12px; }
            .ain-bias-issue { color: #555; font-size: 11px; }
            .ain-bias-fix { color: #27ae60; font-size: 11px; }
            @media (max-width: 640px) {
                #accessin-analysis-panel {
                    top: 64px;
                    right: 12px;
                    left: 12px;
                    bottom: 12px;
                    width: auto;
                    min-width: 0;
                }
            }
        </style>
        <div class="ain-header">
            <span class="ain-header-title">🧠 AccessIn — Job Analysis</span>
            <button class="ain-close" id="ain-close-btn">✕</button>
        </div>
        <div class="ain-body">
            <div>
                <div class="ain-score-row">
                    <span class="ain-score-label">Sensory Load</span>
                    <span class="ain-score-badge">${data.sensory_load_score} / 10</span>
                </div>
                <div class="ain-score-explain">${data.sensory_load_explanation}</div>
            </div>
            <div class="ain-section">
                <div class="ain-title">📋 Simplified Summary</div>
                <div class="ain-summary">${data.simplified_summary}</div>
            </div>
            <div class="ain-section">
                <div class="ain-title">⭐ Key Highlights</div>
                <ul class="ain-list">${highlightsHTML}</ul>
            </div>
            ${biasHTML}
            <div class="ain-section">
                <div class="ain-title">🛠 Key Skills</div>
                <div class="ain-tags">${skillsHTML}</div>
            </div>
            <div class="ain-section">
                <div class="ain-title">💡 Match Tips</div>
                <ul class="ain-list">${tipsHTML}</ul>
            </div>
        </div>
    `;

    document.body.appendChild(panel);

    document.getElementById('ain-close-btn').addEventListener('click', removeAnalysisPanel);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'GET_JOB_DESCRIPTION') {
        sendResponse({ jd: extractJobDescription() });
        return true;
    }
    if (msg.type === 'INJECT_ANALYSIS') {
        injectAnalysisPanel(msg.data);
        sendResponse({ ok: true });
        return true;
    }
    if (msg.type === 'APPLY_READING_PREFS') {
        applyReadingPrefs(msg.prefs);
        sendResponse({ ok: true });
        return true;
    }
    if (msg.type === 'APPLY_SIMPLIFY_PREFS') {
        applySimplifyPrefs(msg.prefs);
        sendResponse({ ok: true });
        return true;
    }
    if (msg.type === 'ACTIVATE_LOCK') injectBanner(msg.intent);
    if (msg.type === 'DEACTIVATE_LOCK') removeBanner();
});

// ==========================================
// FEATURE 4: POST SIMPLIFIER
// Adds inline simplify buttons to long LinkedIn posts.
// ==========================================

const SIMPLIFY_API_URL = 'http://localhost:8000/simplify';
const MIN_SIMPLIFY_CHARS = 120;
const DEFAULT_SIMPLIFY_PREFS = {
    enabled: true,
};

let simplifyPrefs = { ...DEFAULT_SIMPLIFY_PREFS };
let simplifyObserver = null;

function ensureSimplifierStyles() {
    if (document.getElementById('accessplus-simplifier-styles')) return;

    const style = document.createElement('style');
    style.id = 'accessplus-simplifier-styles';
    style.textContent = `
        .accessplus-simplify-btn {
            margin: 8px 0;
            padding: 6px 12px;
            border: 1px solid #0a66c2;
            border-radius: 16px;
            background: #ffffff;
            color: #0a66c2;
            cursor: pointer;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 13px;
            font-weight: 700;
        }

        .accessplus-simplify-btn:hover {
            background: #eef6ff;
        }

        .accessplus-simplify-btn:disabled {
            border-color: #a0b4c8;
            color: #6b7c8f;
            cursor: wait;
        }

        .accessplus-simplified-panel {
            margin: 10px 0;
            padding: 12px;
            border-left: 4px solid #0a66c2;
            border-radius: 6px;
            background: #f3f8ff;
            color: #1f2933;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 14px;
            line-height: 1.55;
        }

        .accessplus-simplified-title {
            margin-bottom: 6px;
            color: #0a66c2;
            font-size: 13px;
            font-weight: 800;
            text-transform: uppercase;
        }

        .accessplus-simplified-panel ul {
            margin: 8px 0;
            padding-left: 20px;
        }

        .accessplus-simplified-panel li {
            margin: 4px 0;
        }

        .accessplus-simplified-action {
            margin-top: 8px;
            font-weight: 700;
        }

        #accessplus-simplify-visible-btn {
            position: fixed;
            right: 20px;
            bottom: 88px;
            z-index: 999999;
            padding: 10px 14px;
            border: none;
            border-radius: 8px;
            background: #0a66c2;
            color: #ffffff;
            box-shadow: 0 4px 6px rgba(0,0,0,0.2);
            cursor: pointer;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 13px;
            font-weight: 800;
        }

        #accessplus-simplify-visible-btn:hover {
            background: #004182;
        }
    `;
    document.head.appendChild(style);
}

function getPostText(post) {
    const selectors = [
        '.feed-shared-update-v2__description',
        '.update-components-text',
        '.update-components-update-v2__commentary',
        '.break-words',
        '.feed-shared-text',
        '[data-test-id*="main-feed-activity-card"] span[dir="ltr"]',
        'span[dir="ltr"]',
    ];

    for (const selector of selectors) {
        const nodes = Array.from(post.querySelectorAll(selector));
        const text = nodes
            .filter(node => !node.closest('button, nav, footer, [role="button"], .social-details-social-counts'))
            .map(node => node.innerText?.trim())
            .filter(Boolean)
            .join('\n')
            .trim();

        if (text.length >= MIN_SIMPLIFY_CHARS) return text;
    }

    const fallback = post.innerText?.trim() || '';
    if (fallback.length >= MIN_SIMPLIFY_CHARS && fallback.length <= 6000) return fallback;
    return '';
}

function findLinkedInPosts() {
    const selectors = [
        '.feed-shared-update-v2',
        '.occludable-update',
        '.fie-impression-container',
        '.update-components-update-v2',
        '[role="dialog"]',
        '[data-id*="urn:li:activity"]',
        '[data-urn*="urn:li:activity"]',
        'article',
        '[data-urn*="activity"]',
    ];

    return Array.from(document.querySelectorAll(selectors.join(',')))
        .filter(post => post instanceof HTMLElement)
        .filter(post => getPostText(post));
}

function isMostlyVisible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 80 &&
        rect.top < window.innerHeight - 80;
}

function findBestVisiblePost() {
    const posts = findLinkedInPosts()
        .filter(isMostlyVisible)
        .map(post => ({ post, text: getPostText(post) }))
        .filter(item => item.text)
        .sort((a, b) => b.text.length - a.text.length);

    return posts[0] || null;
}

function escapeHTML(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderSimplifiedPanel(data) {
    const keyPoints = (data.key_points || [])
        .map(point => `<li>${escapeHTML(point)}</li>`)
        .join('');

    return `
        <div class="accessplus-simplified-title">Simplified version</div>
        <div>${escapeHTML(data.simplified_text)}</div>
        ${keyPoints ? `<ul>${keyPoints}</ul>` : ''}
        <div class="accessplus-simplified-action">Action: ${escapeHTML(data.action_needed || 'No action needed')}</div>
    `;
}

async function simplifyPostText(text, button, panel) {
    button.disabled = true;
    button.textContent = 'Simplifying...';
    panel.innerHTML = '<div class="accessplus-simplified-title">Simplifying</div><div>Please wait.</div>';

    try {
        const response = await fetch(SIMPLIFY_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, context: 'LinkedIn post' }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || `Server error ${response.status}`);
        }

        const data = await response.json();
        panel.innerHTML = renderSimplifiedPanel(data);
        button.textContent = 'Simplified';
    } catch (error) {
        panel.innerHTML = `
            <div class="accessplus-simplified-title">Could not simplify</div>
            <div>${escapeHTML(error.message)}</div>
        `;
        button.disabled = false;
        button.textContent = 'Simplify';
    }
}

function addSimplifyButtons() {
    if (!simplifyPrefs.enabled) return;
    ensureSimplifierStyles();
    injectSimplifyVisibleButton();

    findLinkedInPosts().forEach((post) => {
        if (post.dataset.accessplusSimplifierReady === 'true') return;

        const text = getPostText(post);
        if (!text) return;

        post.dataset.accessplusSimplifierReady = 'true';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'accessplus-simplify-btn';
        button.textContent = 'Simplify';

        const panel = document.createElement('div');
        panel.className = 'accessplus-simplified-panel';
        panel.hidden = true;

        button.addEventListener('click', async () => {
            panel.hidden = false;
            await simplifyPostText(text, button, panel);
        });

        const textAnchor = post.querySelector(
            '.feed-shared-update-v2__description, .update-components-text, .update-components-update-v2__commentary, .feed-shared-text, .break-words, [dir="ltr"]'
        );
        const anchor = textAnchor || post.querySelector('.feed-shared-actor') || post.firstElementChild || post;

        if (anchor && anchor !== post) {
            anchor.insertAdjacentElement('afterend', panel);
            anchor.insertAdjacentElement('afterend', button);
        } else {
            post.prepend(panel);
            post.prepend(button);
        }
    });
}

function injectSimplifyVisibleButton() {
    if (document.getElementById('accessplus-simplify-visible-btn')) return;

    const button = document.createElement('button');
    button.id = 'accessplus-simplify-visible-btn';
    button.type = 'button';
    button.textContent = 'Simplify visible post';

    button.addEventListener('click', async () => {
        const best = findBestVisiblePost();
        if (!best) {
            button.textContent = 'No long post found';
            window.setTimeout(() => {
                button.textContent = 'Simplify visible post';
            }, 1500);
            return;
        }

        let panel = best.post.querySelector(':scope > .accessplus-simplified-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'accessplus-simplified-panel';
            best.post.prepend(panel);
        }

        panel.hidden = false;
        await simplifyPostText(best.text, button, panel);
        button.textContent = 'Simplify visible post';
        button.disabled = false;
    });

    document.body.appendChild(button);
}

function removeSimplifyButtons() {
    document.querySelectorAll('.accessplus-simplify-btn, .accessplus-simplified-panel, #accessplus-simplify-visible-btn')
        .forEach(el => el.remove());

    findLinkedInPosts().forEach((post) => {
        delete post.dataset.accessplusSimplifierReady;
    });
}

function applySimplifyPrefs(prefs = DEFAULT_SIMPLIFY_PREFS) {
    simplifyPrefs = { ...DEFAULT_SIMPLIFY_PREFS, ...prefs };

    if (simplifyPrefs.enabled) {
        addSimplifyButtons();
    } else {
        removeSimplifyButtons();
    }
}

function startSimplifierObserver() {
    if (simplifyObserver) return;

    simplifyObserver = new MutationObserver(() => {
        window.clearTimeout(startSimplifierObserver.scanTimer);
        startSimplifierObserver.scanTimer = window.setTimeout(addSimplifyButtons, 500);
    });

    simplifyObserver.observe(document.body, { childList: true, subtree: true });
    window.setInterval(addSimplifyButtons, 2000);
}

// ==========================================
// FEATURE 5: READING MODES
// Applies dyslexia-friendly and neurodivergent-friendly display options.
// ==========================================

const DEFAULT_READING_PREFS = {
    largerText: false,
    increasedSpacing: false,
    dyslexiaFont: false,
    highContrast: false,
    reduceMotion: false,
    hideClutter: false,
};

function ensureReadingModeStyles() {
    if (document.getElementById('accessplus-reading-mode-styles')) return;

    const style = document.createElement('style');
    style.id = 'accessplus-reading-mode-styles';
    style.textContent = `
        html.accessplus-larger-text body,
        html.accessplus-larger-text p,
        html.accessplus-larger-text span,
        html.accessplus-larger-text li,
        html.accessplus-larger-text a,
        html.accessplus-larger-text button,
        html.accessplus-larger-text input,
        html.accessplus-larger-text textarea {
            font-size: 18px !important;
        }

        html.accessplus-spacing body,
        html.accessplus-spacing p,
        html.accessplus-spacing span,
        html.accessplus-spacing li {
            line-height: 1.8 !important;
            letter-spacing: 0.04em !important;
            word-spacing: 0.12em !important;
        }

        html.accessplus-dyslexia-font body,
        html.accessplus-dyslexia-font p,
        html.accessplus-dyslexia-font span,
        html.accessplus-dyslexia-font li,
        html.accessplus-dyslexia-font a,
        html.accessplus-dyslexia-font button,
        html.accessplus-dyslexia-font input,
        html.accessplus-dyslexia-font textarea {
            font-family: Verdana, Arial, Tahoma, sans-serif !important;
        }

        html.accessplus-high-contrast body {
            background: #ffffff !important;
            color: #111111 !important;
        }

        html.accessplus-high-contrast main,
        html.accessplus-high-contrast section,
        html.accessplus-high-contrast article,
        html.accessplus-high-contrast div[class*="feed"],
        html.accessplus-high-contrast div[class*="jobs"],
        html.accessplus-high-contrast div[class*="msg"] {
            background-color: #ffffff !important;
            color: #111111 !important;
        }

        html.accessplus-high-contrast a,
        html.accessplus-high-contrast button {
            color: #004182 !important;
        }

        html.accessplus-high-contrast img,
        html.accessplus-high-contrast video {
            filter: contrast(1.15) saturate(1.05) !important;
        }

        html.accessplus-reduce-motion *,
        html.accessplus-reduce-motion *::before,
        html.accessplus-reduce-motion *::after {
            animation-duration: 0.001s !important;
            animation-iteration-count: 1 !important;
            scroll-behavior: auto !important;
            transition-duration: 0.001s !important;
        }

        html.accessplus-hide-clutter aside,
        html.accessplus-hide-clutter [class*="right-rail"],
        html.accessplus-hide-clutter [class*="ad-banner"],
        html.accessplus-hide-clutter [class*="premium"],
        html.accessplus-hide-clutter [data-view-name="feed-full-recommendations"] {
            display: none !important;
        }
    `;
    document.head.appendChild(style);
}

function applyReadingPrefs(prefs = DEFAULT_READING_PREFS) {
    ensureReadingModeStyles();

    const mergedPrefs = { ...DEFAULT_READING_PREFS, ...prefs };
    const root = document.documentElement;

    root.classList.toggle('accessplus-larger-text', mergedPrefs.largerText);
    root.classList.toggle('accessplus-spacing', mergedPrefs.increasedSpacing);
    root.classList.toggle('accessplus-dyslexia-font', mergedPrefs.dyslexiaFont);
    root.classList.toggle('accessplus-high-contrast', mergedPrefs.highContrast);
    root.classList.toggle('accessplus-reduce-motion', mergedPrefs.reduceMotion);
    root.classList.toggle('accessplus-hide-clutter', mergedPrefs.hideClutter);
}

// ==========================================
// INITIALIZATION
// ==========================================
chrome.storage.local.get(['intentLock', 'lockActive'], (data) => {
    if (data.lockActive && data.intentLock) {
        injectBanner(data.intentLock);
    }
});

chrome.storage.local.get(['readingPrefs'], (data) => {
    applyReadingPrefs(data.readingPrefs);
});

chrome.storage.local.get(['simplifyPrefs'], (data) => {
    applySimplifyPrefs(data.simplifyPrefs);
    startSimplifierObserver();
});

injectTTSButton();

window.setTimeout(() => {
    chrome.storage.local.get(['simplifyPrefs'], (data) => {
        const prefs = { ...DEFAULT_SIMPLIFY_PREFS, ...(data.simplifyPrefs || {}) };
        if (prefs.enabled) {
            ensureSimplifierStyles();
            injectSimplifyVisibleButton();
        }
    });
}, 1000);
