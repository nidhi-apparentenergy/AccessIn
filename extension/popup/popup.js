document.getElementById('setBtn').addEventListener('click', () => {
    const intent = document.getElementById('intentInput').value.trim();
    if (!intent) return;

    chrome.storage.local.set({ intentLock: intent, lockActive: true }, () => {
        // Tell the active LinkedIn tab to activate immediately
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'ACTIVATE_LOCK', intent });
        });
        document.getElementById('status').textContent = 'Focus locked!';
    });
});

document.getElementById('clearBtn').addEventListener('click', () => {
    chrome.storage.local.set({ lockActive: false }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'DEACTIVATE_LOCK' });
        });
        document.getElementById('status').textContent = 'Unlocked.';
    });
});

// On popup open, show current state
chrome.storage.local.get(['intentLock', 'lockActive'], (data) => {
    if (data.lockActive && data.intentLock) {
        document.getElementById('intentInput').value = data.intentLock;
        document.getElementById('status').textContent = 'Currently locked in.';
    }
});