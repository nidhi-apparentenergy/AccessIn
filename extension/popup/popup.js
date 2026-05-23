const API_BASE = 'http://localhost:8000';

const DEFAULT_READING_PREFS = {
    largerText: false,
    increasedSpacing: false,
    dyslexiaFont: false,
    highContrast: false,
    reduceMotion: false,
    hideClutter: false,
};

const READING_TOGGLES = {
    largerTextToggle: 'largerText',
    spacingToggle: 'increasedSpacing',
    dyslexiaFontToggle: 'dyslexiaFont',
    highContrastToggle: 'highContrast',
    reduceMotionToggle: 'reduceMotion',
    hideClutterToggle: 'hideClutter',
};

const DEFAULT_SIMPLIFY_PREFS = {
    enabled: true,
};

// ── Focus Lock ────────────────────────────────────────────────────────────────

document.getElementById('setBtn').addEventListener('click', () => {
    const intent = document.getElementById('intentInput').value.trim();
    if (!intent) return;
    chrome.storage.local.set({ intentLock: intent, lockActive: true }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]?.id) return;
            chrome.tabs.sendMessage(tabs[0].id, { type: 'ACTIVATE_LOCK', intent }, () => {
                // Ignore errors — content script may not be loaded on non-LinkedIn tabs
                void chrome.runtime.lastError;
            });
        });
        setStatus('status', 'Focus locked!');
    });
});

document.getElementById('clearBtn').addEventListener('click', () => {
    chrome.storage.local.set({ lockActive: false }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]?.id) return;
            chrome.tabs.sendMessage(tabs[0].id, { type: 'DEACTIVATE_LOCK' }, () => {
                void chrome.runtime.lastError;
            });
        });
        setStatus('status', 'Unlocked.');
    });
});

chrome.storage.local.get(['intentLock', 'lockActive'], (data) => {
    if (data.lockActive && data.intentLock) {
        document.getElementById('intentInput').value = data.intentLock;
        setStatus('status', 'Currently locked in.');
    }
});

// ── Job Analyzer ──────────────────────────────────────────────────────────────

document.getElementById('analyzeBtn').addEventListener('click', async () => {
    const btn = document.getElementById('analyzeBtn');
    btn.disabled = true;
    btn.textContent = 'Analyzing...';
    setStatus('analyzeStatus', 'Extracting job description...', '');

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab.url || !tab.url.includes('linkedin.com')) {
            setStatus('analyzeStatus', 'Open a LinkedIn job posting first.', 'error');
            return;
        }

        let jd = null;
        try {
            const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_JOB_DESCRIPTION' });
            jd = resp?.jd;
        } catch {
            setStatus('analyzeStatus', 'Could not read the page. Try refreshing LinkedIn.', 'error');
            return;
        }

        if (!jd) {
            setStatus('analyzeStatus', 'No job description found. Open a specific job posting.', 'error');
            return;
        }

        setStatus('analyzeStatus', 'Sending to AI...', '');

        const res = await fetch(`${API_BASE}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_description: jd }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `Server error ${res.status}`);
        }

        const data = await res.json();
        await chrome.tabs.sendMessage(tab.id, { type: 'INJECT_ANALYSIS', data });

        setStatus('analyzeStatus', 'Analysis injected on the page!', 'success');

        // Guard against already-closed popup
        setTimeout(() => {
            try { window.close(); } catch (_) { /* popup already closed */ }
        }, 1200);

    } catch (err) {
        setStatus('analyzeStatus', `Error: ${err.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Analyze this job';
    }
});

// ── Profile Accessibility Score ───────────────────────────────────────────────

document.getElementById('profileScoreBtn').addEventListener('click', async () => {
    const btn = document.getElementById('profileScoreBtn');
    btn.disabled = true;
    btn.textContent = 'Scoring...';
    setStatus('profileScoreStatus', 'Reading profile...', '');

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab.url || !tab.url.includes('linkedin.com/in/')) {
            setStatus('profileScoreStatus', 'Open a LinkedIn profile page first.', 'error');
            return;
        }

        let profileData = null;
        try {
            const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PROFILE_CONTENT' });
            profileData = resp?.profile;
        } catch {
            setStatus('profileScoreStatus', 'Could not read the page. Try refreshing.', 'error');
            return;
        }

        if (!profileData || !profileData.headline && !profileData.about) {
            setStatus('profileScoreStatus', 'No profile content found.', 'error');
            return;
        }

        setStatus('profileScoreStatus', 'Sending to AI...', '');

        const res = await fetch(`${API_BASE}/profile-score`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profileData),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `Server error ${res.status}`);
        }

        const data = await res.json();
        await chrome.tabs.sendMessage(tab.id, { type: 'INJECT_PROFILE_SCORE', data });

        setStatus('profileScoreStatus', 'Score injected on the page!', 'success');
        setTimeout(() => {
            try { window.close(); } catch (_) { }
        }, 1200);

    } catch (err) {
        setStatus('profileScoreStatus', `Error: ${err.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Score this profile';
    }
});

// ── Post Simplifier ───────────────────────────────────────────────────────────

async function sendSimplifyPrefsToActiveTab(prefs) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes('linkedin.com')) return;
    await chrome.tabs.sendMessage(tab.id, { type: 'APPLY_SIMPLIFY_PREFS', prefs });
}

function saveAndApplySimplifyPrefs() {
    const prefs = {
        enabled: Boolean(document.getElementById('simplifyPostsToggle')?.checked),
    };
    chrome.storage.local.set({ simplifyPrefs: prefs }, async () => {
        try {
            await sendSimplifyPrefsToActiveTab(prefs);
            setStatus('simplifyStatus', prefs.enabled ? 'Simplify buttons on.' : 'Simplify buttons off.', 'success');
        } catch {
            setStatus('simplifyStatus', 'Refresh LinkedIn, then try again.', 'error');
        }
    });
}

document.getElementById('simplifyPostsToggle')?.addEventListener('change', saveAndApplySimplifyPrefs);

chrome.storage.local.get(['simplifyPrefs'], (data) => {
    const prefs = { ...DEFAULT_SIMPLIFY_PREFS, ...(data.simplifyPrefs || {}) };
    const toggle = document.getElementById('simplifyPostsToggle');
    if (toggle) toggle.checked = prefs.enabled;
});

// ── Reading Modes ─────────────────────────────────────────────────────────────

function getReadingPrefsFromForm() {
    const prefs = { ...DEFAULT_READING_PREFS };
    Object.entries(READING_TOGGLES).forEach(([id, key]) => {
        const el = document.getElementById(id);
        prefs[key] = Boolean(el?.checked);
    });
    return prefs;
}

function setReadingPrefsOnForm(prefs) {
    Object.entries(READING_TOGGLES).forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (el) el.checked = Boolean(prefs[key]);
    });
}

async function sendReadingPrefsToActiveTab(prefs) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes('linkedin.com')) return;
    await chrome.tabs.sendMessage(tab.id, { type: 'APPLY_READING_PREFS', prefs });
}

function saveAndApplyReadingPrefs() {
    const prefs = getReadingPrefsFromForm();
    chrome.storage.local.set({ readingPrefs: prefs }, async () => {
        try {
            await sendReadingPrefsToActiveTab(prefs);
            setStatus('readingStatus', 'Reading mode updated.', 'success');
        } catch {
            setStatus('readingStatus', 'Refresh LinkedIn, then try again.', 'error');
        }
    });
}

Object.keys(READING_TOGGLES).forEach((id) => {
    document.getElementById(id)?.addEventListener('change', saveAndApplyReadingPrefs);
});

document.getElementById('resetReadingBtn')?.addEventListener('click', () => {
    setReadingPrefsOnForm(DEFAULT_READING_PREFS);
    saveAndApplyReadingPrefs();
});

chrome.storage.local.get(['readingPrefs'], (data) => {
    const prefs = { ...DEFAULT_READING_PREFS, ...(data.readingPrefs || {}) };
    setReadingPrefsOnForm(prefs);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function setStatus(id, msg, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.className = 'status' + (type ? ' ' + type : '');
}

// ── Visual Alerts ─────────────────────────────────────────────────────────────

const alertsToggle = document.getElementById('alertsToggle');
const alertColorPicker = document.getElementById('alertColor');

// Load saved prefs and reflect them in the UI
chrome.storage.local.get(['visualAlertsEnabled', 'alertColor'], (prefs) => {
    const enabled = typeof prefs.visualAlertsEnabled === 'boolean'
        ? prefs.visualAlertsEnabled
        : true;
    alertsToggle.checked = enabled;
    if (prefs.alertColor) alertColorPicker.value = prefs.alertColor;
});

alertsToggle.addEventListener('change', () => {
    const enabled = alertsToggle.checked;
    chrome.storage.local.set({ visualAlertsEnabled: enabled }, () => {
        setStatus('alertStatus', enabled ? 'Flash alerts on.' : 'Flash alerts off.', enabled ? 'success' : '');
        setTimeout(() => setStatus('alertStatus', '', ''), 2000);
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]?.id) return;
            chrome.tabs.sendMessage(
                tabs[0].id,
                { type: 'SET_VISUAL_ALERTS', enabled },
                () => { void chrome.runtime.lastError; }
            );
        });
    });
});

alertColorPicker.addEventListener('input', () => {
    const color = alertColorPicker.value;
    chrome.storage.local.set({ alertColor: color }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]?.id) return;
            chrome.tabs.sendMessage(
                tabs[0].id,
                { type: 'SET_ALERT_COLOR', color },
                () => { void chrome.runtime.lastError; }
            );
        });
    });
});

document.getElementById('testFlashBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
        setStatus('alertStatus', 'No active tab found.', 'error');
        return;
    }

    const color = alertColorPicker.value || '#0a66c2';

    try {
        // Try content script first (fast path)
        chrome.tabs.sendMessage(tab.id, { type: 'TEST_FLASH' }, () => {
            void chrome.runtime.lastError; // suppress error if not loaded
        });

        // Always also inject directly via scripting API as guaranteed fallback
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (flashColor) => {
                // Remove old overlay
                document.getElementById('accessin-flash-overlay-test')?.remove();

                // Inject keyframes if not already present
                if (!document.getElementById('accessin-alert-styles')) {
                    const s = document.createElement('style');
                    s.id = 'accessin-alert-styles-test';
                    s.textContent = `
                        @keyframes accessin-flash {
                            0%   { opacity: 0.55; }
                            40%  { opacity: 0.55; }
                            100% { opacity: 0; }
                        }
                        #accessin-flash-overlay-test {
                            pointer-events: none;
                            position: fixed;
                            inset: 0;
                            z-index: 2147483646;
                            opacity: 0;
                            animation: accessin-flash 700ms ease-out forwards;
                        }
                    `;
                    document.head.appendChild(s);
                }

                const overlay = document.createElement('div');
                overlay.id = 'accessin-flash-overlay-test';
                overlay.style.background = flashColor;
                document.body.appendChild(overlay);
                overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
            },
            args: [color],
        });

        setStatus('alertStatus', 'Flash sent! ⚡', 'success');
        setTimeout(() => setStatus('alertStatus', '', ''), 2000);

    } catch (err) {
        setStatus('alertStatus', `Error: ${err.message}`, 'error');
    }
});
