import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Onyx Tether",
    short_name: "Onyx Tether",
    description: "Industrial asset tracking and accountability platform",
    start_url: "/mobile",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#0f172a",
    orientation: "portrait",
    icons: [
      {
        src: "/icons/onyx-tether-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/icons/onyx-tether-icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}

