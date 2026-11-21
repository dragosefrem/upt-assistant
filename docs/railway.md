# Deploying UPT to Railway

The production environment runs one `web` service in Amsterdam. Its `upt-data` volume holds SQLite and the imported timetable PDFs at `/data/upt.db`. The Docker image includes Node 24, both Python environments and FFmpeg. Campuspath starts on demand inside the web container.

## Prepare the project

From the repository root, install the locked dependencies with `npm ci` and sign in with `railway login`. Use Railway CLI 5.42.1 or newer. Create the empty project with `railway init --name upt-assistant`. If it already exists, use `railway link --project upt-assistant --environment production`.

Run `railway config plan --environment production` to preview the service, its volume and the GitHub source. The plan is read-only. Railway needs GitHub access to `dragosefrem/upt-assistant` for the release. [Railway infrastructure as code](https://docs.railway.com/infrastructure-as-code)

## First release

1. Once the integration changes and these deployment files are on GitHub's `main`, run `railway config apply --environment production`. Railway builds that branch and checks `/api/health`. The check opens the mounted database and applies migrations and seed data on first use.
2. Register the administrator before adding a public domain. The first registration receives this role. With a Railway SSH key registered, run the following and keep the tunnel open while visiting `http://localhost:8080/register`. [Railway SSH port forwarding](https://docs.railway.com/cli/ssh#forward-a-port-with-ssh--l)

   ```sh
   railway ssh config --service web --alias upt-web
   ssh -N -L 127.0.0.1:8080:127.0.0.1:3000 upt-web
   ```

3. Import the university timetables from **Admin → Scrape UPT**, or run `railway ssh --service web -- npm run scrape`.
4. Run `railway domain --service web --port 3000`. Set `APP_URL` in the web service to the returned HTTPS address and apply the variable change. Verify that `/api/health` returns HTTP 200 at that address and sign in with the administrator account.

Add production mail, AI or Google Calendar credentials to the web service when enabling those features. The configuration preserves their values on later applies. For Google Calendar, register `<APP_URL>/api/google/callback` as the OAuth redirect URI.
