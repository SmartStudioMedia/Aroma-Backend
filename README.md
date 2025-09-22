# AROMA Restaurant Backend API

This is the backend API for the AROMA restaurant application.

## 🚀 Quick Start

1. Install dependencies: `npm install`
2. Copy `env.example` to `.env` and configure
3. Start server: `npm start`
4. Visit: http://localhost:4000

## 📋 Environment Variables

Set these in Railway dashboard:

- `PORT`: Server port (default: 4000)
- `ADMIN_USER`: Admin username (default: admin)
- `ADMIN_PASS`: Admin password (default: changeme)
- `FRONTEND_ORIGIN`: Your Vercel frontend URL

## 🔗 API Endpoints

- `GET /` - API information
- `GET /health` - Health check
- `GET /api/menu` - Get menu items
- `POST /api/orders` - Create new order
- `GET /admin` - Admin dashboard (requires auth)

## 🚀 Railway Deployment

1. Connect to GitHub repository
2. Set environment variables in Railway dashboard
3. Deploy automatically

## 🛠️ Development

```bash
npm install
npm run dev
```
