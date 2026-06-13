# 🔵 LinkedIn Access+

> An AI-powered Chrome extension that makes LinkedIn fully accessible for people with visual impairments, neurodivergent conditions, hearing loss, and cognitive overload.

Built by **Team Impact-o-Feminine** for the **CoachIn Hackathon 2026** (LinkedIn × CoachIn).

---

## 🚨 The Problem

1.3 billion people worldwide live with a disability. LinkedIn — like most professional platforms — assumes users can scan dense text quickly, see every image, hear every notification, and stay focused through an endless feed. These assumptions create real barriers to employment.

Access+ fixes this today, without waiting for the platform to change.

---

## ⚙️ How It Works

```
Chrome Extension (content script)
        ↓  reads LinkedIn DOM
        ↓  sends requests
FastAPI Backend (Python)
        ↓  calls
Google Gemini 2.5 Flash
        ↓  returns structured JSON
Extension injects results into the live LinkedIn page
```

---

## ✨ 11 Features

| # | Feature | What it does | Who it helps |
|---|---------|-------------|-------------|
| 1 | 🔊 **Read Aloud Engine** | Spatial, keyboard-driven TTS. Navigate LinkedIn with Alt+Arrow keys while content is narrated aloud. | Blind & low-vision, motor-impaired |
| 2 | 🧠 **Job Analyzer** | AI simplification of job descriptions. Detects bias, exclusionary language, and generates plain-language summaries with sensory load scores. | Neurodivergent, ADHD |
| 3 | ♿ **Profile Accessibility Score** | Grades your LinkedIn profile for readability and clarity. Provides actionable fixes across 5 algorithmic metrics. | All job seekers |
| 4 | ✂️ **Post Simplifier** | Converts long posts into summaries, key points, and action items. Supports follow-up questions. | ADHD, cognitive overload |
| 5 | 🖼️ **Image Describer** | Gemini Vision generates contextual descriptions for images without alt text and reads them aloud. | Blind & low-vision |
| 6 | 📊 **Sensory Badge** | Scores each post's cognitive complexity from 1–10 before you read it. | Anxiety, cognitive overload |
| 7 | 📖 **Reading Modes** | Dyslexia-friendly fonts, larger text, increased spacing, high contrast, reduced motion, clutter-free layout. | Dyslexia, low vision |
| 8 | 🎯 **Focus + Timer** | Hides the feed and locks your session to a user-defined goal. | ADHD, anxiety |
| 9 | ⚡ **Flash Alerts** | Replaces audio notifications with customizable visual screen flashes. | Deaf & hard-of-hearing |
| 10 | 💼 **Save Jobs Tracker** | Saves analyzed jobs, ranks by accessibility score, tracks application status, and sets reminders. | All users |
| 11 | ⌨️ **Shortcuts Panel** | Full keyboard control for every feature. No mouse required. | Motor-impaired, keyboard-first users |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Chrome Extension (Manifest V3, JavaScript) |
| Backend | FastAPI (Python) |
| AI | Google Gemini 2.5 Flash (text + vision) |
| Speech | Web Speech API (browser-native TTS) |
| Storage | Chrome Extension local storage |

---

## 📁 Project Structure

```
AccessIn/
├── backend/
│   ├── main.py               # FastAPI app entry point
│   └── routes/
│       ├── analyze.py        # POST /analyze — Job description analysis
│       ├── describe.py       # POST /describe — Image description
│       ├── simplify.py       # POST /simplify — Post simplification
│       └── profile_score.py  # POST /profile-score — Profile scoring
├── extension/
│   ├── manifest.json
│   ├── content/
│   │   └── content.js        # Content script injected into LinkedIn
│   └── popup/
│       ├── popup.html
│       ├── popup.js
│       └── popup.css
└── tests/
    └── test_analyze.py
```

---

## 🚀 Setup

### 1. Backend

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate
# Mac/Linux
source venv/bin/activate

pip install -r requirements.txt
```

Create a `.env` file in the `backend/` folder:
```
GEMINI_API_KEY=your_gemini_api_key_here
```

Get a free Gemini API key at https://aistudio.google.com/app/apikey

Start the server:
```bash
uvicorn main:app --reload --port 8000
```

### 2. Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder

The extension icon will appear in your toolbar. Open LinkedIn and click it to get started.

---

## 🎮 Keyboard Shortcuts

### 🔊 Read Aloud

| Shortcut | Action |
|----------|--------|
| `Alt + ↓` | Start reading / move down |
| `Alt + ↑` | Move up |
| `Alt + ← / →` | Move left / right |
| `Alt + S` | Stop reading |
| `Alt + =` | Speed up |
| `Alt + -` | Slow down |

### 🖼️ Image Describer

| Shortcut | Action |
|----------|--------|
| `Ctrl + D` | Describe focused / visible image and read aloud |
| `Ctrl + S` | Stop speech and close description panel |
| `Tab / Shift + Tab` | Move focus between images on the page |
| `Ctrl + ← / →` | Cycle focus between images manually |
| `Ctrl + ↑ / ↓` | Scroll feed container up / down |

---

## 💡 Key Challenges

- **LinkedIn's dynamic class names** — LinkedIn uses auto-generated CSS class names that change without notice. We built multi-level DOM fallback parsers targeting semantic structure rather than specific class names.
- **Chrome extension context invalidation** — Content scripts lose their extension context on reload. We handled this with try/catch and storage-based state recovery.
- **Gemini JSON parsing** — Gemini occasionally returns multiline JSON strings. We built a three-stage parser handling code fences, whitespace collapsing, and regex-based JSON extraction.
- **LinkedIn CORS restrictions** — LinkedIn images are CORS-protected. We implemented a canvas-based fallback to capture rendered image data when direct fetch fails.

---

## 👩‍💻 Team

**Team Impact-o-Feminine** — CoachIn Hackathon 2026

Built under the theme: *AI for Inclusive & Accessible Opportunities*

---

## 📄 License

MIT