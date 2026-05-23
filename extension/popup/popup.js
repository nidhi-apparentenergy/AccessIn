const API_BASE = 'http://localhost:8000';

// ── Focus Lock ────────────────────────────────────────────────────────────────

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

// ── Job Analyzer ──────────────────────────────────────────────────────────────

document.getElementById('analyzeBtn').addEventListener('click', async () => {
    const btn = document.getElementById('analyzeBtn');
    btn.disabled = true;
    btn.textContent = 'Analyzing...';
    setStatus('analyzeStatus', 'Extracting job description...', '');

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Check we're on a LinkedIn job page
        if (!tab.url || !tab.url.includes('linkedin.com')) {
            setStatus('analyzeStatus', 'Open a LinkedIn job posting first.', 'error');
            return;
        }

        // Ask content script to extract the job description
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

        // Send results to content script to inject inline on the page
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function setStatus(id, msg, type) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.className = 'status' + (type ? ' ' + type : '');
}
