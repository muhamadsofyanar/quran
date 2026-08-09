import type { MetadataRoute } from "next";

// @phase TQ-01 — installable app identity.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Taysriul Qur'ani",
    short_name: "Taysriul",
    description: "Studio produksi video Al-Qur'an.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f6f1",
    theme_color: "#0e6b50",
    lang: "id",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
