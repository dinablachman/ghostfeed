# Wayback Twitter App

A full-stack app to view archived tweets from suspended Twitter accounts using the Wayback Machine.

## 🛠️ Requirements
- Node.js v18+
- npm (or yarn)

## 📦 Project Structure

```
/wayback-twitter-app
├── /client         # React + Vite frontend
├── /server         # Express backend
├── package.json    # root scripts (concurrent dev)
```

## 🚀 Setup & Run

1. **Install dependencies:**
   ```sh
   npm install
   ```
2. **Start both frontend & backend:**
   ```sh
   npm run dev
   ```
   - Frontend: [http://localhost:5173](http://localhost:5173)
   - Backend: [http://localhost:5174](http://localhost:5174)

## 🖥️ Usage
- Enter a suspended Twitter `@username` (no @ needed)
- Click "Search"
- View archived tweets (text + timestamp, newest first)

## 🔗 How it works
- Backend fetches Wayback Machine CDX API for tweet snapshots
- For each snapshot, extracts tweet text & timestamp (JSON or HTML)
- Returns sorted array to frontend
- Frontend displays tweets in a clean list

---

No data is stored. No authentication required. For educational/demo use only. 