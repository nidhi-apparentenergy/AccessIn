// ==========================================
// UTILITIES
// ==========================================

/**
 * Safely escape a string for insertion into HTML.
 * Prevents XSS when injecting user-supplied or AI-generated text into innerHTML.
 */
function escapeHTML(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
}

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

    // Build banner content safely — no innerHTML with user data
    const focusSpan = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = intent;          // textContent — safe
    focusSpan.appendChild(document.createTextNode('🎯 Focus: '));
    focusSpan.appendChild(strong);

    const doneBtn = document.createElement('span');
    doneBtn.id = 'accessplus-done';
    doneBtn.textContent = 'Done ✓';
    doneBtn.style.cssText = 'cursor:pointer; background:white; color:#0a66c2; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:600;';

    banner.appendChild(focusSpan);
    banner.appendChild(doneBtn);

    document.body.prepend(banner);
    document.body.style.marginTop = '44px';

    hideFeed();

    doneBtn.addEventListener('click', () => {
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

// Cache management — only re-query the DOM when the page changes
let textBlocksStale = true;
const domObserver = new MutationObserver(() => { textBlocksStale = true; });
domObserver.observe(document.body, { childList: true, subtree: true });

function refreshTextBlocks() {
    if (!textBlocksStale) return;   // use cached list if DOM hasn't changed

    // Clear outlines on old blocks before rebuilding the list
    textBlocks.forEach(el => { if (el) el.style.outline = 'none'; });

    const allElements = document.querySelectorAll('p, span[dir="ltr"], h1, h2, h3');

    textBlocks = Array.from(allElements).filter(el => {
        const text = el.innerText ? el.innerText.trim() : "";

        if (text.length < 2) return false;

        // Skip our own injected captions / panels
        if (el.classList.contains('accessin-caption')) return false;
        if (el.closest('#accessin-analysis-panel, #accessplus-banner, #accessplus-tts-btn')) return false;

        // Skip UI chrome
        if (el.closest('button, nav, header, footer, [role="button"], [role="navigation"], .global-nav, .search-global-typeahead')) {
            return false;
        }

        // Skip notification badges, counters, reaction counts
        if (/^\d+$/.test(text)) return false;

        // Skip elements inside image containers
        if (el.closest('figure, [data-view-name*="image"], .feed-shared-image, .update-components-image')) {
            return false;
        }

        return true;
    });

    textBlocksStale = false;
}

// --- THE GEOMETRY ENGINE ---
function findNearestItem(direction) {
    refreshTextBlocks();
    if (textBlocks.length === 0) return -1;

    if (currentItemIndex < 0 || currentItemIndex >= textBlocks.length) return 0;

    const currentEl = textBlocks[currentItemIndex];
    const currentRect = currentEl.getBoundingClientRect();

    const cx = currentRect.left + currentRect.width / 2;
    const cy = currentRect.top + currentRect.height / 2;

    let bestIndex = -1;
    let minDistance = Infinity;

    textBlocks.forEach((el, index) => {
        if (index === currentItemIndex) return;

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const ex = rect.left + rect.width / 2;
        const ey = rect.top + rect.height / 2;

        let isValidDirection = false;
        if (direction === 'up'    && ey < cy - 10) isValidDirection = true;
        if (direction === 'down'  && ey > cy + 10) isValidDirection = true;
        if (direction === 'left'  && ex < cx - 10) isValidDirection = true;
        if (direction === 'right' && ex > cx + 10) isValidDirection = true;

        if (isValidDirection) {
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
        const highlighted = window.getSelection().toString().trim();
        speakText(highlighted || "No readable text found.");
        return;
    }

    if (index < 0 || index >= textBlocks.length) return;

    window.speechSynthesis.cancel();

    // Clear previous outline
    if (currentItemIndex >= 0 && textBlocks[currentItemIndex]) {
        textBlocks[currentItemIndex].style.outline = 'none';
    }

    currentItemIndex = index;
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
    // Only strip UI action words when they appear as standalone tokens,
    // not when they're part of real sentences.
    const cleanText = text
        .replace(/\b(Like|Comment|Share|Send|Reply)\b(?=\s*$|\s*\n)/gm, '')
        .trim();

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
// THE SPATIAL KEYBOARD LISTENER
// ==========================================
document.addEventListener('keydown', (e) => {
    if (!e.altKey) return;

    if (e.code === 'ArrowUp') {
        e.preventDefault();
        const nextIdx = findNearestItem('up');
        if (nextIdx !== -1) readItemAt(nextIdx);
    }

    if (e.code === 'ArrowDown') {
        e.preventDefault();
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

    if (e.code === 'KeyS') {
        e.preventDefault();
        window.speechSynthesis.cancel();
        isReading = false;
        updateButtonUI("🔊 Read Aloud\n(Alt+Arrows)");
        if (currentItemIndex >= 0 && textBlocks[currentItemIndex]) {
            textBlocks[currentItemIndex].style.outline = 'none';
        }
    }

    if (e.code === 'Equal' || e.key === '+') {
        e.preventDefault();
        currentSpeed = Math.min(2.0, parseFloat((currentSpeed + 0.1).toFixed(1)));
        announceSpeed();
    }

    if (e.code === 'Minus' || e.key === '-') {
        e.preventDefault();
        currentSpeed = Math.max(0.5, parseFloat((currentSpeed - 0.1).toFixed(1)));
        announceSpeed();
    }
});

window.addEventListener('beforeunload', () => {
    window.speechSynthesis.cancel();
    domObserver.disconnect();
    msgObserver.disconnect();
});

// ==========================================
// FEATURE 4: VISUAL NOTIFICATION ALERTS
// Flash/pulse the page for new LinkedIn messages
// so deaf / hard-of-hearing users aren't reliant
// on sound to notice incoming messages.
// ==========================================

// ── Inject keyframe styles once ───────────────────────────────────────────────
(function injectVisualAlertStyles() {
    if (document.getElementById('accessin-alert-styles')) return;
    const style = document.createElement('style');
    style.id = 'accessin-alert-styles';
    style.textContent = `
        /* Full-viewport flash overlay */
        @keyframes accessin-flash {
            0%   { opacity: 0.55; }
            40%  { opacity: 0.55; }
            100% { opacity: 0;    }
        }
        #accessin-flash-overlay {
            pointer-events: none;
            position: fixed;
            inset: 0;
            z-index: 2147483646;
            opacity: 0;
            animation: accessin-flash 700ms ease-out forwards;
        }

        /* Reduced-motion: swap flash for a border pulse instead */
        @media (prefers-reduced-motion: reduce) {
            @keyframes accessin-border-pulse {
                0%, 100% { box-shadow: inset 0 0 0 0px var(--ain-alert-color, #0a66c2); }
                50%       { box-shadow: inset 0 0 0 6px var(--ain-alert-color, #0a66c2); }
            }
            #accessin-flash-overlay {
                animation: accessin-border-pulse 900ms ease-in-out 2 forwards;
                background: transparent !important;
            }
        }

        /* Toast notification badge */
        @keyframes accessin-toast-in {
            from { transform: translateY(16px); opacity: 0; }
            to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes accessin-toast-out {
            from { transform: translateY(0);    opacity: 1; }
            to   { transform: translateY(16px); opacity: 0; }
        }
        .accessin-toast {
            position: fixed;
            bottom: 80px;          /* sit above the TTS button */
            right: 20px;
            z-index: 2147483647;
            max-width: 280px;
            background: #1a1a1a;
            color: #fff;
            border-radius: 10px;
            padding: 10px 14px;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 13px;
            line-height: 1.4;
            box-shadow: 0 4px 16px rgba(0,0,0,0.35);
            display: flex;
            align-items: flex-start;
            gap: 10px;
            animation: accessin-toast-in 250ms ease-out forwards;
            cursor: pointer;
        }
        .accessin-toast.removing {
            animation: accessin-toast-out 250ms ease-in forwards;
        }
        .accessin-toast-icon {
            font-size: 18px;
            flex-shrink: 0;
            margin-top: 1px;
        }
        .accessin-toast-body { display: flex; flex-direction: column; gap: 2px; }
        .accessin-toast-title { font-weight: 700; font-size: 12px; color: #aaa; }
        .accessin-toast-sender { font-weight: 700; font-size: 13px; }
        .accessin-toast-preview { font-size: 12px; color: #ccc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
        .accessin-toast-dismiss {
            margin-left: auto;
            flex-shrink: 0;
            background: rgba(255,255,255,0.15);
            border: none;
            color: white;
            border-radius: 50%;
            width: 18px; height: 18px;
            font-size: 11px;
            cursor: pointer;
            display: flex; align-items: center; justify-content: center;
        }
    `;
    document.head.appendChild(style);
})();

// ── State ─────────────────────────────────────────────────────────────────────
let visualAlertsEnabled = true;   // default on; synced from storage
let alertColor = '#0a66c2';       // default LinkedIn blue; user-configurable
let toastQueue = [];              // active toast elements
const MAX_TOASTS = 3;

// Load persisted prefs
chrome.storage.local.get(['visualAlertsEnabled', 'alertColor'], (prefs) => {
    if (typeof prefs.visualAlertsEnabled === 'boolean') {
        visualAlertsEnabled = prefs.visualAlertsEnabled;
    }
    if (prefs.alertColor) alertColor = prefs.alertColor;
});

// Keep prefs in sync if the user changes them while the tab is open
chrome.storage.onChanged.addListener((changes) => {
    if (changes.visualAlertsEnabled) {
        visualAlertsEnabled = changes.visualAlertsEnabled.newValue;
    }
    if (changes.alertColor) {
        alertColor = changes.alertColor.newValue;
    }
});

// ── Flash overlay ─────────────────────────────────────────────────────────────
function triggerFlash() {
    // Remove any existing overlay first so re-triggering restarts the animation
    const old = document.getElementById('accessin-flash-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'accessin-flash-overlay';
    overlay.style.background = alertColor;
    overlay.style.setProperty('--ain-alert-color', alertColor);
    document.body.appendChild(overlay);

    // Clean up after animation completes (700ms flash + small buffer)
    overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
}

// ── Toast notification ────────────────────────────────────────────────────────
function showToast(sender, preview) {
    // Cap the queue — remove oldest if full
    if (toastQueue.length >= MAX_TOASTS) {
        dismissToast(toastQueue[0]);
    }

    const toast = document.createElement('div');
    toast.className = 'accessin-toast';
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');

    // Offset stacked toasts upward
    const stackOffset = toastQueue.length * 76;
    toast.style.bottom = `${80 + stackOffset}px`;

    const icon = document.createElement('span');
    icon.className = 'accessin-toast-icon';
    icon.textContent = '💬';

    const body = document.createElement('div');
    body.className = 'accessin-toast-body';

    const title = document.createElement('span');
    title.className = 'accessin-toast-title';
    title.textContent = 'New Message';

    const senderEl = document.createElement('span');
    senderEl.className = 'accessin-toast-sender';
    senderEl.textContent = sender;   // already plain text from DOM — safe

    const previewEl = document.createElement('span');
    previewEl.className = 'accessin-toast-preview';
    previewEl.textContent = preview;

    body.appendChild(title);
    body.appendChild(senderEl);
    if (preview) body.appendChild(previewEl);

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'accessin-toast-dismiss';
    dismissBtn.textContent = '✕';
    dismissBtn.setAttribute('aria-label', 'Dismiss notification');
    dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissToast(toast);
    });

    toast.appendChild(icon);
    toast.appendChild(body);
    toast.appendChild(dismissBtn);

    // Clicking the toast navigates to the messaging panel
    toast.addEventListener('click', () => {
        const msgLink = document.querySelector('a[href*="/messaging/"]');
        if (msgLink) msgLink.click();
        dismissToast(toast);
    });

    document.body.appendChild(toast);
    toastQueue.push(toast);

    // Auto-dismiss after 6 seconds
    setTimeout(() => dismissToast(toast), 6000);
}

function dismissToast(toast) {
    if (!toast || !toast.isConnected) return;
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => {
        toast.remove();
        toastQueue = toastQueue.filter(t => t !== toast);
        // Re-stack remaining toasts
        toastQueue.forEach((t, i) => { t.style.bottom = `${80 + i * 76}px`; });
    }, { once: true });
}

// ── LinkedIn message DOM watcher ──────────────────────────────────────────────

/**
 * LinkedIn renders new messages as list items inside the conversation thread.
 * We watch the messaging overlay container for added nodes and check whether
 * the newest message was sent by someone else (not the current user).
 *
 * Selectors used (as of 2025 — LinkedIn changes these periodically):
 *   Conversation list item : .msg-conversation-listitem, [data-view-name*="conversation"]
 *   Message bubble         : .msg-s-message-list__event, .msg-s-event-listitem
 *   Sender name            : .msg-s-message-group__name, .msg-s-event-listitem__link
 *   Message text           : .msg-s-event-listitem__body, .msg-s-message-list__event p
 *   "You" indicator        : .msg-s-message-group--outgoing, [data-view-name*="outgoing"]
 */

// Tracks the last seen message to avoid double-firing
let lastSeenMsgId = null;
// Cooldown — don't fire more than once per second
let lastFlashTime = 0;

// All known LinkedIn message node selectors (class-based + data-view-name-based)
// LinkedIn changes these frequently; we cast a wide net.
const MSG_NODE_SELECTORS = [
    '.msg-s-event-listitem',
    '.msg-s-message-list__event',
    '.msg-convo-wrapper',
    '[data-view-name="message-list-item"]',
    '[data-view-name*="message-list-item"]',
    '[class*="msg-s-event"]',
    '[class*="msg-s-message-list"]',
];

// Outgoing message indicators
const OUTGOING_SELECTORS = [
    '.msg-s-message-group--outgoing',
    '[data-view-name*="outgoing"]',
    '[class*="outgoing"]',
];

function isOutgoingNode(node) {
    for (const sel of OUTGOING_SELECTORS) {
        if (node.matches?.(sel) || node.closest?.(sel)) return true;
    }
    return false;
}

function findMessageNode(node) {
    if (!(node instanceof HTMLElement)) return null;
    // Direct match
    for (const sel of MSG_NODE_SELECTORS) {
        if (node.matches?.(sel)) return node;
    }
    // Descendant match
    for (const sel of MSG_NODE_SELECTORS) {
        const inner = node.querySelector(sel);
        if (inner) return inner;
    }
    return null;
}

function handleNewMessageNode(node) {
    if (!visualAlertsEnabled) return;
    if (!(node instanceof HTMLElement)) return;
    if (isOutgoingNode(node)) return;

    // Cooldown — max one flash per second
    const now = Date.now();
    if (now - lastFlashTime < 1000) return;
    lastFlashTime = now;

    // Extract sender name — try several selectors
    const senderEl =
        node.querySelector('.msg-s-message-group__name') ||
        node.querySelector('.msg-s-event-listitem__link') ||
        node.querySelector('[class*="message-group__name"]') ||
        node.querySelector('[class*="participant-name"]') ||
        node.closest('[class*="msg-s-message-group"]')?.querySelector('[class*="name"]');

    const sender = senderEl?.innerText?.trim() || 'New message';

    // Extract message preview text
    const bodyEl =
        node.querySelector('.msg-s-event-listitem__body') ||
        node.querySelector('[class*="event-listitem__body"]') ||
        node.querySelector('[class*="message-body"]') ||
        node.querySelector('p');

    const preview = bodyEl?.innerText?.trim().slice(0, 80) || '';

    // Deduplicate
    const msgId = sender + ':' + preview;
    if (msgId === lastSeenMsgId) return;
    lastSeenMsgId = msgId;

    triggerFlash();
    showToast(sender, preview);
}

// Observe the full document for messaging panel mutations.
// LinkedIn is a SPA — the messaging panel mounts/unmounts dynamically.
const msgObserver = new MutationObserver((mutations) => {
    if (!visualAlertsEnabled) return;
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            const msgNode = findMessageNode(node);
            if (msgNode) handleNewMessageNode(msgNode);
        }
    }
});

msgObserver.observe(document.body, { childList: true, subtree: true });

// ==========================================
// FEATURE 3: JOB ANALYZER
// ==========================================

function extractJobDescription() {
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

    const allElements = Array.from(document.querySelectorAll('h1, h2, h3, h4'));
    for (const heading of allElements) {
        const text = heading.innerText.trim().toLowerCase();
        if (text === 'about the job' || text === 'job description') {
            let container = heading.parentElement;
            for (let i = 0; i < 4; i++) {
                if (container && container.innerText.trim().length > 150) {
                    return container.innerText.trim();
                }
                container = container?.parentElement;
            }
        }
    }

    const rightPanel = document.querySelector(
        '.jobs-search__job-details, .job-details, [class*="job-details"], .scaffold-layout__detail'
    );
    if (rightPanel && rightPanel.innerText.trim().length > 150) {
        return rightPanel.innerText.trim();
    }

    const candidates = Array.from(document.querySelectorAll('div, section, article'));
    for (const el of candidates) {
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

    // ── Build bias flags HTML safely ──────────────────────────────────────────
    let biasHTML = '';
    if (data.bias_flags && data.bias_flags.length > 0) {
        const flagsInner = data.bias_flags.map(f => `
            <div class="ain-bias-item">
                <span class="ain-bias-phrase">"${escapeHTML(f.phrase)}"</span>
                <span class="ain-bias-issue">${escapeHTML(f.issue)}</span>
                <span class="ain-bias-fix">✅ ${escapeHTML(f.suggestion)}</span>
            </div>`).join('');
        biasHTML = `<div class="ain-section">
            <div class="ain-title">⚠️ Bias Flags</div>
            ${flagsInner}
        </div>`;
    }

    const highlightsHTML = (data.key_highlights || [])
        .map(h => `<li>${escapeHTML(h)}</li>`).join('');

    const skillsHTML = (data.key_skills || [])
        .map(s => `<span class="ain-tag">${escapeHTML(s)}</span>`).join('');

    const tipsHTML = (data.match_tips || [])
        .map(t => `<li>${escapeHTML(t)}</li>`).join('');

    const panel = document.createElement('div');
    panel.id = 'accessin-analysis-panel';

    // Styles injected once via a <style> tag scoped to the panel id
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
            <button class="ain-close" id="ain-close-btn" aria-label="Close analysis panel">✕</button>
        </div>
        <div class="ain-body">
            <div>
                <div class="ain-score-row">
                    <span class="ain-score-label">Sensory Load</span>
                    <span class="ain-score-badge">${escapeHTML(String(data.sensory_load_score))} / 10</span>
                </div>
                <div class="ain-score-explain">${escapeHTML(data.sensory_load_explanation)}</div>
            </div>
            <div class="ain-section">
                <div class="ain-title">📋 Simplified Summary</div>
                <div class="ain-summary">${escapeHTML(data.simplified_summary)}</div>
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
    if (msg.type === 'GET_PROFILE_CONTENT') {
        sendResponse({ profile: extractProfileContent() });
        return true;
    }
    if (msg.type === 'INJECT_PROFILE_SCORE') {
        injectProfileScorePanel(msg.data);
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
    if (msg.type === 'SET_VISUAL_ALERTS') {
        visualAlertsEnabled = msg.enabled;
        sendResponse({ ok: true });
    }
    if (msg.type === 'SET_ALERT_COLOR') {
        alertColor = msg.color;
        sendResponse({ ok: true });
    }
    if (msg.type === 'TEST_FLASH') {
        triggerFlash();
        showToast('Test', 'Flash is working! 🎉');
        sendResponse({ ok: true });
    }
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

// function escapeHTML(value) {
//     return String(value)
//         .replace(/&/g, '&amp;')
//         .replace(/</g, '&lt;')
//         .replace(/>/g, '&gt;')
//         .replace(/"/g, '&quot;')
//         .replace(/'/g, '&#039;');
// }

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

// ==========================================
// FEATURE 5: PROFILE ACCESSIBILITY SCORE
// Extracts LinkedIn profile content and injects
// an accessibility score panel on the page.
// ==========================================

function extractProfileContent() {
    const profile = {};

    // ── Name ─────────────────────────────────────────────────────────────────
    // Try every known LinkedIn h1 pattern
    const nameEl =
        document.querySelector('h1.text-heading-xlarge') ||
        document.querySelector('h1[class*="heading"]') ||
        document.querySelector('h1[class*="title"]') ||
        document.querySelector('.pv-top-card--list h1') ||
        document.querySelector('main h1');
    profile.name = nameEl?.innerText?.trim() || '';

    // ── Headline ──────────────────────────────────────────────────────────────
    // The headline sits right below the name — grab the first non-empty div/span
    // after the h1 that isn't a location or connection count
    const headlineEl =
        document.querySelector('.text-body-medium.break-words') ||
        document.querySelector('[data-generated-suggestion-target]') ||
        document.querySelector('.pv-top-card-section__headline') ||
        document.querySelector('[class*="top-card"] [class*="headline"]') ||
        document.querySelector('[class*="profile-info"] [class*="subtitle"]');

    // Fallback: second meaningful text node after h1
    if (!headlineEl && nameEl) {
        let sibling = nameEl.nextElementSibling;
        while (sibling) {
            const t = sibling.innerText?.trim();
            if (t && t.length > 5 && !/^\d+/.test(t)) {
                profile.headline = t;
                break;
            }
            sibling = sibling.nextElementSibling;
        }
    } else {
        profile.headline = headlineEl?.innerText?.trim() || '';
    }

    // ── About ─────────────────────────────────────────────────────────────────
    // Strategy 1: anchor by #about id
    const aboutAnchor = document.getElementById('about');
    if (aboutAnchor) {
        const section = aboutAnchor.closest('section') || aboutAnchor.parentElement;
        const text = section?.innerText?.replace(/^About\s*/i, '').trim();
        if (text && text.length > 10) {
            profile.about = text.slice(0, 3000);
        }
    }

    // Strategy 2: data-view-name
    if (!profile.about) {
        const aboutSection =
            document.querySelector('[data-view-name*="profile-card-about"]') ||
            document.querySelector('[data-view-name*="about"]');
        const text = aboutSection?.innerText?.replace(/^About\s*/i, '').trim();
        if (text && text.length > 10) profile.about = text.slice(0, 3000);
    }

    // Strategy 3: find any section whose heading says "About"
    if (!profile.about) {
        const headings = Array.from(document.querySelectorAll('h2, h3, span[class*="title"]'));
        for (const h of headings) {
            if (h.innerText?.trim().toLowerCase() === 'about') {
                const section = h.closest('section') || h.parentElement?.parentElement;
                const text = section?.innerText?.replace(/^About\s*/i, '').trim();
                if (text && text.length > 10) {
                    profile.about = text.slice(0, 3000);
                    break;
                }
            }
        }
    }

    // ── Experience ────────────────────────────────────────────────────────────
    const expAnchor = document.getElementById('experience');
    if (expAnchor) {
        const section = expAnchor.closest('section') || expAnchor.parentElement;
        const text = section?.innerText?.replace(/^Experience\s*/i, '').trim();
        if (text && text.length > 10) profile.experience = text.slice(0, 3000);
    }

    if (!profile.experience) {
        const expSection =
            document.querySelector('[data-view-name*="profile-card-experience"]') ||
            document.querySelector('[data-view-name*="experience"]');
        const text = expSection?.innerText?.replace(/^Experience\s*/i, '').trim();
        if (text && text.length > 10) profile.experience = text.slice(0, 3000);
    }

    // ── Last resort: grab the whole main profile card text ────────────────────
    // If we still have nothing useful, pull from the main content area
    if (!profile.headline && !profile.about) {
        const mainContent =
            document.querySelector('main') ||
            document.querySelector('[class*="scaffold-layout__main"]') ||
            document.querySelector('[class*="profile-view"]');
        if (mainContent) {
            const fullText = mainContent.innerText?.trim().slice(0, 5000) || '';
            if (fullText.length > 50) {
                // Use it as the "about" so we have something to score
                profile.about = fullText;
            }
        }
    }

    profile.profile_url = window.location.href;
    return profile;
}

function removeProfileScorePanel() {
    document.getElementById('accessin-profile-score-panel')?.remove();
}

function injectProfileScorePanel(data) {
    removeProfileScorePanel();

    // Grade color
    const gradeColor = {
        A: '#27ae60', B: '#2ecc71', C: '#e67e22', D: '#e74c3c', F: '#c0392b'
    }[data.grade] || '#888';

    // Score ring color
    const ringColor = data.overall_score >= 85 ? '#27ae60'
        : data.overall_score >= 70 ? '#2ecc71'
        : data.overall_score >= 55 ? '#e67e22'
        : data.overall_score >= 40 ? '#e74c3c' : '#c0392b';

    // Breakdown rows
    const breakdownHTML = (data.breakdown || []).map(item => {
        const barColor = item.score >= 8 ? '#27ae60' : item.score >= 5 ? '#e67e22' : '#e74c3c';
        const barWidth = (item.score / 10) * 100;
        return `
        <div class="aps-breakdown-row">
            <div class="aps-breakdown-header">
                <span class="aps-breakdown-cat">${escapeHTML(item.category)}</span>
                <span class="aps-breakdown-score" style="color:${barColor}">${item.score}/10</span>
            </div>
            <div class="aps-bar-track">
                <div class="aps-bar-fill" style="width:${barWidth}%;background:${barColor}"></div>
            </div>
            <div class="aps-breakdown-feedback">${escapeHTML(item.feedback)}</div>
            <div class="aps-breakdown-tip">💡 ${escapeHTML(item.tip)}</div>
        </div>`;
    }).join('');

    const winsHTML = (data.top_wins || []).map(w => `<li>✅ ${escapeHTML(w)}</li>`).join('');
    const fixesHTML = (data.top_fixes || []).map(f => `<li>🔧 ${escapeHTML(f)}</li>`).join('');

    const panel = document.createElement('div');
    panel.id = 'accessin-profile-score-panel';
    panel.innerHTML = `
        <style>
            #accessin-profile-score-panel {
                position: fixed;
                top: 72px;
                right: 24px;
                bottom: 24px;
                width: 380px;
                max-width: calc(100vw - 32px);
                z-index: 999999;
                border: 2px solid #0a66c2;
                border-radius: 12px;
                font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                font-size: 13px;
                background: #fff;
                box-shadow: 0 18px 48px rgba(0,0,0,0.22);
                overflow: hidden;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
            }
            .aps-header {
                background: #0a66c2;
                color: white;
                padding: 12px 16px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex-shrink: 0;
            }
            .aps-header-title { font-weight: 700; font-size: 14px; }
            .aps-close {
                cursor: pointer; background: rgba(255,255,255,0.2);
                border: none; color: white; border-radius: 50%;
                width: 26px; height: 26px; font-size: 14px;
                display: flex; align-items: center; justify-content: center;
            }
            .aps-body {
                flex: 1;
                overflow-y: auto;
                padding: 14px 16px 18px;
                display: flex;
                flex-direction: column;
                gap: 14px;
                box-sizing: border-box;
            }
            .aps-score-hero {
                display: flex;
                align-items: center;
                gap: 16px;
            }
            .aps-score-ring {
                width: 72px; height: 72px;
                border-radius: 50%;
                border: 5px solid ${ringColor};
                display: flex; flex-direction: column;
                align-items: center; justify-content: center;
                flex-shrink: 0;
            }
            .aps-score-number {
                font-size: 22px; font-weight: 800;
                color: ${ringColor}; line-height: 1;
            }
            .aps-score-label { font-size: 10px; color: #888; }
            .aps-grade-badge {
                padding: 4px 14px; border-radius: 20px;
                font-weight: 800; font-size: 18px;
                color: white; background: ${gradeColor};
                display: inline-block;
            }
            .aps-summary { font-size: 12px; color: #444; line-height: 1.6; }
            .aps-section-title {
                font-weight: 700; font-size: 11px; color: #0a66c2;
                text-transform: uppercase; letter-spacing: 0.4px;
                margin-bottom: 4px;
            }
            .aps-breakdown-row {
                display: flex; flex-direction: column; gap: 3px;
                padding: 8px 10px;
                background: #f8f9fa;
                border-radius: 6px;
            }
            .aps-breakdown-header {
                display: flex; justify-content: space-between; align-items: center;
            }
            .aps-breakdown-cat { font-weight: 600; font-size: 12px; }
            .aps-breakdown-score { font-weight: 700; font-size: 12px; }
            .aps-bar-track {
                height: 5px; background: #e0e0e0; border-radius: 3px; overflow: hidden;
            }
            .aps-bar-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }
            .aps-breakdown-feedback { font-size: 11px; color: #555; }
            .aps-breakdown-tip { font-size: 11px; color: #0a66c2; }
            ul.aps-list {
                padding-left: 4px; margin: 0;
                list-style: none;
                display: flex; flex-direction: column; gap: 5px;
            }
            ul.aps-list li { font-size: 12px; color: #333; line-height: 1.5; }
        </style>
        <div class="aps-header">
            <span class="aps-header-title">♿ Profile Accessibility Score</span>
            <button class="aps-close" id="aps-close-btn" aria-label="Close panel">✕</button>
        </div>
        <div class="aps-body">
            <div class="aps-score-hero">
                <div class="aps-score-ring">
                    <span class="aps-score-number">${escapeHTML(String(data.overall_score))}</span>
                    <span class="aps-score-label">/ 100</span>
                </div>
                <div>
                    <div style="margin-bottom:6px">
                        <span class="aps-grade-badge">${escapeHTML(data.grade)}</span>
                    </div>
                    <div class="aps-summary">${escapeHTML(data.summary)}</div>
                </div>
            </div>

            <div>
                <div class="aps-section-title">📊 Breakdown</div>
                <div style="display:flex;flex-direction:column;gap:6px">${breakdownHTML}</div>
            </div>

            ${winsHTML ? `
            <div>
                <div class="aps-section-title">🏆 What's working</div>
                <ul class="aps-list">${winsHTML}</ul>
            </div>` : ''}

            ${fixesHTML ? `
            <div>
                <div class="aps-section-title">🔧 Top improvements</div>
                <ul class="aps-list">${fixesHTML}</ul>
            </div>` : ''}
        </div>
    `;

    document.body.appendChild(panel);
    document.getElementById('aps-close-btn').addEventListener('click', removeProfileScorePanel);
}


// ==========================================
// FEATURE: IMAGE DESCRIBER
// Fixed button like Read Aloud — describes
// the most visible image on screen aloud.
// ==========================================

const DESCRIBE_API_URL = 'http://localhost:8000/describe';
let imageDescriberEnabled = false;

async function fetchImageAsBase64(imgUrl) {
    try {
        const res = await fetch(imgUrl);
        const blob = await res.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                resolve({ base64, mimeType: blob.type || 'image/jpeg' });
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        return null;
    }
}

function findBestVisibleImage() {
    const imgs = Array.from(document.querySelectorAll('img'));

    const visible = imgs.filter(img => {
        if (!img.src || img.src.startsWith('data:')) return false;
        if (img.naturalWidth > 0 && img.naturalWidth < 100) return false;
        const rect = img.getBoundingClientRect();
        return rect.width > 100 &&
               rect.top < window.innerHeight - 50 &&
               rect.bottom > 50;
    });

    if (visible.length === 0) return null;

    const centerY = window.innerHeight / 2;
    return visible.sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        const aMid = (ar.top + ar.bottom) / 2;
        const bMid = (br.top + br.bottom) / 2;
        return Math.abs(aMid - centerY) - Math.abs(bMid - centerY);
    })[0];
}

function injectImageDescriberButton() {
    if (document.getElementById('accessin-describe-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'accessin-describe-btn';
    btn.textContent = '🖼️ Describe Image';
    Object.assign(btn.style, {
        position: 'fixed',
        bottom: '130px',
        right: '20px',
        zIndex: '999999',
        padding: '10px 16px',
        backgroundColor: '#0a66c2',
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        cursor: 'pointer',
        boxShadow: '0 4px 6px rgba(0,0,0,0.2)',
        fontFamily: '-apple-system, sans-serif',
        fontWeight: 'bold',
        fontSize: '13px',
        textAlign: 'center',
        lineHeight: '1.4',
        display: 'block',
    });

    btn.addEventListener('click', async () => {
        const img = findBestVisibleImage();
        if (!img) {
            btn.textContent = '❌ No image found';
            setTimeout(() => { btn.textContent = '🖼️ Describe Image'; }, 2000);
            return;
        }

        btn.textContent = '⏳ Describing...';
        btn.disabled = true;

        const context = img.alt || img.getAttribute('aria-label') || '';
        const imgData = await fetchImageAsBase64(img.src);

        if (!imgData) {
            btn.textContent = '❌ Load failed';
            btn.disabled = false;
            return;
        }

        try {
            const res = await fetch(DESCRIBE_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image_b64: imgData.base64,
                    mime_type: imgData.mimeType,
                    context: context
                })
            });

            if (!res.ok) throw new Error(`Server error ${res.status}`);
            const data = await res.json();

            // Show floating description panel
            let panel = document.getElementById('accessin-desc-panel');
            if (!panel) {
                panel = document.createElement('div');
                panel.id = 'accessin-desc-panel';
                Object.assign(panel.style, {
                    position: 'fixed',
                    bottom: '190px',
                    right: '20px',
                    zIndex: '999998',
                    width: '280px',
                    padding: '12px 16px',
                    background: '#f0f7ff',
                    borderLeft: '4px solid #0a66c2',
                    borderRadius: '8px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    fontFamily: '-apple-system, sans-serif',
                    fontSize: '13px',
                    lineHeight: '1.6',
                    color: '#1a1a1a',
                });
                document.body.appendChild(panel);
            }

            panel.innerHTML = `
                <div style="font-weight:700;color:#0a66c2;font-size:11px;
                            text-transform:uppercase;margin-bottom:6px;">
                    🖼️ Image Description
                    <span id="accessin-desc-close" style="float:right;cursor:pointer;
                          font-size:14px;color:#666;">✕</span>
                </div>
                <div>${data.description || 'No description available.'}</div>
            `;

            document.getElementById('accessin-desc-close')
                .addEventListener('click', () => panel.remove());

            // Speak it aloud
            if (data.description) {
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(data.description);
                utterance.rate = 0.9;
                window.speechSynthesis.speak(utterance);
            }

            btn.textContent = '✅ Described';
            setTimeout(() => {
                btn.textContent = '🖼️ Describe Image';
                btn.disabled = false;
            }, 3000);

        } catch (err) {
            console.error('[AccessIn] describe error:', err);
            btn.textContent = '❌ Failed — retry';
            btn.disabled = false;
        }
    });

    document.body.appendChild(btn);
}

function removeImageDescriberButton() {
    document.getElementById('accessin-describe-btn')?.remove();
    document.getElementById('accessin-desc-panel')?.remove();
}

function applyImageDescriberPref(enabled) {
    imageDescriberEnabled = enabled;
    if (enabled) {
        injectImageDescriberButton();
    } else {
        removeImageDescriberButton();
    }
}

// Listen for toggle from popup
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'APPLY_IMAGE_DESCRIBER_PREF') {
        applyImageDescriberPref(msg.enabled);
    }
});

// Load saved preference on page load
chrome.storage.local.get(['imageDescriberEnabled'], (data) => {
    applyImageDescriberPref(Boolean(data.imageDescriberEnabled));
});

// Also check every 2 seconds in case message was missed
setInterval(() => {
    chrome.storage.local.get(['imageDescriberEnabled'], (data) => {
        const shouldBeEnabled = Boolean(data.imageDescriberEnabled);
        const btnExists = Boolean(document.getElementById('accessin-describe-btn'));
        if (shouldBeEnabled && !btnExists) {
            injectImageDescriberButton();
        } else if (!shouldBeEnabled && btnExists) {
            removeImageDescriberButton();
        }
    });
}, 2000);