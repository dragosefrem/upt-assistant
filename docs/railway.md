# Deploying UPT to Railway

The production configuration defines one `web` service in Amsterdam. Its `upt-data` volume holds SQLite and the imported timetable PDFs at `/data/upt.db`. The Docker image includes Node 24, both Python environments and FFmpeg. Campuspath starts on demand inside the web container. [Open Poli](https://web-production-10d2d8df.up.railway.app) · [Check production health](https://web-production-10d2d8df.up.railway.app/api/health)

## Prepare the project

From the repository root, install the locked dependencies with `npm ci` and sign in with `railway login`. The commands below use Railway CLI 5.75.0. You can also run the CLI with `npx @railway/cli@5.75.0`. Link the checkout to the existing project with `railway link --project happy-elegance --environment production`.

For later infrastructure updates, preview edits to `.railway/railway.ts` with `railway config plan --environment production` and apply the reviewed configuration with `railway config apply --environment production`. [Railway infrastructure as code](https://docs.railway.com/infrastructure-as-code)

## Automatic deployments from `main`

`web` uses Railway's GitHub integration. Once the connection is live, each push to `dragosefrem/upt-assistant` on `main`, including a merged pull request, triggers a production build. The Railway GitHub App needs access to the repository, and at least one Railway project member must have a connected GitHub account with contributor access. [Railway GitHub autodeploys](https://docs.railway.com/deployments/github-autodeploys)

To activate the connection before the first release, review the pending `web` and `upt-data` changes in the `happy-elegance` production dashboard. Hold **Option** on macOS or **Alt** on Windows or Linux while clicking **Deploy** to save the configuration without building the current branch tip. In **web → Settings → Source**, check that the trigger branch is `main` and enable automatic deployments if Railway shows **Enable**. This setup is needed once. [Railway staged changes](https://docs.railway.com/deployments/staged-changes)

## First release

1. Merge the integration changes and deployment files into GitHub's `main`. Under **web → Deployments**, verify that Railway is building the pushed commit SHA. Railway builds the root Dockerfile and checks `/api/health` before switching traffic. The check opens the mounted database and applies migrations and seed data on first use.
2. Register the administrator before adding a public domain. The first registration receives this role. With a Railway SSH key registered, run the following and keep the tunnel open while visiting `http://localhost:8080/register`. [Railway SSH port forwarding](https://docs.railway.com/cli/ssh#forward-a-port-with-ssh--l)

   ```sh
   railway ssh config --service web --alias upt-web
   ssh -N -L 127.0.0.1:8080:127.0.0.1:3000 upt-web
   ```

3. Import the university timetables from **Admin → Scrape UPT**, or run `railway ssh --service web -- npm run scrape`.
4. Run `railway domain --service web --port 3000`. Set `APP_URL` in the web service to the returned HTTPS address and apply the variable change. Verify that `/api/health` returns HTTP 200 at that address and sign in with the administrator account.

Set `GEMINI_API_KEY` on `web` to enable Gemini. After deployment, a signed-in `GET /api/assistant` reports the active engine. Add mail and Google Calendar credentials when enabling those features. The configuration preserves their values on later applies. For Google Calendar, register `<APP_URL>/api/google/callback` as the OAuth redirect URI.

Password resets and emailed calendars use SMTP. Railway enables outbound SMTP on Pro and higher plans. [Railway outbound networking](https://docs.railway.com/networking/outbound-networking#email-delivery)
