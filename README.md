# FMCSA Carrier Finder

A beautiful web application that scans MC numbers on the FMCSA SAFER website and finds **Active Authorized Carriers**. Deployable on Vercel for free.

> **No VPN needed!** When deployed to Vercel, the app runs from US based servers and can access FMCSA directly.

## Features

- **Quick MC Lookup** : Check any single MC number instantly
- **Batch Scanner** : Scan thousands of MC numbers automatically
- **Real time Progress** : Live stats, ETA, and progress bar
- **Pause/Resume** : Pause and resume scans at any time
- **CSV & Excel Export** : Download results in both formats
- **Connection Monitor** : Automatic FMCSA connectivity check
- **Scan Log** : Console style log of all activity
- **Dark Theme** : Premium dark glassmorphism UI

## How It Works

1. Enter a MC number range (e.g. 1700001 to 1800000)
2. Click **Start Scan**
3. The app sends batches to the `/api/check-mc` serverless function
4. Each function queries FMCSA SAFER and parses the result
5. Only **CARRIER** type entities with **ACTIVE** status are returned
6. Export the found carriers to CSV or Excel

## Deploy to Vercel (Free)

### One Click Deploy

1. Push this project to a GitHub repository
2. Go to [vercel.com](https://vercel.com) and sign up (free)
3. Click **New Project** and import your GitHub repo
4. Vercel auto detects the config. Click **Deploy**
5. Done! Your app is live at `your-project.vercel.app`

### Manual Deploy via CLI

```bash
npm install -g vercel
vercel login
vercel --prod
```

## Local Development

```bash
# Install dependencies
npm install

# Start the dev server
node server.js

# Open http://localhost:3000
```

> Note: The FMCSA website may not be accessible from your local machine without a US VPN. The app will show "FMCSA Unreachable" locally but will work on Vercel.

## Project Structure

```
pythontool/
├── api/
│   └── check-mc.js        # Vercel serverless function (FMCSA scraper)
├── public/
│   ├── index.html          # Main page
│   ├── style.css           # Premium dark theme
│   └── app.js              # Frontend scanning logic
├── server.js               # Local dev server
├── package.json            # Dependencies
├── vercel.json             # Vercel deployment config
└── .gitignore
```

## API Endpoints

### Check MC Number(s)

```
GET /api/check-mc?mc=1750192
GET /api/check-mc?start=1700001&count=5
```

### Test FMCSA Connection

```
GET /api/check-mc?test=true
```

## Vercel Free Tier Limits

| Resource                    | Limit      |
| --------------------------- | ---------- |
| Serverless Function Timeout | 10 seconds |
| Invocations per Month       | 100,000    |
| Bandwidth                   | 100 GB     |

With a batch size of 5, scanning 100K MC numbers = 20K invocations (well within limits).

## Configuration

Edit `vercel.json` to change server region:

- `iad1` : US East (Washington DC) [default, recommended]
- `sfo1` : US West (San Francisco)
- `cle1` : US Central (Cleveland)

## Data Fields Captured

- MC Number
- Entity Type (CARRIER / BROKER)
- USDOT Status (ACTIVE / INACTIVE)
- USDOT Number
- Operating Authority Status
- Legal Name & DBA Name
- Physical Address
- Phone Number
- Mailing Address
- Power Units
- MCS 150 Mileage & Form Date
