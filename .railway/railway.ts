import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const region = "europe-west4-drams3a";
  const data = volume("upt-data", { region });
  const web = service("web", {
    source: github("dragosefrem/upt-assistant", { branch: "main" }),
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    replicas: { [region]: 1 },
    volumeMounts: { "/data": data },
    deploy: { requiredMountPath: "/data" },
    healthcheck: "/api/health",
    env: {
      PORT: "3000",
      DATABASE_PATH: "/data/upt.db",
      // Operators can set these in Railway when enabling the corresponding feature.
      APP_URL: preserve(),
      ADMIN_EMAILS: preserve(),
      GEMINI_API_KEY: preserve(),
      GEMINI_MODEL: preserve(),
      ANTHROPIC_API_KEY: preserve(),
      SMTP_HOST: preserve(),
      SMTP_PORT: preserve(),
      SMTP_USER: preserve(),
      SMTP_PASS: preserve(),
      MAIL_FROM: preserve(),
      GOOGLE_CLIENT_ID: preserve(),
      GOOGLE_CLIENT_SECRET: preserve(),
      GOOGLE_MAPS_EMBED_KEY: preserve(),
    },
  });

  return project("upt-assistant", { resources: [web, data] });
});
