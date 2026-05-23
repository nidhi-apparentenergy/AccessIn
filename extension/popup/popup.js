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

// Focus Lock

document.getElementById('setBtn').addEventListener('click', () => {
    const intent = document.getElementById('intentInput').value.trim();
    if (!intent) return;

    chrome.storage.local.set({ intentLock: intent, lockActive: true }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'ACTIVATE_LOCK', intent });
        });
        setStatus('status', 'Focus locked!');
    });
});

document.getElementById('clearBtn').addEventListener('click', () => {
    chrome.storage.local.set({ lockActive: false }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'DEACTIVATE_LOCK' });
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

// Job Analyzer

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
        setTimeout(() => window.close(), 1200);
    } catch (err) {
        setStatus('analyzeStatus', `Error: ${err.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Analyze this job';
    }
});

// Post Simplifier

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

// Reading Modes

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

function setStatus(id, msg, type) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.className = 'status' + (type ? ' ' + type : '');
}
