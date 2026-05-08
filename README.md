# Growify HR — Attendance Intelligence Dashboard

A production-ready frontend UI for the n8n Attendance & Warning System.

---

## 🚀 Quick Start

1. Unzip this folder
2. Open `index.html` in any modern browser (Chrome/Edge/Firefox)
3. Click **Config** in the sidebar and paste your n8n URLs
4. Or click **"Load Mock Data"** to preview with demo data

No server, no build step, no npm install needed. Pure HTML/CSS/JS.

---

## 📡 n8n Integration — 3 Endpoints to Configure

Go to **Config** page inside the dashboard and fill in:

### 1. Webhook Trigger URL
**Used by:** Upload page → sends the Excel file to your pipeline

```
POST https://your-n8n.cloud/webhook/attendance-upload
Content-Type: multipart/form-data
Body: { file: <xlsx/csv>, filename: "Attendance_Report.xlsx" }
```

In n8n: Add a **Webhook node** (POST method) as the first node in your workflow.

---

### 2. Dashboard Data URL
**Used by:** Auto-refresh every 60 seconds to populate all tables and KPIs

```
GET https://your-n8n.cloud/webhook/get-dashboard
```

Your n8n workflow should return this JSON shape:

```json
{
  "employees": [
    {
      "employeeId": "EMP-001",
      "name": "Jane Doe",
      "lateCount": 2,
      "lastWarningDate": "2025-07-08",
      "month": "July 2025"
    }
  ],
  "todayRecords": [
    {
      "employeeId": "EMP-001",
      "name": "Jane Doe",
      "date": "2025-07-11",
      "checkIn": "11:15 AM",
      "checkOut": "06:00 PM",
      "lateFlag": "YES"
    }
  ],
  "warnings": [
    {
      "dateSent": "2025-07-10",
      "employeeName": "Jane Doe",
      "strikeLevel": 2,
      "emailPreview": "Second warning: We have noted...",
      "calendarLink": "https://calendar.google.com/..."
    }
  ],
  "trend": [
    { "date": "Mon", "count": 3 },
    { "date": "Tue", "count": 1 }
  ]
}
```

In n8n: Add a second **Webhook node** that reads from your Google Sheets and returns this format.

---

### 3. Manual Override URL
**Used by:** "Excuse" button per employee to mark a late as excused

```
POST https://your-n8n.cloud/webhook/excuse-late
Content-Type: application/json
Body: {
  "empId": "EMP-001",
  "name": "Jane Doe",
  "date": "2025-07-11",
  "reason": "Medical appointment",
  "excusedAt": "2025-07-11T14:30:00.000Z"
}
```

In n8n: Add a third **Webhook node** that updates the `lateFlag` in Google Sheets from YES → EXCUSED.

---

## 📊 Dashboard Pages

| Page | Description |
|------|-------------|
| **Dashboard** | Live KPIs: late today, on-time, critical, at-risk. Strike leaderboard. 7-day trend chart. Today's records table. |
| **Upload Log** | Drag-and-drop Excel/CSV. Animated pipeline steps. POST directly to n8n. |
| **Employees** | Full monthly strike tracker with search. Status badges: SAFE / AT RISK / CRITICAL. Manual override. |
| **Warnings** | All AI-generated warning emails sent. Strike level. Calendar link for 3rd strike meetings. |
| **Config** | Set all 3 n8n URLs. Test connections. Load mock data for demo. |

---

## ⚡ Features

- **Auto-refresh every 60 seconds** — no page reload needed
- **Animated KPI counters** on data load
- **Color-coded status badges**: 🟢 Safe (0-1) · 🟡 At Risk (2) · 🔴 Critical (3)
- **Strike dots** visualize progression toward 3rd strike
- **Excuse override modal** — POST to n8n to decrement strike count
- **Missing checkout detection** — shown as MISSING badge
- **Upload pipeline animation** — 7-step visual progress for each upload
- **Toast notifications** for all actions
- **Fully responsive** — works on tablet/mobile too

---

## 🗂️ File Structure

```
hr-dashboard/
├── index.html        ← Main app (single page, multi-section)
├── css/
│   └── style.css     ← All styles (dark theme, typography, layout)
├── js/
│   └── app.js        ← All logic (state, fetch, render, upload)
└── README.md
```

---

## 🔧 Customization

To change the **late threshold** displayed (currently 11:00 AM), update your n8n Code node logic.
The frontend only displays what n8n sends — all business logic lives in n8n.

---

## 🎨 Design Notes

- **Font**: Syne (display/headings) + DM Mono (data/labels) + DM Sans (body)
- **Theme**: Dark industrial, acid lime accent (#c8f135)
- **No external JS libraries** — canvas chart is hand-drawn
- **No framework** — plain HTML/CSS/JS for maximum portability
