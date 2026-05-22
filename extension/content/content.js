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

    // Find the job description container to inject after
    const anchorSelectors = [
        '.jobs-description__content',
        '.jobs-description-content__text',
        '.jobs-box__html-content',
        '[class*="jobs-description"]',
        '.description__text',
    ];
    let anchor = null;
    for (const sel of anchorSelectors) {
        anchor = document.querySelector(sel);
        if (anchor) break;
    }

    // Fallback: inject after the "About the job" heading's container
    if (!anchor) {
        const headings = Array.from(document.querySelectorAll('h2, h3'));
        for (const h of headings) {
            if (h.innerText.trim().toLowerCase() === 'about the job') {
                anchor = h.closest('section') || h.parentElement;
                break;
            }
        }
    }

    if (!anchor) return;

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
                margin: 16px 0;
                border: 2px solid #0a66c2;
                border-radius: 10px;
                font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                font-size: 13px;
                background: #fff;
                overflow: hidden;
            }
            .ain-header {
                background: #0a66c2;
                color: white;
                padding: 10px 16px;
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            .ain-header-title { font-weight: 700; font-size: 14px; }
            .ain-close {
                cursor: pointer; background: rgba(255,255,255,0.2);
                border: none; color: white; border-radius: 50%;
                width: 22px; height: 22px; font-size: 14px;
                display: flex; align-items: center; justify-content: center;
                cursor: pointer;
            }
            .ain-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
            .ain-score-row { display: flex; align-items: center; gap: 10px; }
            .ain-score-badge {
                padding: 3px 12px; border-radius: 20px;
                font-weight: 700; color: white; font-size: 13px;
                background: ${scoreColor};
            }
            .ain-score-label { font-weight: 600; }
            .ain-score-explain { font-size: 11px; color: #666; margin-top: 2px; }
            .ain-section { display: flex; flex-direction: column; gap: 6px; }
            .ain-title {
                font-weight: 700; font-size: 11px; color: #0a66c2;
                text-transform: uppercase; letter-spacing: 0.4px;
            }
            .ain-summary { line-height: 1.6; color: #333; }
            ul.ain-list { padding-left: 18px; margin: 0; display: flex; flex-direction: column; gap: 4px; }
            ul.ain-list li { line-height: 1.5; color: #333; }
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

    anchor.insertAdjacentElement('afterend', panel);

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
    if (msg.type === 'ACTIVATE_LOCK') injectBanner(msg.intent);
    if (msg.type === 'DEACTIVATE_LOCK') removeBanner();
});

// ==========================================
// INITIALIZATION
// ==========================================
chrome.storage.local.get(['intentLock', 'lockActive'], (data) => {
    if (data.lockActive && data.intentLock) {
        injectBanner(data.intentLock);
    }
});

injectTTSButton();