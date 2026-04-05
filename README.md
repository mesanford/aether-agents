<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/292f0614-ee04-4099-bfc4-d30e1d05798d

## Development Setup

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Create an `.env.local` file by copying `.env.example`:
   `cp .env.example .env.local`
3. Set your `GEMINI_API_KEY` and `JWT_SECRET` in `.env.local`
4. Run the app in development mode:
   `npm run dev`

## Local Production Deployment

For a robust local deployment (e.g. running on a local server or background process):

1. Follow the Development Setup prerequisites and `.env.local` configuration.
2. Set additional environment variables in `.env.local`:
   * `JWT_SECRET`: A strong secret key for session tokens. Required in production.
   * `APP_URL`: The URL where your app is hosted (e.g., `http://192.168.1.100:3000`).
   * `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: For Google OAuth login.
   * `PORT`: Optional server port. Defaults to `3000`.
   * `DATABASE_PATH`: Optional SQLite file path. Defaults to `crm.db`.
3. Build the frontend assets:
   `npm run build`
4. Start the production server:
   `npm start`

The server binds to `0.0.0.0` and uses `PORT` (default `3000`), making it accessible on your local network.
