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

// Focus Lock Timer

let popupTimerInterval = null;

function updatePopupCountdown() {
    chrome.storage.local.get(['lockActive', 'lockEndTime', 'intentLock'], (data) => {
        const statusEl = document.getElementById('status');
        if (!statusEl) return;

        if (data.lockActive && data.lockEndTime) {
            const timeLeft = data.lockEndTime - Date.now();
            if (timeLeft <= 0) {
                setStatus('status', 'Focus Session Completed! ⏱️');
                clearInterval(popupTimerInterval);
                return;
            }

            const totalSeconds = Math.ceil(timeLeft / 1000);
            const mins = Math.floor(totalSeconds / 60);
            const secs = totalSeconds % 60;
            setStatus('status', `Currently locked in. Time left: ${mins}:${secs.toString().padStart(2, '0')} ⏳`);
        } else {
            clearInterval(popupTimerInterval);
            setStatus('status', data.lockActive ? 'Currently locked in.' : '');
        }
    });
}

document.getElementById('setBtn').addEventListener('click', () => {
    const intent = document.getElementById('intentInput').value.trim();
    if (!intent) return;

    const durationInput = document.getElementById('intentDuration');
    const durationMinutes = parseInt(durationInput ? durationInput.value : '30', 10) || 30;
    const endTime = Date.now() + durationMinutes * 60 * 1000;

    chrome.storage.local.set({ 
        intentLock: intent, 
        lockActive: true,
        lockEndTime: endTime,
        lockDuration: durationMinutes
    }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]?.id) return;
            chrome.tabs.sendMessage(tabs[0].id, { type: 'ACTIVATE_LOCK', intent, endTime }, () => {
                // Ignore errors — content script may not be loaded on non-LinkedIn tabs
                void chrome.runtime.lastError;
            });
        });
        
        setStatus('status', 'Focus locked!');
        if (popupTimerInterval) clearInterval(popupTimerInterval);
        popupTimerInterval = setInterval(updatePopupCountdown, 1000);
        updatePopupCountdown();
    });
});

document.getElementById('clearBtn').addEventListener('click', () => {
    chrome.storage.local.set({ lockActive: false, lockEndTime: null }, () => {
        if (popupTimerInterval) clearInterval(popupTimerInterval);
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]?.id) return;
            chrome.tabs.sendMessage(tabs[0].id, { type: 'DEACTIVATE_LOCK' }, () => {
                void chrome.runtime.lastError;
            });
        });
        setStatus('status', 'Unlocked.');
    });
});

chrome.storage.local.get(['intentLock', 'lockActive', 'lockEndTime', 'lockDuration'], (data) => {
    if (data.intentLock) {
        document.getElementById('intentInput').value = data.intentLock;
    }
    if (data.lockDuration) {
        const durInput = document.getElementById('intentDuration');
        if (durInput) durInput.value = data.lockDuration;
    }
    if (data.lockActive && data.lockEndTime) {
        if (popupTimerInterval) clearInterval(popupTimerInterval);
        popupTimerInterval = setInterval(updatePopupCountdown, 1000);
        updatePopupCountdown();
    }
});

// Job Analyzer Integration

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

// Profile Accessibility Score

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

        if (!profileData || (!profileData.headline && !profileData.about && !profileData.experience)) {
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

// Post Simplifier Preferences

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

// Reading Modes Preferences

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

// UI Status Helpers

function setStatus(id, msg, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.className = 'status' + (type ? ' ' + type : '');
}

// Visual Alerts / Flash Notifications

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

// Image Describer Preference
chrome.storage.local.get(['imageDescriberEnabled'], (data) => {
    const toggle = document.getElementById('imageDescriberToggle');
    if (toggle) toggle.checked = Boolean(data.imageDescriberEnabled);
});

document.getElementById('imageDescriberToggle')?.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    chrome.storage.local.set({ imageDescriberEnabled: enabled }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]?.id) return;
            chrome.tabs.sendMessage(
                tabs[0].id,
                { type: 'APPLY_IMAGE_DESCRIBER_PREF', enabled },
                () => { void chrome.runtime.lastError; }
            );
        });
        setStatus('imageDescriberStatus', enabled ? 'Image describer on.' : 'Image describer off.', 'success');
        setTimeout(() => setStatus('imageDescriberStatus', '', ''), 2000);
    });
});

// Tab Navigation Logic

const tabToolsBtn = document.getElementById('tab-tools-btn');
const tabSavedBtn = document.getElementById('tab-saved-btn');
const tabToolsContent = document.getElementById('tab-tools-content');
const tabSavedContent = document.getElementById('tab-saved-content');

function switchTab(activeTab) {
    if (activeTab === 'tools') {
        tabToolsBtn.classList.add('active');
        tabSavedBtn.classList.remove('active');
        tabToolsContent.classList.add('active');
        tabSavedContent.classList.remove('active');
    } else {
        tabToolsBtn.classList.remove('active');
        tabSavedBtn.classList.add('active');
        tabToolsContent.classList.remove('active');
        tabSavedContent.classList.add('active');
        renderSavedJobs();
    }
}

tabToolsBtn?.addEventListener('click', () => switchTab('tools'));
tabSavedBtn?.addEventListener('click', () => switchTab('saved'));

// Saved Jobs State & Rendering

function updateBadgeCount() {
    chrome.storage.local.get(['savedJobs'], (data) => {
        const jobs = data.savedJobs || [];
        const countBadge = document.getElementById('saved-jobs-count');
        if (countBadge) countBadge.textContent = jobs.length;
    });
}

function renderSavedJobs() {
    chrome.storage.local.get(['savedJobs'], (data) => {
        const jobs = data.savedJobs || [];
        const container = document.getElementById('savedJobsList');
        if (!container) return;

        // Update badge count
        const countBadge = document.getElementById('saved-jobs-count');
        if (countBadge) countBadge.textContent = jobs.length;

        // Apply filters
        const searchInput = document.getElementById('savedJobsSearch');
        const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
        
        let filteredJobs = jobs.filter(job => {
            const title = (job.title || '').toLowerCase();
            const company = (job.company || '').toLowerCase();
            const notes = (job.notes || '').toLowerCase();
            return title.includes(query) || company.includes(query) || notes.includes(query);
        });

        // Apply sorting
        const sortSelect = document.getElementById('savedJobsSort');
        const sortBy = sortSelect ? sortSelect.value : 'score-asc';

        filteredJobs.sort((a, b) => {
            if (sortBy === 'score-asc') {
                return (a.sensory_load_score || 0) - (b.sensory_load_score || 0);
            } else if (sortBy === 'score-desc') {
                return (b.sensory_load_score || 0) - (a.sensory_load_score || 0);
            } else if (sortBy === 'recent') {
                return (b.savedAt || 0) - (a.savedAt || 0);
            }
            return 0;
        });

        if (filteredJobs.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    ${query ? 'No matching saved jobs found.' : 'No saved jobs yet.<br/>Navigate to any LinkedIn job details page and use the inline <strong>🧠 Analyze with AccessIn</strong> button.'}
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        filteredJobs.forEach(job => {
            const card = document.createElement('div');
            card.className = 'job-card';
            card.dataset.id = job.id;

            const hasReminder = Boolean(job.reminder);

            card.innerHTML = `
                <div class="job-card-header">
                    <div class="job-info">
                        <h4 class="job-title">${escapeHTML(job.title || 'Unknown Job')}</h4>
                        <span class="job-company">${escapeHTML(job.company || 'Unknown Company')}</span>
                    </div>
                    <div class="job-score-badge score-${job.sensory_load_score || 0}">
                        Sensory: ${job.sensory_load_score || 0}/10
                    </div>
                </div>
                
                <div class="job-card-details collapsed" id="details-${job.id}">
                    <p class="job-explanation"><em>${escapeHTML(job.sensory_load_explanation || 'No sensory breakdown provided.')}</em></p>
                    <p class="job-summary">${escapeHTML(job.simplified_summary || 'No plain-language summary.')}</p>
                    
                    <div class="row row-center reminder-row">
                        <label class="toggle-label" for="reminder-${job.id}">🔔 Set Application Reminder</label>
                        <label class="switch" aria-label="Toggle application reminder">
                            <input type="checkbox" id="reminder-${job.id}" class="reminder-toggle" data-id="${job.id}" ${hasReminder ? 'checked' : ''} />
                            <span class="slider"></span>
                        </label>
                    </div>

                    <div class="job-notes-section">
                        <label class="notes-label">📝 Accessibility Notes:</label>
                        <textarea class="job-notes-input" placeholder="e.g. Contact HR for adjustments, asks for flexible hours..." data-id="${job.id}">${escapeHTML(job.notes || '')}</textarea>
                    </div>
                </div>
                
                <div class="job-card-actions">
                    <button class="card-btn details-toggle-btn" id="btn-toggle-${job.id}">Details ▾</button>
                    <a href="${job.url || '#'}" target="_blank" class="card-btn link-btn">Open 🔗</a>
                    <button class="card-btn delete-btn" data-id="${job.id}">Delete 🗑️</button>
                </div>
            `;

            container.appendChild(card);

            // Toggle details listener
            card.querySelector(`.details-toggle-btn`).addEventListener('click', () => {
                const details = card.querySelector(`.job-card-details`);
                const btn = card.querySelector(`.details-toggle-btn`);
                const isCollapsed = details.classList.toggle('collapsed');
                btn.textContent = isCollapsed ? 'Details ▾' : 'Collapse ▴';
            });

            // Delete listener
            card.querySelector(`.delete-btn`).addEventListener('click', () => {
                deleteSavedJob(job.id);
            });

            // Notes auto-save (instant on input)
            const notesTextarea = card.querySelector(`.job-notes-input`);
            notesTextarea.addEventListener('input', (e) => {
                updateSavedJobNotes(job.id, e.target.value);
            });

            // Reminder toggle listener
            const reminderToggle = card.querySelector(`.reminder-toggle`);
            reminderToggle.addEventListener('change', (e) => {
                updateSavedJobReminder(job.id, e.target.checked);
            });
        });
    });
}

// Saved Jobs Operations

function deleteSavedJob(id) {
    chrome.storage.local.get(['savedJobs'], (data) => {
        const jobs = data.savedJobs || [];
        const updatedJobs = jobs.filter(j => j.id !== id);
        chrome.storage.local.set({ savedJobs: updatedJobs }, () => {
            renderSavedJobs();
            updateFocusLockRecommendation();
        });
    });
}

function updateSavedJobNotes(id, value) {
    chrome.storage.local.get(['savedJobs'], (data) => {
        const jobs = data.savedJobs || [];
        const updatedJobs = jobs.map(j => {
            if (j.id === id) {
                j.notes = value;
            }
            return j;
        });
        chrome.storage.local.set({ savedJobs: updatedJobs });
    });
}

function updateSavedJobReminder(id, enabled) {
    chrome.storage.local.get(['savedJobs'], (data) => {
        const jobs = data.savedJobs || [];
        const updatedJobs = jobs.map(j => {
            if (j.id === id) {
                j.reminder = enabled;
            }
            return j;
        });
        chrome.storage.local.set({ savedJobs: updatedJobs });
    });
}

function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Attach filter listeners
document.getElementById('savedJobsSearch')?.addEventListener('input', renderSavedJobs);
document.getElementById('savedJobsSort')?.addEventListener('change', renderSavedJobs);

// Initialize badge count on popup load
updateBadgeCount();

// Focus Lock Suggestions

function updateFocusLockRecommendation() {
    chrome.storage.local.get(['lockActive', 'savedJobs'], (data) => {
        const statusEl = document.getElementById('status');
        if (!statusEl) return;

        // Remove old recommendation card if present
        document.getElementById('lock-rec-card')?.remove();

        if (data.lockActive && data.savedJobs && data.savedJobs.length > 0) {
            // Find lowest sensory load score job (best accessibility)
            const sortedJobs = [...data.savedJobs].sort((a, b) => (a.sensory_load_score || 0) - (b.sensory_load_score || 0));
            const recJob = sortedJobs[0];

            const recCard = document.createElement('div');
            recCard.className = 'lock-recommendation-card';
            recCard.id = 'lock-rec-card';
            recCard.innerHTML = `
                <span class="rec-title">💡 Focused Recommendation:</span>
                <div style="font-size: 11.5px; color: var(--text-primary); font-weight: 600; margin: 3px 0;">
                    Apply to <strong>${escapeHTML(recJob.title)}</strong> at ${escapeHTML(recJob.company)}
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                    <span class="job-score-badge score-${recJob.sensory_load_score || 0}" style="font-size: 9px; padding: 2px 6px;">Sensory: ${recJob.sensory_load_score || 0}/10</span>
                    <a href="${recJob.url || '#'}" target="_blank" class="card-btn link-btn" style="padding: 3px 8px; font-size: 9.5px; flex: 0 0 auto;">Apply Now 🔗</a>
                </div>
            `;
            statusEl.insertAdjacentElement('afterend', recCard);
        }
    });
}

// Hook into initial load of Lock status in popup.js
chrome.storage.local.get(['intentLock', 'lockActive'], (data) => {
    if (data.lockActive && data.intentLock) {
        updateFocusLockRecommendation();
    }
});

// Update recommendation when lock is toggled
document.getElementById('setBtn')?.addEventListener('click', () => {
    setTimeout(updateFocusLockRecommendation, 200);
});
document.getElementById('clearBtn')?.addEventListener('click', () => {
    document.getElementById('lock-rec-card')?.remove();
});