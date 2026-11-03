import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Declare your Neon services here
  preview: {
    realtime: true,
  },
  auth: true,
  aiGateway: true,
  functions: {
    digestcron: {
      name: "Daily digest relay",
      source: "./functions/digestcron.ts",
      env: {
        APP_PASSWORD: process.env.APP_PASSWORD!,
        PUBLIC_API_URL: process.env.PUBLIC_API_URL!,
      },
    },
  },
  buckets: {
    // uploaded documents (attachments on SCEs/inspections/overrides/actions)
    docs: { access: "private" },
  },
  triggers: {
    // app default: digestHour 7 in Africa/Lagos == 06:00 UTC; the API also
    // catches up later the same day if the host was asleep at this hour
    "daily-digest": {
      type: "schedule",
      function: "digestcron",
      cron: "0 6 * * *",
      functionPath: "/cron",
    },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
