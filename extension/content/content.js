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

/**
 * Returns true if the Chrome extension context is still alive.
 * After an extension reload/update, content scripts become orphaned —
 * any call to chrome.runtime / chrome.storage throws
 * "Extension context invalidated". This guard silently swallows that.
 */
function isExtensionContextValid() {
    try {
        // chrome.runtime.id is undefined when the context is gone
        return !!chrome?.runtime?.id;
    } catch (_) {
        return false;
    }
}

/**
 * Safe wrapper for chrome.storage.local.get.
 * Silently no-ops when the extension context has been invalidated.
 */
function safeStorageGet(keys, callback) {
    if (!isExtensionContextValid()) return;
    try {
        chrome.storage.local.get(keys, (data) => {
            if (chrome.runtime.lastError) return; // suppress benign errors
            callback(data);
        });
    } catch (_) { /* extension context invalidated — ignore */ }
}

/**
 * Safe wrapper for chrome.storage.local.set.
 * Silently no-ops when the extension context has been invalidated.
 */
function safeStorageSet(items, callback) {
    if (!isExtensionContextValid()) return;
    try {
        chrome.storage.local.set(items, () => {
            if (chrome.runtime.lastError) return;
            if (callback) callback();
        });
    } catch (_) { /* extension context invalidated — ignore */ }
}

// ==========================================
// FEATURE 1: INTENT LOCK & BANNER LOGIC
// ==========================================

let bannerTimerInterval = null;

function injectBanner(intent) {
    if (document.getElementById('accessplus-banner')) return;

    safeStorageGet(['savedJobs', 'lockEndTime', 'lockActive'], (data) => {
        const jobs = data.savedJobs || [];
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
        focusSpan.style.cssText = 'display: flex; align-items: center; gap: 12px; flex-wrap: wrap;';
        
        const focusLabel = document.createElement('span');
        const strong = document.createElement('strong');
        strong.textContent = intent;
        focusLabel.appendChild(document.createTextNode('🎯 Focus: '));
        focusLabel.appendChild(strong);
        focusSpan.appendChild(focusLabel);

        // Countdown Timer Badge
        let timerBadge = null;
        if (data.lockActive && data.lockEndTime) {
            timerBadge = document.createElement('span');
            timerBadge.id = 'accessplus-timer-badge';
            timerBadge.style.cssText = `
                font-size: 11.5px;
                background: rgba(255, 255, 255, 0.25);
                padding: 3px 10px;
                border-radius: 12px;
                display: inline-flex;
                align-items: center;
                gap: 4px;
                font-weight: 700;
                transition: all 0.3s;
            `;
            focusSpan.appendChild(timerBadge);

            if (bannerTimerInterval) clearInterval(bannerTimerInterval);

            const triggerVisualAlertSequence = () => {
                let flashCount = 0;
                const flashInterval = setInterval(() => {
                    triggerFlash();
                    flashCount++;
                    if (flashCount >= 3) {
                        clearInterval(flashInterval);
                    }
                }, 1000);
            };

            const updateBannerTimer = () => {
                safeStorageGet(['lockEndTime', 'lockActive'], (res) => {
                    if (!res.lockActive || !res.lockEndTime) {
                        if (bannerTimerInterval) clearInterval(bannerTimerInterval);
                        return;
                    }

                    const timeLeft = res.lockEndTime - Date.now();
                    if (timeLeft <= 0) {
                        if (bannerTimerInterval) clearInterval(bannerTimerInterval);
                        timerBadge.textContent = '⚠️ Focus Session Completed!';
                        timerBadge.style.background = '#e74c3c'; // visual error-red warning
                        triggerVisualAlertSequence();
                        return;
                    }

                    const totalSeconds = Math.ceil(timeLeft / 1000);
                    const mins = Math.floor(totalSeconds / 60);
                    const secs = totalSeconds % 60;
                    timerBadge.textContent = `⏱️ ${mins}:${secs.toString().padStart(2, '0')}`;
                });
            };

            updateBannerTimer();
            bannerTimerInterval = setInterval(updateBannerTimer, 1000);
        }

        // Saved Jobs Focus Suggestion inside the banner
        if (jobs.length > 0) {
            const sorted = [...jobs].sort((a, b) => (a.sensory_load_score || 0) - (b.sensory_load_score || 0));
            const recJob = sorted[0];

            const recBadge = document.createElement('span');
            recBadge.style.cssText = `
                font-size: 11.5px;
                background: rgba(255, 255, 255, 0.18);
                padding: 3px 10px;
                border-radius: 12px;
                display: inline-flex;
                align-items: center;
                gap: 4px;
            `;
            
            recBadge.innerHTML = `
                💡 Focus Opportunity: <strong style="color: #ffeb3b;">${escapeHTML(recJob.title)}</strong> at ${escapeHTML(recJob.company)}
                <a href="${recJob.url || '#'}" target="_blank" style="color: #ffffff; font-weight: 700; text-decoration: underline; margin-left: 4px;">Apply 🔗</a>
            `;
            focusSpan.appendChild(recBadge);
        }

        const doneBtn = document.createElement('span');
        doneBtn.id = 'accessplus-done';
        doneBtn.textContent = 'Done ✓';
        doneBtn.style.cssText = 'cursor:pointer; background:white; color:#0a66c2; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:600; flex-shrink: 0;';

        banner.appendChild(focusSpan);
        banner.appendChild(doneBtn);

        document.body.prepend(banner);
        document.body.style.marginTop = '44px';

        hideFeed();

        doneBtn.addEventListener('click', () => {
            if (bannerTimerInterval) {
                clearInterval(bannerTimerInterval);
                bannerTimerInterval = null;
            }
            safeStorageSet({ lockActive: false, lockEndTime: null });
            removeBanner();
        });
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
    if (bannerTimerInterval) {
        clearInterval(bannerTimerInterval);
        bannerTimerInterval = null;
    }
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
    if (!isExtensionContextValid()) return;
    try {
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
    } catch (_) { /* extension context invalidated — ignore */ }
});

window.addEventListener('beforeunload', () => {
    window.speechSynthesis.cancel();
    domObserver.disconnect();
    msgObserver.disconnect();
    if (sensoryBadgeObserver) sensoryBadgeObserver.disconnect();
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
safeStorageGet(['visualAlertsEnabled', 'alertColor'], (prefs) => {
    if (typeof prefs.visualAlertsEnabled === 'boolean') {
        visualAlertsEnabled = prefs.visualAlertsEnabled;
    }
    if (prefs.alertColor) alertColor = prefs.alertColor;
});

// Keep prefs in sync if the user changes them while the tab is open
try {
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.visualAlertsEnabled) {
            visualAlertsEnabled = changes.visualAlertsEnabled.newValue;
        }
        if (changes.alertColor) {
            alertColor = changes.alertColor.newValue;
        }
    });
} catch (_) { /* extension context invalidated */ }

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
    '.msg-s-message-group--self',
    '[data-view-name*="outgoing"]',
    '[data-view-name*="self"]',
    '[class*="outgoing"]',
    '[class*="--self"]'
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
    if (!isExtensionContextValid()) return;
    try {
        if (!visualAlertsEnabled) return;
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                const msgNode = findMessageNode(node);
                if (msgNode) {
                    // Wait 150ms for LinkedIn SPA to populate text and classes (optimistic rendering delay)
                    setTimeout(() => {
                        if (msgNode.isConnected) {
                            handleNewMessageNode(msgNode);
                        }
                    }, 150);
                }
            }
        }
    } catch (_) { /* extension context invalidated — ignore */ }
});

msgObserver.observe(document.body, { childList: true, subtree: true });

// ==========================================
// FEATURE 3: QUICK SENSORY LOAD BADGES
// Adds green/yellow/red dots to LinkedIn job cards using local heuristics.
// ==========================================

const SENSORY_JARGON_TERMS = [
    'fast-paced', 'high-energy', 'dynamic environment', 'work hard play hard',
    'hit the ground running', 'wear many hats', 'rockstar', 'ninja', 'guru',
    'self-starter', 'multitask', 'context-switch', 'under pressure',
    'tight deadlines', 'always-on', 'urgent', 'hustle', 'culture fit',
    'excellent verbal communication', 'outgoing', 'travel required',
    'on-call', 'stakeholders', 'cross-functional', 'deliverables',
    'kpis', 'okr', 'synergy', 'leverage', 'ownership', 'ambiguous',
    'thrive', 'competitive environment'
];

let sensoryBadgeObserver = null;

function ensureSensoryBadgeStyles() {
    if (document.getElementById('accessin-sensory-badge-styles')) return;

    const style = document.createElement('style');
    style.id = 'accessin-sensory-badge-styles';
    style.textContent = `
        .accessin-sensory-badge {
            min-width: 74px;
            height: 34px;
            padding: 0 11px;
            border-radius: 999px;
            border: 2px solid #111827;
            box-shadow: 0 7px 18px rgba(0,0,0,0.24);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 auto;
            margin-left: 6px;
            vertical-align: middle;
            cursor: help;
            color: #111827;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 13px;
            font-weight: 900;
            line-height: 1;
            text-shadow: none;
            letter-spacing: 0.02em;
        }

        .accessin-sensory-badge-wrap {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            z-index: 999998;
        }

        .accessin-sensory-badge-wrap.accessin-sensory-overlay {
            position: fixed;
            pointer-events: auto;
        }

        .accessin-sensory-legend {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 10px 16px 6px;
            padding: 8px 10px;
            border: 1px solid #dbe7f3;
            border-radius: 8px;
            background: #f7fbff;
            color: #334155;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 12px;
            line-height: 1.3;
            box-sizing: border-box;
        }

        .accessin-sensory-legend strong {
            color: #0a66c2;
            font-size: 12px;
        }

        .accessin-sensory-legend-item {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
        }

        .accessin-sensory-legend-dot {
            width: 10px;
            height: 10px;
            border-radius: 999px;
            display: inline-block;
        }

        .accessin-sensory-badge-label {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
        }
    `;
    document.head.appendChild(style);
}

function normalizeSensoryText(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function estimateSensoryLoad(text) {
    const normalized = normalizeSensoryText(text);
    const words = normalized.match(/[a-z][a-z0-9+#.-]*/g) || [];
    const wordCount = words.length;

    const jargonHits = SENSORY_JARGON_TERMS.filter(term => normalized.includes(term));
    const jargonDensity = wordCount ? jargonHits.length / wordCount : 0;

    let score = 1;
    if (wordCount > 30) score += 1;
    if (wordCount > 60) score += 1;
    if (wordCount > 110) score += 1;
    if (jargonHits.length >= 1) score += 1;
    if (jargonHits.length >= 3) score += 1;
    if (jargonDensity > 0.035) score += 1;
    if (/over\s+\d+\s+applicants|promoted by hirer|actively reviewing/i.test(normalized)) score += 1;
    if (/internship|intern\b|contract|temporary/i.test(normalized)) score += 1;
    if (/hybrid|on-site|onsite|travel|required|applicants/i.test(normalized)) score += 1;
    if (/[;:]{2,}|\/{2,}/.test(normalized)) score += 1;

    if (score <= 3) {
        return {
            level: 'Low',
            color: '#27ae60',
            description: 'Low sensory load estimate',
            wordCount,
            jargonHits,
        };
    }

    if (score <= 5) {
        return {
            level: 'Medium',
            color: '#f1c40f',
            description: 'Medium sensory load estimate',
            wordCount,
            jargonHits,
        };
    }

    return {
        level: 'High',
        color: '#e74c3c',
        description: 'High sensory load estimate',
        wordCount,
        jargonHits,
    };
}

function findLinkedInJobRows() {
    const jobLinks = Array.from(document.querySelectorAll('a[href*="/jobs/view"]'))
        .filter(link => {
            const rect = link.getBoundingClientRect();
            return rect.width > 0 &&
                rect.height > 0 &&
                rect.left < window.innerWidth * 0.55 &&
                rect.top > 90 &&
                rect.bottom < window.innerHeight - 10 &&
                (link.innerText?.trim() || '').length > 2;
        });

    const rows = jobLinks
        .map(link => {
            const card = findBestJobCardContainer(link);
            if (!card) return null;

            const rect = card.getBoundingClientRect();
            const text = card.innerText?.trim() || link.innerText?.trim() || '';
            if (rect.width < 260 || rect.height < 50 || text.length < 10) return null;

            return {
                card,
                link,
                text,
                top: rect.top,
                right: rect.right,
                height: rect.height,
                rowKey: Math.round(rect.top / 35),
            };
        })
        .filter(Boolean)
        .filter(row => !row.card.closest('#accessin-analysis-panel'));

    const byRow = new Map();
    rows.forEach(row => {
        const existing = byRow.get(row.rowKey);
        if (!existing || row.text.length > existing.text.length) {
            byRow.set(row.rowKey, row);
        }
    });

    return Array.from(byRow.values());
}

function findBestJobCardContainer(link) {
    const candidates = [];
    let node = link;

    for (let i = 0; i < 10 && node; i++) {
        if (node instanceof HTMLElement) {
            const rect = node.getBoundingClientRect();
            const text = node.innerText?.trim() || '';
            const hasJobSignal = /easy apply|actively reviewing|viewed|saved|on-site|remote|hybrid|applicants|intern|engineer|developer|analyst|researcher|manager/i.test(text);

            if (rect.width >= 360 &&
                rect.width <= 780 &&
                rect.height >= 85 &&
                rect.height <= 230 &&
                rect.left < window.innerWidth * 0.55 &&
                text.length >= 30 &&
                hasJobSignal) {
                candidates.push(node);
            }
        }
        node = node.parentElement;
    }

    return candidates.sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (br.width * br.height) - (ar.width * ar.height);
    })[0] || link.closest('li, .scaffold-layout__list-item, .job-card-container');
}

function addSensoryBadgeToRow(row) {
    const text = row.text || '';
    if (text.length < 20) return;

    const estimate = estimateSensoryLoad(text);

    const badge = document.createElement('span');
    badge.className = 'accessin-sensory-badge';
    badge.style.backgroundColor = estimate.color;
    badge.textContent = estimate.level.charAt(0);

    const jargonText = estimate.jargonHits.length
        ? ` Jargon flags: ${estimate.jargonHits.slice(0, 4).join(', ')}.`
        : ' No major jargon flags found.';
    badge.title = `${estimate.description}. ${estimate.wordCount} words.${jargonText}`;
    badge.setAttribute('aria-label', `${estimate.level} sensory load estimate`);

    const hiddenLabel = document.createElement('span');
    hiddenLabel.className = 'accessin-sensory-badge-label';
    hiddenLabel.textContent = `${estimate.level} sensory load`;

    const wrapper = document.createElement('span');
    wrapper.className = 'accessin-sensory-badge-wrap accessin-sensory-overlay';
    wrapper.appendChild(badge);
    wrapper.appendChild(hiddenLabel);

    wrapper.title = badge.title;
    Object.assign(wrapper.style, {
        top: `${Math.max(96, row.top + 14)}px`,
        left: `${Math.max(0, row.right - 132)}px`,
    });

    document.body.appendChild(wrapper);
}

function injectSensoryLegend() {
    if (!window.location.href.includes('/jobs')) return;
    if (document.getElementById('accessin-sensory-legend')) return;

    const jobList = document.querySelector('.scaffold-layout__list, .jobs-search-results-list, [class*="jobs-search-results"]');
    const anchor = jobList || document.querySelector('main');
    if (!anchor) return;

    const legend = document.createElement('div');
    legend.id = 'accessin-sensory-legend';
    legend.className = 'accessin-sensory-legend';
    legend.innerHTML = `
        <strong>Sensory load</strong>
        <span class="accessin-sensory-legend-item"><span class="accessin-sensory-legend-dot" style="background:#27ae60"></span>Low</span>
        <span class="accessin-sensory-legend-item"><span class="accessin-sensory-legend-dot" style="background:#f1c40f"></span>Medium</span>
        <span class="accessin-sensory-legend-item"><span class="accessin-sensory-legend-dot" style="background:#e74c3c"></span>High</span>
    `;
    anchor.prepend(legend);
}

function scanJobCardsForSensoryBadges() {
    ensureSensoryBadgeStyles();
    injectSensoryLegend();
    clearSensoryBadges();
    const rows = findLinkedInJobRows();
    rows.forEach(addSensoryBadgeToRow);
}

function clearSensoryBadges() {
    document.querySelectorAll('.accessin-sensory-badge-wrap').forEach(el => el.remove());
    document.querySelectorAll('[data-accessin-sensory-badge]').forEach(el => {
        delete el.dataset.accessinSensoryBadge;
    });
}

function startSensoryBadgeObserver() {
    clearSensoryBadges();
    scanJobCardsForSensoryBadges();

    if (sensoryBadgeObserver) return;
    sensoryBadgeObserver = new MutationObserver(() => {
        window.clearTimeout(startSensoryBadgeObserver.scanTimer);
        startSensoryBadgeObserver.scanTimer = window.setTimeout(scanJobCardsForSensoryBadges, 400);
    });
    sensoryBadgeObserver.observe(document.body, { childList: true, subtree: true });
    window.setInterval(scanJobCardsForSensoryBadges, 2000);
}

window.setTimeout(() => {
    try {
        startSensoryBadgeObserver();
    } catch (error) {
        console.error('[AccessIn] Sensory badge startup failed:', error);
    }
}, 1000);

// ==========================================
// FEATURE 4: JOB ANALYZER
// ==========================================

function getActiveJobDetailsContainer() {
    return document.querySelector(
        '.jobs-search__job-details, .job-details, [class*="job-details"], .scaffold-layout__detail, main'
    ) || document;
}

function extractJobDescription() {
    const container = getActiveJobDetailsContainer();
    const stableSelectors = [
        '.jobs-description__content',
        '.jobs-description-content__text',
        '.jobs-box__html-content',
        '[class*="jobs-description"]',
        '.description__text',
    ];
    for (const sel of stableSelectors) {
        const el = container.querySelector(sel);
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

    // Fetch local storage to check if this job is already saved
    safeStorageGet(['savedJobs'], (res) => {
        const savedJobs = res.savedJobs || [];
        const existingJob = savedJobs.find(j => j.title === data.title && j.company === data.company);
        
        const isAlreadySaved = Boolean(existingJob);
        const savedNotes = existingJob ? existingJob.notes : '';

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
                    justify-content: space-between;
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
                
                /* Saved Jobs Integration */
                .ain-tracker-box {
                    margin-top: 6px;
                    padding: 10px 12px;
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }
                .ain-tracker-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }
                .ain-save-toggle-btn {
                    padding: 4px 12px;
                    font-size: 11px;
                    font-weight: 700;
                    border-radius: 12px;
                    border: none;
                    background: ${isAlreadySaved ? '#27ae60' : '#0a66c2'};
                    color: white;
                    cursor: pointer;
                    transition: background 0.15s;
                }
                .ain-save-toggle-btn:hover {
                    opacity: 0.9;
                }
                .ain-notes-label {
                    font-weight: 700;
                    font-size: 11px;
                    color: #475569;
                }
                .ain-panel-notes {
                    width: 100%;
                    height: 52px;
                    padding: 6px 8px;
                    font-size: 12px;
                    font-family: inherit;
                    border: 1px solid #cbd5e1;
                    border-radius: 6px;
                    resize: none;
                    outline: none;
                    background: white;
                    color: #1e293b;
                    box-sizing: border-box;
                    transition: border 0.15s;
                }
                .ain-panel-notes:focus {
                    border-color: #0a66c2;
                }
                .ain-save-status {
                    font-size: 10px;
                    color: #27ae60;
                    height: 12px;
                    font-weight: 700;
                    margin-top: 2px;
                }
                
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
                
                <!-- Saved Jobs Integration Tracker Panel -->
                <div class="ain-tracker-box">
                    <div class="ain-tracker-header">
                        <span class="ain-notes-label" style="font-weight: 800; color: #0a66c2;">💼 AccessIn Job Tracker</span>
                        <button class="ain-save-toggle-btn" id="ain-panel-save-btn">${isAlreadySaved ? 'Saved ✓' : 'Save Job'}</button>
                    </div>
                    
                    <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 2px;">
                        <span class="ain-notes-label">📝 Personal Accessibility Notes:</span>
                        <textarea class="ain-panel-notes" id="ain-panel-notes-input" placeholder="e.g. Contact HR for ADHD adjustments, remote policy...">${escapeHTML(savedNotes)}</textarea>
                        <span class="ain-save-status" id="ain-panel-save-status">${isAlreadySaved ? 'Saved to Tracker' : ''}</span>
                    </div>
                </div>

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

        // Core Saving Logic for the inline panel
        const saveBtn = document.getElementById('ain-panel-save-btn');
        const notesInput = document.getElementById('ain-panel-notes-input');
        const statusText = document.getElementById('ain-panel-save-status');

        function performSave(notesText) {
            safeStorageGet(['savedJobs'], (saveRes) => {
                const sJobs = saveRes.savedJobs || [];
                const existingIdx = sJobs.findIndex(j => j.title === data.title && j.company === data.company);

                const newJob = {
                    id: existingIdx >= 0 ? sJobs[existingIdx].id : 'job_' + Date.now(),
                    title: data.title || 'Unknown Job',
                    company: data.company || 'Unknown Company',
                    sensory_load_score: data.sensory_load_score || 0,
                    sensory_load_explanation: data.sensory_load_explanation || '',
                    simplified_summary: data.simplified_summary || '',
                    key_highlights: data.key_highlights || [],
                    key_skills: data.key_skills || [],
                    match_tips: data.match_tips || [],
                    url: window.location.href,
                    notes: notesText,
                    reminder: existingIdx >= 0 ? sJobs[existingIdx].reminder : false,
                    savedAt: existingIdx >= 0 ? sJobs[existingIdx].savedAt : Date.now()
                };

                if (existingIdx >= 0) {
                    sJobs[existingIdx] = newJob;
                } else {
                    sJobs.push(newJob);
                }

                safeStorageSet({ savedJobs: sJobs }, () => {
                    if (saveBtn) {
                        saveBtn.textContent = 'Saved ✓';
                        saveBtn.style.background = '#27ae60';
                    }
                    if (statusText) {
                        statusText.textContent = 'Saved to Tracker';
                        statusText.style.color = '#27ae60';
                    }
                });
            });
        }

        saveBtn?.addEventListener('click', () => {
            performSave(notesInput ? notesInput.value.trim() : '');
        });

        notesInput?.addEventListener('input', (e) => {
            // Typing auto-saves instantly!
            const text = e.target.value;
            performSave(text);
        });
    });
}

try {
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
} catch (_) { /* extension context invalidated — ignore */ }

// ==========================================
// FEATURE 4: POST SIMPLIFIER
// Adds inline simplify buttons to long LinkedIn posts.
// ==========================================

const SIMPLIFY_API_URL = 'http://localhost:8000/simplify';
const MIN_SIMPLIFY_CHARS = 120;  // ~20 words minimum
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
    // Try specific text content selectors first (most precise)
    const textSelectors = [
        '.feed-shared-update-v2__description',
        '.update-components-text',
        '.update-components-update-v2__commentary',
        '.feed-shared-text',
        '.feed-shared-text__text-view',
        '[class*="commentary"]',
        '[class*="update-components-text"]',
        '[class*="feed-shared-text"]',
    ];

    for (const selector of textSelectors) {
        const nodes = Array.from(post.querySelectorAll(selector));
        const text = nodes
            .filter(node => !node.closest(
                'button, nav, footer, [role="button"], ' +
                '.social-details-social-counts, .feed-shared-actor, ' +
                '.update-components-actor, [class*="social-action"]'
            ))
            .map(node => node.innerText?.trim())
            .filter(Boolean)
            .join('\n')
            .trim();

        if (text.length >= MIN_SIMPLIFY_CHARS) return text;
    }

    // Last resort: use all span[dir="ltr"] inside the post, excluding actor/header area
    const actorEl = post.querySelector(
        '.feed-shared-actor, .update-components-actor, [class*="actor"], [class*="author"]'
    );
    const spans = Array.from(post.querySelectorAll('span[dir="ltr"], p'))
        .filter(el => !actorEl?.contains(el))
        .filter(el => !el.closest('button, [role="button"], nav, .social-details-social-counts'));

    const spanText = spans.map(s => s.innerText?.trim()).filter(Boolean).join('\n').trim();
    if (spanText.length >= MIN_SIMPLIFY_CHARS && spanText.length <= 8000) return spanText;

    return '';
}

function findLinkedInPosts() {
    // LinkedIn's DOM changes frequently. Instead of matching container class names,
    // find elements that contain social action buttons (Like/Comment) — that's the
    // definitive signature of a real post regardless of class name changes.
    const results = new Set();

    // Find all Like or Comment buttons on the page
    const actionButtons = Array.from(document.querySelectorAll(
        'button[aria-label*="Like"], button[aria-label*="Comment"], ' +
        'button[aria-label*="React"], button[aria-label*="like"], ' +
        'button[aria-label*="comment"], [data-control-name="like"], ' +
        '[data-control-name="comment"]'
    ));

    for (const btn of actionButtons) {
        // Walk up to find the post container (max 12 levels)
        let el = btn.parentElement;
        for (let i = 0; i < 12; i++) {
            if (!el || el === document.body) break;

            // Skip comments and comment list containers to avoid clutter
            if (el.closest && (
                el.closest('.comments-comment-item') ||
                el.closest('.comments-comments-list') ||
                el.closest('.feed-shared-comments-container') ||
                el.closest('.comments-comment-box') ||
                el.closest('[class*="comments-comment"]') ||
                el.closest('[class*="comments-list"]') ||
                el.closest('[class*="comments-reply"]') ||
                el.closest('.reply-item')
            )) {
                break;
            }

            const urn = el.getAttribute('data-urn') || el.getAttribute('data-id') || '';
            const cls = (el.className || '').toString();
            const tag = el.tagName;

            if (
                urn.includes('activity') ||
                cls.includes('feed-shared-update') ||
                cls.includes('occludable-update') ||
                cls.includes('fie-impression') ||
                cls.includes('update-components-update') ||
                tag === 'ARTICLE' ||
                // Generic: large enough container that has both text and actions
                (el.offsetHeight > 150 && el.querySelectorAll('p, span[dir="ltr"]').length > 0)
            ) {
                results.add(el);
                break;
            }
            el = el.parentElement;
        }
    }

    return Array.from(results)
        .filter(el => el instanceof HTMLElement)
        .filter(post => getPostText(post));
}

function isMostlyVisible(element) {
    const rect = element.getBoundingClientRect();
    // Element is visible if any part of it is in the viewport
    return rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 100 &&           // not scrolled fully past
        rect.top < window.innerHeight; // not below the fold
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
        <div class="accessplus-simplified-body" style="margin-bottom: 8px;">${escapeHTML(data.simplified_text)}</div>
        ${keyPoints ? `<ul style="margin: 6px 0 10px 18px; padding: 0;">${keyPoints}</ul>` : ''}
        <div class="accessplus-simplified-action" style="font-weight: 700; margin-bottom: 12px;">Action: ${escapeHTML(data.action_needed || 'No action needed')}</div>
        
        <div class="accessplus-qa-section" style="margin-top: 12px; border-top: 1px dashed #cbd5e1; padding-top: 10px;">
            <div style="font-weight: 700; font-size: 12px; color: #475569; margin-bottom: 6px;">🤔 Ask a follow-up question:</div>
            <div style="display: flex; gap: 6px;">
                <input type="text" class="accessplus-qa-input" placeholder="e.g., Is remote allowed? When is the deadline?" style="flex: 1; padding: 6px 10px; font-size: 12px; border: 1px solid #cbd5e1; border-radius: 12px; outline: none; box-sizing: border-box;" />
                <button type="button" class="accessplus-qa-submit-btn" style="padding: 6px 14px; font-size: 11px; font-weight: 700; background: #0a66c2; color: white; border: none; border-radius: 12px; cursor: pointer; transition: background 0.15s;">Ask</button>
            </div>
            <div class="accessplus-qa-answer" style="margin-top: 8px; font-size: 12px; color: #1e293b; font-style: italic; line-height: 1.45;"></div>
        </div>
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
        button.textContent = 'Simplified ✓';

        // Bind event listeners for the follow-up Q&A
        const qaInput = panel.querySelector('.accessplus-qa-input');
        const qaSubmit = panel.querySelector('.accessplus-qa-submit-btn');
        const qaAnswer = panel.querySelector('.accessplus-qa-answer');

        qaSubmit?.addEventListener('click', async () => {
            const question = qaInput.value.trim();
            if (!question) return;

            qaSubmit.disabled = true;
            qaSubmit.textContent = '...';
            qaAnswer.innerHTML = '<span style="color: #6b7c8f;">Thinking...</span>';

            try {
                const qaRes = await fetch('http://localhost:8000/ask', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, question }),
                });

                if (!qaRes.ok) throw new Error('Q&A failed');
                const qaData = await qaRes.json();
                qaAnswer.innerHTML = `💡 <strong>Answer:</strong> ${escapeHTML(qaData.answer)}`;
            } catch (err) {
                qaAnswer.innerHTML = '<span style="color: #c0392b;">⚠️ Could not get an answer. Try again.</span>';
            } finally {
                qaSubmit.disabled = false;
                qaSubmit.textContent = 'Ask';
            }
        });
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
    document.querySelectorAll('.accessplus-simplify-btn, .accessplus-simplified-panel')
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
        /* Larger Text Support */
        html.accessplus-larger-text body,
        html.accessplus-larger-text p,
        html.accessplus-larger-text span,
        html.accessplus-larger-text li,
        html.accessplus-larger-text a,
        html.accessplus-larger-text button,
        html.accessplus-larger-text input,
        html.accessplus-larger-text textarea,
        html.accessplus-larger-text div,
        html.accessplus-larger-text h1,
        html.accessplus-larger-text h2,
        html.accessplus-larger-text h3,
        html.accessplus-larger-text h4,
        html.accessplus-larger-text h5,
        html.accessplus-larger-text h6 {
            font-size: 18px !important;
        }

        /* Increased Spacing Support */
        html.accessplus-spacing body,
        html.accessplus-spacing p,
        html.accessplus-spacing span,
        html.accessplus-spacing li,
        html.accessplus-spacing div,
        html.accessplus-spacing a,
        html.accessplus-spacing h1,
        html.accessplus-spacing h2,
        html.accessplus-spacing h3,
        html.accessplus-spacing h4,
        html.accessplus-spacing h5,
        html.accessplus-spacing h6 {
            line-height: 1.8 !important;
            letter-spacing: 0.04em !important;
            word-spacing: 0.12em !important;
        }

        /* Dyslexia-Friendly Font Support */
        html.accessplus-dyslexia-font body,
        html.accessplus-dyslexia-font p,
        html.accessplus-dyslexia-font span,
        html.accessplus-dyslexia-font li,
        html.accessplus-dyslexia-font a,
        html.accessplus-dyslexia-font button,
        html.accessplus-dyslexia-font input,
        html.accessplus-dyslexia-font textarea,
        html.accessplus-dyslexia-font div,
        html.accessplus-dyslexia-font h1,
        html.accessplus-dyslexia-font h2,
        html.accessplus-dyslexia-font h3,
        html.accessplus-dyslexia-font h4,
        html.accessplus-dyslexia-font h5,
        html.accessplus-dyslexia-font h6 {
            font-family: Verdana, Arial, Tahoma, sans-serif !important;
        }

        /* High Contrast Support */
        html.accessplus-high-contrast body {
            background: #ffffff !important;
            color: #111111 !important;
        }

        html.accessplus-high-contrast main,
        html.accessplus-high-contrast section,
        html.accessplus-high-contrast article,
        html.accessplus-high-contrast div[class*="feed"],
        html.accessplus-high-contrast div[class*="jobs"],
        html.accessplus-high-contrast div[class*="msg"],
        html.accessplus-high-contrast div[class*="notification"],
        html.accessplus-high-contrast div[class*="comment"],
        html.accessplus-high-contrast [class*="msg-"],
        html.accessplus-high-contrast [class*="notification-"],
        html.accessplus-high-contrast [class*="nt-card"] {
            background-color: #ffffff !important;
            background: #ffffff !important;
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

        /* Reduce Motion */
        html.accessplus-reduce-motion *,
        html.accessplus-reduce-motion *::before,
        html.accessplus-reduce-motion *::after {
            animation-duration: 0.001s !important;
            animation-iteration-count: 1 !important;
            scroll-behavior: auto !important;
            transition-duration: 0.001s !important;
        }

        /* Hide Clutter */
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
// AUTO-INJECT SAVED JOB ANALYSIS
// ==========================================
let lastUrl = location.href;
function checkSavedJobAutoInject() {
    if (!location.href.includes('/jobs/view/')) return;
    
    setTimeout(() => {
        safeStorageGet(['savedJobs'], (data) => {
            const jobs = data.savedJobs || [];
            const urlMatch = location.href.match(/view\/(\d+)/);
            if (!urlMatch) return;
            const currentJobId = urlMatch[1];
            
            const savedJob = jobs.find(j => j.url && j.url.includes(currentJobId));
            if (savedJob && !document.getElementById('accessin-analysis-panel')) {
                injectAnalysisPanel(savedJob);
            }
        });
    }, 1500);
}

// Check on initial load
window.addEventListener('load', checkSavedJobAutoInject);

// Watch for SPA URL changes
new MutationObserver(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        checkSavedJobAutoInject();
    }
}).observe(document, { subtree: true, childList: true });

// ==========================================
// INITIALIZATION
// ==========================================
safeStorageGet(['intentLock', 'lockActive'], (data) => {
    if (data.lockActive && data.intentLock) {
        injectBanner(data.intentLock);
    }
});

safeStorageGet(['readingPrefs'], (data) => {
    applyReadingPrefs(data.readingPrefs);
});

safeStorageGet(['simplifyPrefs'], (data) => {
    applySimplifyPrefs(data.simplifyPrefs);
    startSimplifierObserver();
});

injectTTSButton();
injectShortcutsButton();
startSensoryBadgeObserver();

window.setTimeout(() => {
    safeStorageGet(['simplifyPrefs'], (data) => {
        const prefs = { ...DEFAULT_SIMPLIFY_PREFS, ...(data.simplifyPrefs || {}) };
        if (prefs.enabled) {
            ensureSimplifierStyles();
            addSimplifyButtons();
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

    // ── Helper: get clean text from an element, stripping button/nav noise ───
    function cleanText(el) {
        if (!el) return '';
        // Clone so we don't mutate the page
        const clone = el.cloneNode(true);
        // Remove buttons, links that are UI actions, icons, hidden elements
        clone.querySelectorAll(
            'button, [role="button"], svg, img, .visually-hidden, ' +
            '[aria-hidden="true"], .artdeco-button, .pvs-list__footer-wrapper'
        ).forEach(n => n.remove());
        return clone.innerText?.trim() || '';
    }

    // ── Name ─────────────────────────────────────────────────────────────────
    const nameEl =
        document.querySelector('h1.text-heading-xlarge') ||
        document.querySelector('h1[class*="heading"]') ||
        document.querySelector('h1[class*="title"]') ||
        document.querySelector('main h1');
    profile.name = nameEl?.innerText?.trim() || '';

    // ── Headline ──────────────────────────────────────────────────────────────
    // Headline is the div directly after the h1 with the person's tagline
    const headlineEl =
        document.querySelector('.text-body-medium.break-words') ||
        document.querySelector('[data-generated-suggestion-target]') ||
        document.querySelector('.pv-top-card-section__headline');

    if (headlineEl) {
        profile.headline = headlineEl.innerText?.trim() || '';
    } else if (nameEl) {
        // Walk siblings after h1 — first short text that isn't location/connections
        let sib = nameEl.nextElementSibling;
        while (sib) {
            const t = sib.innerText?.trim() || '';
            // Skip location lines, connection counts, pronouns
            if (t.length > 10 && t.length < 300 && !/^\d+/.test(t) &&
                !t.includes('connection') && !t.includes('follower')) {
                profile.headline = t;
                break;
            }
            sib = sib.nextElementSibling;
        }
    }

    // ── About ─────────────────────────────────────────────────────────────────
    // Use the #about anchor — it's a reliable landmark LinkedIn always includes
    const aboutAnchor = document.getElementById('about');
    if (aboutAnchor) {
        const section = aboutAnchor.closest('section') || aboutAnchor.parentElement;
        if (section) {
            const text = cleanText(section).replace(/^About\s*/i, '').trim();
            // Must be real content — not just the heading
            if (text.length > 20) profile.about = text.slice(0, 2000);
        }
    }

    // Fallback: section with data-view-name containing "about"
    if (!profile.about) {
        const el = document.querySelector('[data-view-name*="profile-card-about"]');
        if (el) {
            const text = cleanText(el).replace(/^About\s*/i, '').trim();
            if (text.length > 20) profile.about = text.slice(0, 2000);
        }
    }

    // ── Experience ────────────────────────────────────────────────────────────
    const expAnchor = document.getElementById('experience');
    if (expAnchor) {
        const section = expAnchor.closest('section') || expAnchor.parentElement;
        if (section) {
            const text = cleanText(section).replace(/^Experience\s*/i, '').trim();
            if (text.length > 20) profile.experience = text.slice(0, 2000);
        }
    }

    if (!profile.experience) {
        const el = document.querySelector('[data-view-name*="profile-card-experience"]');
        if (el) {
            const text = cleanText(el).replace(/^Experience\s*/i, '').trim();
            if (text.length > 20) profile.experience = text.slice(0, 2000);
        }
    }

    // ── NOTE: No "last resort" full-page grab ─────────────────────────────────
    // Grabbing <main> pulls in LinkedIn UI buttons, suggestions, ads etc.
    // which pollutes the scoring. If we have at least a headline, that's enough.

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
// Keyboard-first design for blind / low-vision users.
//
// Navigation:
//   Ctrl+Left / Ctrl+Right   — cycle through images on the page
//   Ctrl+Up  / Ctrl+Down     — scroll the page up / down
//   Tab (when enabled)       — Tab also cycles images when one is focused
//   Ctrl+D                   — describe the focused image (or best visible)
//   Ctrl+S                   — stop description (cancel speech + close panel)
//
// Delivery:
//   - Spoken aloud via Web Speech API
//   - Shown as a floating text panel
//   - Blue ring stays on image while it is being described
// ==========================================

const DESCRIBE_API_URL = 'http://localhost:8000/describe';
let imageDescriberEnabled = false;

// ── Image navigation state ────────────────────────────────────────────────────
let descImages = [];
let currentImageIndex = -1;
let descImagesStale = true;

const descDomObserver = new MutationObserver(() => { descImagesStale = true; });

function refreshDescImages() {
    if (!descImagesStale) return;
    descImages.forEach(img => clearImageFocusRing(img));
    descImages = Array.from(document.querySelectorAll('img')).filter(img => {
        if (!img.src || img.src.startsWith('data:')) return false;
        if (img.naturalWidth > 0 && img.naturalWidth < 100) return false;
        const rect = img.getBoundingClientRect();
        return rect.width > 100 && rect.bottom > 0 && rect.top < document.documentElement.scrollHeight;
    });
    if (currentImageIndex >= descImages.length) currentImageIndex = descImages.length - 1;
    descImagesStale = false;
}

// ── Focus ring — blue outline, same colour as Read Aloud ─────────────────────
function applyImageFocusRing(img) {
    if (!img) return;
    img.style.outline = '4px solid #0a66c2';
    img.style.outlineOffset = '3px';
    img.style.borderRadius = '4px';
    img.setAttribute('aria-current', 'true');
}

function clearImageFocusRing(img) {
    if (!img) return;
    img.style.outline = '';
    img.style.outlineOffset = '';
    img.style.borderRadius = '';
    img.removeAttribute('aria-current');
}

// ── Navigate to image by index ────────────────────────────────────────────────
function focusImageAt(index) {
    refreshDescImages();
    if (descImages.length === 0) { announceDescriber('No images found on this page.'); return; }

    index = ((index % descImages.length) + descImages.length) % descImages.length;

    if (currentImageIndex >= 0 && descImages[currentImageIndex]) {
        clearImageFocusRing(descImages[currentImageIndex]);
    }

    currentImageIndex = index;
    const img = descImages[currentImageIndex];
    applyImageFocusRing(img);
    img.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Announce position — nav hint speech does NOT change button state
    const position = `Image ${currentImageIndex + 1} of ${descImages.length}.`;
    const hint = img.alt ? ` Alt text: ${img.alt}.` : ' No alt text. Press Ctrl+D to describe.';
    announceDescriber(position + hint, true);

    // Button shows Ctrl+D next step
    updateDescribeButtonUI(`🖼️ Image ${currentImageIndex + 1} of ${descImages.length}\n(Ctrl+D to describe)`);
}

function navigateImages(direction) {
    refreshDescImages();
    if (descImages.length === 0) { announceDescriber('No images found on this page.'); return; }
    const next = direction === 'next'
        ? (currentImageIndex + 1)
        : (currentImageIndex <= 0 ? descImages.length - 1 : currentImageIndex - 1);
    focusImageAt(next);
}

// ── ARIA live region ──────────────────────────────────────────────────────────
function ensureLiveRegion() {
    let region = document.getElementById('accessin-live-region');
    if (!region) {
        region = document.createElement('div');
        region.id = 'accessin-live-region';
        region.setAttribute('aria-live', 'assertive');
        region.setAttribute('aria-atomic', 'true');
        Object.assign(region.style, {
            position: 'absolute', width: '1px', height: '1px',
            overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap',
        });
        document.body.appendChild(region);
    }
    return region;
}

// Nav-hint announcer — does NOT touch button state
function announceDescriber(text, speak = false) {
    const region = ensureLiveRegion();
    region.textContent = '';
    requestAnimationFrame(() => { region.textContent = text; });
    if (speak) {
        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(text);
        utt.rate = currentSpeed;
        window.speechSynthesis.speak(utt);
    }
}

// Description speaker — manages button states:
//   onstart  → "Reading aloud… (Ctrl+S to stop)"
//   onend    → restore nav hint or idle
function speakDescription(text, img) {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = currentSpeed;
    utt.onstart = () => {
        updateDescribeButtonUI('🖼️ Reading aloud…\n(Ctrl+S to stop)');
        if (img) applyImageFocusRing(img);  // keep ring while reading
    };
    utt.onend = () => {
        if (currentImageIndex >= 0 && descImages[currentImageIndex]) {
            updateDescribeButtonUI(`🖼️ Image ${currentImageIndex + 1} of ${descImages.length}\n(Ctrl+D to describe)`);
        } else {
            updateDescribeButtonUI();
        }
    };
    utt.onerror = () => { updateDescribeButtonUI(); };
    window.speechSynthesis.speak(utt);
}

// ── fetch image as base64 ─────────────────────────────────────────────────────
async function fetchImageAsBase64(imgUrl) {
    try {
        const res = await fetch(imgUrl);
        const blob = await res.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve({ base64: reader.result.split(',')[1], mimeType: blob.type || 'image/jpeg' });
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) { return null; }
}

// ── Best visible image fallback ───────────────────────────────────────────────
function findBestVisibleImage() {
    refreshDescImages();
    if (descImages.length === 0) return null;
    if (currentImageIndex >= 0 && descImages[currentImageIndex]) return descImages[currentImageIndex];
    const centerY = window.innerHeight / 2;
    return descImages.slice().sort((a, b) => {
        const aMid = (a.getBoundingClientRect().top + a.getBoundingClientRect().bottom) / 2;
        const bMid = (b.getBoundingClientRect().top + b.getBoundingClientRect().bottom) / 2;
        return Math.abs(aMid - centerY) - Math.abs(bMid - centerY);
    })[0];
}

// ── Describe an image ─────────────────────────────────────────────────────────
async function describeImage(img) {
    const btn = document.getElementById('accessin-describe-btn');

    if (!img) {
        announceDescriber('No image found. Use Ctrl+Left or Ctrl+Right to navigate first.', true);
        updateDescribeButtonUI('❌ No image found');
        setTimeout(() => updateDescribeButtonUI(), 2000);
        return;
    }

    announceDescriber('Fetching description, please wait.', true);
    updateDescribeButtonUI('⏳ Describing...');
    if (btn) btn.disabled = true;

    const context = img.alt || img.getAttribute('aria-label') || '';
    const imgData = await fetchImageAsBase64(img.src);

    if (!imgData) {
        if (btn) btn.disabled = false;
        updateDescribeButtonUI('❌ Load failed — Retry');
        announceDescriber('Could not load image data.', true);
        return;
    }

    // Apply blue ring to image being described
    applyImageFocusRing(img);

    try {
        const res = await fetch(DESCRIBE_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_b64: imgData.base64, mime_type: imgData.mimeType, context })
        });

        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const data = await res.json();
        const description = data.description || 'No description available.';

        showDescriptionPanel(description);

        // speakDescription handles button: onstart="Ctrl+S to stop", onend=restore nav hint
        speakDescription(description, img);
        if (btn) btn.disabled = false;

    } catch (err) {
        console.error('[AccessIn] describe error:', err);
        if (btn) btn.disabled = false;           // re-enable so user can retry
        updateDescribeButtonUI('❌ Failed — Retry');
        announceDescriber('Description failed. Please try again.', true);
    }
}

// ── Floating description panel ────────────────────────────────────────────────
function showDescriptionPanel(description) {
    let panel = document.getElementById('accessin-desc-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'accessin-desc-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Image description');
        panel.setAttribute('tabindex', '-1');
        Object.assign(panel.style, {
            position: 'fixed', bottom: '170px', right: '20px',
            zIndex: '999998', width: '300px',
            padding: '12px 16px', background: '#f0f7ff',
            borderLeft: '4px solid #0a66c2', borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            fontFamily: '-apple-system, sans-serif', fontSize: '13px',
            lineHeight: '1.6', color: '#1a1a1a',
        });
        document.body.appendChild(panel);
    }

    const header = document.createElement('div');
    header.style.cssText = 'font-weight:700;color:#0a66c2;font-size:11px;text-transform:uppercase;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;';

    const title = document.createElement('span');
    title.textContent = '🖼️ Image Description';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Close description panel');
    closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;color:#666;padding:0;';
    closeBtn.addEventListener('click', () => panel.remove());

    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement('p');
    body.style.margin = '0';
    body.textContent = description;

    panel.innerHTML = '';
    panel.appendChild(header);
    panel.appendChild(body);
    panel.focus();
}

// ── Button UI ─────────────────────────────────────────────────────────────────
function updateDescribeButtonUI(label) {
    const btn = document.getElementById('accessin-describe-btn');
    if (!btn) return;
    btn.innerText = label || '🖼️ Describe Image\n(Ctrl+Arrows)';
}

// ── Inject floating button ────────────────────────────────────────────────────
function injectImageDescriberButton() {
    if (document.getElementById('accessin-describe-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'accessin-describe-btn';
    btn.setAttribute('aria-label', 'Describe focused image (Ctrl+D)');
    btn.innerText = '🖼️ Describe Image\n(Ctrl+Arrows)';
    Object.assign(btn.style, {
        position: 'fixed', bottom: '90px', right: '20px', zIndex: '999999',
        padding: '10px 16px', backgroundColor: '#0a66c2', color: 'white',
        border: 'none', borderRadius: '8px', cursor: 'pointer',
        boxShadow: '0 4px 6px rgba(0,0,0,0.2)', fontFamily: '-apple-system, sans-serif',
        fontWeight: 'bold', fontSize: '13px', textAlign: 'center', lineHeight: '1.4',
    });

    btn.addEventListener('click', async () => {
        const img = findBestVisibleImage();
        await describeImage(img);
    });

    document.body.appendChild(btn);
    descDomObserver.observe(document.body, { childList: true, subtree: true });
    refreshDescImages();
    announceDescriber(
        `Image describer enabled. ${descImages.length} image${descImages.length !== 1 ? 's' : ''} found. ` +
        'Use Ctrl+Left and Ctrl+Right to navigate. Ctrl+D to describe. Ctrl+S to stop.',
        true
    );
}

function removeImageDescriberButton() {
    descImages.forEach(img => clearImageFocusRing(img));
    currentImageIndex = -1;
    descImages = [];
    descImagesStale = true;
    document.getElementById('accessin-describe-btn')?.remove();
    document.getElementById('accessin-desc-panel')?.remove();
    document.getElementById('accessin-live-region')?.remove();
    descDomObserver.disconnect();
}

function applyImageDescriberPref(enabled) {
    imageDescriberEnabled = enabled;
    if (enabled) injectImageDescriberButton();
    else removeImageDescriberButton();
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
// All use Ctrl so they don't conflict with:
//   - Alt+Arrows / Alt+S  (Read Aloud)
//   - Shift+Arrows        (browser text selection — can't override)
//
// Ctrl+Left / Ctrl+Right  → cycle images (prev / next)
// Ctrl+Up   / Ctrl+Down   → scroll page (targets LinkedIn feed container)
// Ctrl+D                  → describe focused image
// Ctrl+S                  → stop speech + close panel
document.addEventListener('keydown', (e) => {
    if (!isExtensionContextValid()) return;
    try {
        if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
        if (!imageDescriberEnabled) return;

        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;

        if (e.code === 'ArrowUp') {
            e.preventDefault();
            const feedEl = document.querySelector('.scaffold-finite-scroll__content')
                || document.querySelector('main') || document.documentElement;
            feedEl.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' });
            window.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' });
        }

        if (e.code === 'ArrowDown') {
            e.preventDefault();
            const feedEl = document.querySelector('.scaffold-finite-scroll__content')
                || document.querySelector('main') || document.documentElement;
            feedEl.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
            window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
        }

        if (e.code === 'ArrowLeft') {
            e.preventDefault();
            navigateImages('prev');
        }

        if (e.code === 'ArrowRight') {
            e.preventDefault();
            navigateImages('next');
        }

        if (e.code === 'KeyD') {
            e.preventDefault();
            const img = currentImageIndex >= 0 && descImages[currentImageIndex]
                ? descImages[currentImageIndex]
                : findBestVisibleImage();
            describeImage(img);
        }

        if (e.code === 'KeyS') {
            e.preventDefault();
            window.speechSynthesis.cancel();
            document.getElementById('accessin-desc-panel')?.remove();
            if (currentImageIndex >= 0 && descImages[currentImageIndex]) {
                updateDescribeButtonUI(`🖼️ Image ${currentImageIndex + 1} of ${descImages.length}\n(Ctrl+D to describe)`);
            } else {
                updateDescribeButtonUI();
            }
            const _b = document.getElementById('accessin-describe-btn');
            if (_b) _b.disabled = false;
            announceDescriber('Description stopped.');
        }
    } catch (_) { /* extension context invalidated — ignore */ }
});

// Tab key: cycle images when one is already focused
document.addEventListener('keydown', (e) => {
    if (!isExtensionContextValid()) return;
    try {
        if (!imageDescriberEnabled || e.key !== 'Tab') return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;

        refreshDescImages();
        if (descImages.length === 0) return;

        const isOnImage = document.activeElement?.tagName === 'IMG';
        if (!isOnImage && currentImageIndex === -1) return;

        e.preventDefault();
        navigateImages(e.shiftKey ? 'prev' : 'next');
    } catch (_) { /* extension context invalidated — ignore */ }
});

// Listen for toggle from popup
try {
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'APPLY_IMAGE_DESCRIBER_PREF') {
            applyImageDescriberPref(msg.enabled);
        }
    });
} catch (_) { /* extension context invalidated — ignore */ }

safeStorageGet(['imageDescriberEnabled'], (data) => {
    applyImageDescriberPref(Boolean(data.imageDescriberEnabled));
});

setInterval(() => {
    safeStorageGet(['imageDescriberEnabled'], (data) => {
        const shouldBeEnabled = Boolean(data.imageDescriberEnabled);
        const btnExists = Boolean(document.getElementById('accessin-describe-btn'));
        if (shouldBeEnabled && !btnExists) injectImageDescriberButton();
        else if (!shouldBeEnabled && btnExists) removeImageDescriberButton();
    });
}, 2000);

// ── Inline Button Injection on LinkedIn Job Detail Pane ──────────────────────────

function startInlineButtonScan() {
    window.setInterval(() => {
        const container = getActiveJobDetailsContainer();
        if (!container) return;

        // Try standard action headers and buttons inside the active details container
        const actionsEl = container.querySelector(
            '.jobs-apply-button--top-card, ' +
            '.jobs-apply-button, ' +
            '.jobs-save-button, ' +
            '[class*="top-card-layout__actions"], ' +
            '[class*="jobs-unified-top-card__content-container"] [class*="actions"], ' +
            '.jobs-actions'
        );

        if (actionsEl) {
            const parent = actionsEl.parentElement;
            if (parent && !parent.querySelector('#accessin-inline-analyze-btn')) {
                // Clear any outdated inline buttons on the page to prevent duplicate triggers
                document.getElementById('accessin-inline-analyze-btn')?.remove();
                const btn = document.createElement('button');
                btn.id = 'accessin-inline-analyze-btn';
                btn.type = 'button';
                btn.innerHTML = '🧠 Analyze Accessibility';

                btn.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    margin-left: 8px;
                    padding: 8px 16px;
                    border: 1.5px solid #0a66c2;
                    border-radius: 20px;
                    background: #ffffff;
                    color: #0a66c2;
                    cursor: pointer;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    font-size: 13px;
                    font-weight: 700;
                    transition: all 0.2s ease;
                    vertical-align: middle;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
                `;

                btn.addEventListener('mouseenter', () => {
                    btn.style.background = '#eef6ff';
                    btn.style.borderColor = '#004182';
                    btn.style.color = '#004182';
                });
                btn.addEventListener('mouseleave', () => {
                    btn.style.background = '#ffffff';
                    btn.style.borderColor = '#0a66c2';
                    btn.style.color = '#0a66c2';
                });

                btn.addEventListener('click', async () => {
                    btn.disabled = true;
                    btn.textContent = '🧠 Analyzing Job...';
                    
                    const jd = extractJobDescription();
                    if (!jd) {
                        alert("AccessIn Error: Could not read job description. Open a specific job page first.");
                        btn.disabled = false;
                        btn.innerHTML = '🧠 Analyze Accessibility';
                        return;
                    }

                    try {
                        const response = await fetch('http://localhost:8000/analyze', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ job_description: jd }),
                        });

                        if (!response.ok) {
                            throw new Error(`Server returned status ${response.status}`);
                        }

                        const data = await response.json();
                        injectAnalysisPanel(data);
                    } catch (err) {
                        alert("AccessIn Error: Backend analysis failed. Ensure your server is running at http://localhost:8000. Detail: " + err.message);
                    } finally {
                        btn.disabled = false;
                        btn.innerHTML = '🧠 Analyze Accessibility';
                    }
                });

                actionsEl.insertAdjacentElement('afterend', btn);
            }
        }
    }, 1000);
}

// ── Page Load Accessibility Reminders Toast ────────────────────────────────────

function checkAndShowReminders() {
    safeStorageGet(['savedJobs'], (data) => {
        const jobs = data.savedJobs || [];
        const reminderJobs = jobs.filter(j => j.reminder);

        if (reminderJobs.length === 0) return;

        // Prioritize: show the lowest sensory load score reminder job
        reminderJobs.sort((a, b) => (a.sensory_load_score || 0) - (b.sensory_load_score || 0));
        const remJob = reminderJobs[0];

        // Ensure slide-in keyframe animation style
        if (!document.getElementById('accessplus-toast-styles')) {
            const style = document.createElement('style');
            style.id = 'accessplus-toast-styles';
            style.textContent = `
                @keyframes accessin-toast-slide {
                    0%   { opacity: 0; transform: translateY(40px) scale(0.95); }
                    100% { opacity: 1; transform: translateY(0) scale(1); }
                }
                #accessplus-reminder-toast {
                    position: fixed;
                    bottom: 24px;
                    left: 24px;
                    width: 320px;
                    background: #ffffff;
                    border-left: 5px solid #0a66c2;
                    border-radius: 10px;
                    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.16);
                    padding: 14px 16px;
                    z-index: 2147483647;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    font-size: 13px;
                    color: #1e293b;
                    box-sizing: border-box;
                    animation: accessin-toast-slide 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                }
            `;
            document.head.appendChild(style);
        }

        const toast = document.createElement('div');
        toast.id = 'accessplus-reminder-toast';
        toast.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                <div style="flex: 1;">
                    <div style="display: flex; align-items: center; gap: 6px; font-weight: 800; color: #0a66c2; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.03em;">
                        <span>🔔 AccessIn Reminder</span>
                    </div>
                    <div style="font-weight: 800; font-size: 13px; color: #0f172a; margin-top: 5px; line-height: 1.35;">${escapeHTML(remJob.title)}</div>
                    <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-top: 2px;">${escapeHTML(remJob.company)}</div>
                    
                    ${remJob.notes ? `
                        <div style="margin-top: 8px; font-size: 11px; color: #1e3a8a; background: #eff6ff; padding: 6px 10px; border-radius: 6px; border-left: 2px solid #3b82f6; line-height: 1.45;">
                            📝 <em>"${escapeHTML(remJob.notes)}"</em>
                        </div>
                    ` : ''}
                </div>
                <button id="accessin-toast-close" style="background:none; border:none; font-size: 16px; cursor:pointer; color:#94a3b8; line-height:1; padding:0 2px;">✕</button>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 1px dashed #e2e8f0;">
                <span style="font-weight: 800; color: white; background: #27ae60; font-size: 9.5px; padding: 2.5px 8px; border-radius: 12px;">Sensory Score: ${remJob.sensory_load_score || 0}/10</span>
                <a href="${remJob.url || '#'}" target="_blank" style="font-weight: 800; color: #0a66c2; font-size: 11px; text-decoration: underline;">Apply Today 🔗</a>
            </div>
        `;

        document.body.appendChild(toast);

        // Bind dismiss handlers
        toast.querySelector('#accessin-toast-close').addEventListener('click', () => {
            toast.remove();
        });
    });
}

// Start scanner and checker on initial script execution
startInlineButtonScan();

// Show reminder toast shortly after page load
setTimeout(checkAndShowReminders, 2500);

// ==========================================
// FEATURE: KEYBOARD SHORTCUTS PANEL
// ==========================================

function ensureShortcutsStyles() {
    if (document.getElementById('accessplus-shortcuts-styles')) return;

    const style = document.createElement('style');
    style.id = 'accessplus-shortcuts-styles';
    style.textContent = `
        /* Floating shortcuts button */
        #accessplus-shortcuts-btn {
            position: fixed;
            bottom: 20px;
            right: 175px;
            z-index: 999999;
            width: 44px;
            height: 44px;
            border-radius: 50%;
            background-color: #ffffff;
            border: 2px solid #0a66c2;
            color: #0a66c2;
            cursor: pointer;
            box-shadow: 0 4px 10px rgba(0,0,0,0.15);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-weight: bold;
            font-size: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            outline: none;
            box-sizing: border-box;
            padding: 0;
        }

        #accessplus-shortcuts-btn:hover {
            background-color: #0a66c2;
            color: #ffffff;
            transform: translateY(-2px) scale(1.05);
            box-shadow: 0 6px 14px rgba(0,0,0,0.2);
        }

        #accessplus-shortcuts-btn:active {
            transform: translateY(0) scale(0.95);
        }

        #accessplus-shortcuts-btn:focus {
            outline: 3px solid #004182;
            outline-offset: 2px;
        }

        /* Shortcuts dialog wrapper */
        #accessplus-shortcuts-dialog {
            border: none;
            border-radius: 16px;
            padding: 0;
            max-width: 520px;
            width: 90%;
            background: rgba(255, 255, 255, 0.98);
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.1);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #1e293b;
            overflow: hidden;
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 2147483647;
            
            /* Entry/exit discrete animation properties */
            opacity: 0;
            transform: translate(-50%, -45%) scale(0.95);
            transition-property: opacity, transform, display, overlay;
            transition-duration: 0.25s;
            transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
            transition-behavior: allow-discrete;
        }

        #accessplus-shortcuts-dialog[open] {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
        }
        
        #accessplus-shortcuts-dialog[open] {
            @starting-style {
                opacity: 0;
                transform: translate(-50%, -45%) scale(0.95);
            }
        }

        /* Glassmorphic backdrop filter */
        #accessplus-shortcuts-dialog::backdrop {
            background-color: rgba(15, 23, 42, 0);
            backdrop-filter: blur(0px);
            -webkit-backdrop-filter: blur(0px);
            transition:
                display 0.25s allow-discrete,
                overlay 0.25s allow-discrete,
                background-color 0.25s ease-out,
                backdrop-filter 0.25s ease-out,
                -webkit-backdrop-filter 0.25s ease-out;
        }

        #accessplus-shortcuts-dialog[open]::backdrop {
            background-color: rgba(15, 23, 42, 0.45);
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
        }
        
        #accessplus-shortcuts-dialog[open]::backdrop {
            @starting-style {
                background-color: rgba(15, 23, 42, 0);
                backdrop-filter: blur(0px);
                -webkit-backdrop-filter: blur(0px);
            }
        }

        .accessplus-shortcuts-container {
            display: flex;
            flex-direction: column;
            max-height: 85vh;
            box-sizing: border-box;
        }

        .accessplus-shortcuts-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 18px 24px;
            background: #0a66c2;
            color: white;
            box-sizing: border-box;
        }

        .accessplus-shortcuts-header h2 {
            margin: 0;
            font-size: 18px;
            font-weight: 700;
            letter-spacing: -0.01em;
            color: white;
        }

        .accessplus-shortcuts-close {
            background: rgba(255, 255, 255, 0.15);
            border: none;
            color: white;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            box-sizing: border-box;
            padding: 0;
        }

        .accessplus-shortcuts-close:hover {
            background: rgba(255, 255, 255, 0.3);
            transform: scale(1.05);
        }

        .accessplus-shortcuts-close:focus {
            outline: 2px solid white;
            outline-offset: 2px;
        }

        .accessplus-shortcuts-content {
            padding: 20px 24px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 20px;
            max-height: calc(85vh - 120px);
            box-sizing: border-box;
        }

        .accessplus-shortcuts-group {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 14px 18px;
            box-sizing: border-box;
        }

        .accessplus-shortcuts-group h3 {
            margin-top: 0;
            margin-bottom: 12px;
            font-size: 13.5px;
            font-weight: 800;
            color: #0a66c2;
            text-transform: uppercase;
            letter-spacing: 0.04em;
        }

        .accessplus-shortcuts-group dl {
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: 8px;
            box-sizing: border-box;
        }

        .shortcut-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px dashed #e2e8f0;
            padding-bottom: 8px;
            box-sizing: border-box;
        }

        .shortcut-row:last-child {
            border-bottom: none;
            padding-bottom: 0;
        }

        .shortcut-row dt {
            font-weight: 500;
            box-sizing: border-box;
        }

        .shortcut-row dd {
            margin: 0;
            font-size: 12px;
            color: #475569;
            text-align: right;
            max-width: 60%;
            box-sizing: border-box;
        }

        /* Styled keycaps */
        kbd {
            background-color: #ffffff;
            border: 1.5px solid #cbd5e1;
            border-bottom: 3px solid #94a3b8;
            border-radius: 5px;
            color: #0f172a;
            display: inline-block;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 11px;
            font-weight: 700;
            line-height: 1;
            padding: 3px 6px;
            white-space: nowrap;
            box-shadow: 0 1px 2px rgba(0,0,0,0.05);
            box-sizing: border-box;
        }

        .accessplus-shortcuts-footer {
            padding: 12px 24px;
            background: #f1f5f9;
            border-top: 1px solid #e2e8f0;
            text-align: center;
            box-sizing: border-box;
        }

        .accessplus-shortcuts-footer p {
            margin: 0;
            font-size: 11px;
            color: #64748b;
            font-weight: 500;
        }

        /* Reduced motion preference */
        @media (prefers-reduced-motion: reduce) {
            #accessplus-shortcuts-dialog {
                transform: translate(-50%, -50%) !important;
                transition-duration: 0.1s !important;
            }
            #accessplus-shortcuts-dialog[open] {
                @starting-style {
                    transform: translate(-50%, -50%) !important;
                }
            }
            #accessplus-shortcuts-dialog::backdrop,
            #accessplus-shortcuts-dialog[open]::backdrop {
                transition-duration: 0.1s !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }
        }
    `;
    document.head.appendChild(style);
}

function injectShortcutsButton() {
    if (document.getElementById('accessplus-shortcuts-btn')) return;

    ensureShortcutsStyles();

    // 1. Create floating button
    const shortcutsBtn = document.createElement('button');
    shortcutsBtn.id = 'accessplus-shortcuts-btn';
    shortcutsBtn.textContent = '?';
    shortcutsBtn.setAttribute('aria-label', 'Show keyboard shortcuts');
    shortcutsBtn.setAttribute('title', 'Show keyboard shortcuts (Alt+?) or (?)');
    
    // Ensure standard tab navigation
    shortcutsBtn.tabIndex = 0;

    // 2. Create dialog element
    const dialog = document.createElement('dialog');
    dialog.id = 'accessplus-shortcuts-dialog';
    dialog.setAttribute('aria-labelledby', 'accessplus-shortcuts-title');
    dialog.setAttribute('role', 'dialog');

    dialog.innerHTML = `
        <div class="accessplus-shortcuts-container">
            <header class="accessplus-shortcuts-header">
                <h2 id="accessplus-shortcuts-title">⌨️ Keyboard Shortcuts</h2>
                <button class="accessplus-shortcuts-close" aria-label="Close keyboard shortcuts dialog">✕</button>
            </header>
            <div class="accessplus-shortcuts-content">
                <section class="accessplus-shortcuts-group">
                    <h3>🔊 Read Aloud (Alt Key)</h3>
                    <dl>
                        <div class="shortcut-row">
                            <dt><kbd>Alt</kbd> + <kbd>↑ / ↓</kbd></dt>
                            <dd>Navigate to previous / next text item</dd>
                        </div>
                        <div class="shortcut-row">
                            <dt><kbd>Alt</kbd> + <kbd>← / →</kbd></dt>
                            <dd>Navigate text items horizontally</dd>
                        </div>
                        <div class="shortcut-row">
                            <dt><kbd>Alt</kbd> + <kbd>S</kbd></dt>
                            <dd>Stop reading aloud</dd>
                        </div>
                        <div class="shortcut-row">
                            <dt><kbd>Alt</kbd> + <kbd>+</kbd> / <kbd>-</kbd></dt>
                            <dd>Increase / decrease speech speed</dd>
                        </div>
                    </dl>
                </section>
                
                <section class="accessplus-shortcuts-group">
                    <h3>🖼️ Image Describer (Ctrl Key)</h3>
                    <dl>
                        <div class="shortcut-row">
                            <dt><kbd>Ctrl</kbd> + <kbd>D</kbd></dt>
                            <dd>Describe focused / visible image</dd>
                        </div>
                        <div class="shortcut-row">
                            <dt><kbd>Ctrl</kbd> + <kbd>S</kbd></dt>
                            <dd>Stop speech & close description panel</dd>
                        </div>
                        <div class="shortcut-row">
                            <dt><kbd>Tab</kbd> / <kbd>Shift</kbd> + <kbd>Tab</kbd></dt>
                            <dd>Move focus between images on the page</dd>
                        </div>
                        <div class="shortcut-row">
                            <dt><kbd>Ctrl</kbd> + <kbd>← / →</kbd></dt>
                            <dd>Cycle focus between images manually</dd>
                        </div>
                        <div class="shortcut-row">
                            <dt><kbd>Ctrl</kbd> + <kbd>↑ / ↓</kbd></dt>
                            <dd>Scroll feed container up / down</dd>
                        </div>
                    </dl>
                </section>
                
                <section class="accessplus-shortcuts-group">
                    <h3>ℹ️ General Shortcuts</h3>
                    <dl>
                        <div class="shortcut-row">
                            <dt><kbd>?</kbd> or <kbd>Alt</kbd> + <kbd>?</kbd></dt>
                            <dd>Toggle this keyboard shortcuts panel</dd>
                        </div>
                    </dl>
                </section>
            </div>
            <footer class="accessplus-shortcuts-footer">
                <p>Designed for blind and deaf accessibility. Press <kbd>Esc</kbd> to close.</p>
            </footer>
        </div>
    `;

    document.body.appendChild(shortcutsBtn);
    document.body.appendChild(dialog);

    // Bind event handlers
    const openDialog = () => {
        dialog.showModal();
        const closeBtn = dialog.querySelector('.accessplus-shortcuts-close');
        if (closeBtn) closeBtn.focus();
    };

    const closeDialog = () => {
        dialog.close();
        shortcutsBtn.focus();
    };

    shortcutsBtn.addEventListener('click', openDialog);

    dialog.querySelector('.accessplus-shortcuts-close').addEventListener('click', closeDialog);

    // Close on clicking backdrop
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) {
            closeDialog();
        }
    });

    // Close clean-up handler to restore focus properly on native cancel (Esc key)
    dialog.addEventListener('cancel', (e) => {
        setTimeout(() => {
            shortcutsBtn.focus();
        }, 50);
    });
}

// Global key listener to toggle the shortcuts panel with Alt+? or ?
document.addEventListener('keydown', (e) => {
    if (!isExtensionContextValid()) return;
    try {
        const isShortcutKey = (e.key === '?') || (e.altKey && e.key === '?');
        if (!isShortcutKey) return;

        // Check if the user is currently typing in an input element
        const activeEl = document.activeElement;
        if (activeEl && (
            activeEl.tagName === 'INPUT' || 
            activeEl.tagName === 'TEXTAREA' || 
            activeEl.isContentEditable ||
            activeEl.getAttribute('role') === 'textbox'
        )) {
            return;
        }

        e.preventDefault();

        const dialog = document.getElementById('accessplus-shortcuts-dialog');
        const shortcutsBtn = document.getElementById('accessplus-shortcuts-btn');
        if (dialog && shortcutsBtn) {
            if (dialog.open) {
                dialog.close();
                shortcutsBtn.focus();
            } else {
                dialog.showModal();
                const closeBtn = dialog.querySelector('.accessplus-shortcuts-close');
                if (closeBtn) closeBtn.focus();
            }
        }
    } catch (_) { /* extension context invalidated — ignore */ }
});