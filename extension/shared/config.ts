// BACKEND_URL and API_TOKEN are baked in at build time by build.ts.
// The config.generated.ts file is gitignored and produced from .env on every build.
export { BACKEND_URL, API_TOKEN } from "./config.generated";
