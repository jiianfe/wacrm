import type { MetadataRoute } from "next";

// Makes the CRM installable ("Add to home screen"), which is what lets a
// phone receive Web Push alerts while the app is closed.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ultratec CRM",
    short_name: "Ultratec CRM",
    description: "CRM de atendimento e orçamentos da Ultratec",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#7c3aed",
    icons: [
      { src: "/pwa-icon?size=192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon?size=512", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
