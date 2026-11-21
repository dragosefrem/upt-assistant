# Deploying UPT to Railway

The production configuration defines one `web` service in Amsterdam. Its `upt-data` volume holds SQLite and the imported timetable PDFs at `/data/upt.db`. The Docker image includes Node 24, both Python environments and FFmpeg. Campuspath starts on demand inside the web container.

## Prepare the project

From the repository root, install the locked dependencies with `npm ci` and sign in with `railway login`. The commands below use Railway CLI 5.75.0. You can also run the CLI with `npx @railway/cli@5.75.0`. Link the checkout to the existing project with `railway link --project happy-elegance --environment production`.

Railway needs GitHub access to `dragosefrem/upt-assistant` for the release. For later infrastructure updates, preview edits to `.railway/railway.ts` with `railway config plan --environment production` and apply the reviewed configuration with `railway config apply --environment production`. [Railway infrastructure as code](https://docs.railway.com/infrastructure-as-code)

## First release

1. Once the integration changes and deployment files reach GitHub's `main`, open the `production` dashboard in `happy-elegance`. Review and deploy the pending changes for `web` and `upt-data` together. Railway builds the root Dockerfile and checks `/api/health`. The check opens the mounted database and applies migrations and seed data on first use.
2. Register the administrator before adding a public domain. The first registration receives this role. With a Railway SSH key registered, run the following and keep the tunnel open while visiting `http://localhost:8080/register`. [Railway SSH port forwarding](https://docs.railway.com/cli/ssh#forward-a-port-with-ssh--l)

   ```sh
   railway ssh config --service web --alias upt-web
   ssh -N -L 127.0.0.1:8080:127.0.0.1:3000 upt-web
   ```

3. Import the university timetables from **Admin → Scrape UPT**, or run `railway ssh --service web -- npm run scrape`.
4. Run `railway domain --service web --port 3000`. Set `APP_URL` in the web service to the returned HTTPS address and apply the variable change. Verify that `/api/health` returns HTTP 200 at that address and sign in with the administrator account.

Add production mail, AI or Google Calendar credentials to the web service when enabling those features. The configuration preserves their values on later applies. For Google Calendar, register `<APP_URL>/api/google/callback` as the OAuth redirect URI.

Password resets and emailed calendars use SMTP. Railway enables outbound SMTP on Pro and higher plans. [Railway outbound networking](https://docs.railway.com/networking/outbound-networking#email-delivery)
