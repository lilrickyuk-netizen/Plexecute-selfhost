import { createFileRoute } from "@tanstack/react-router";
import { LEGAL_DOCS } from "@/lib/legal";

const BASE_URL = "https://plexecute.io";

// Public, signed-out pages only. Member, admin, auth and API pages are excluded.
const STATIC_PATHS = ["/", "/pricing", "/how-it-works", "/safety", "/legal", "/privacy", "/terms"];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const paths = [...STATIC_PATHS, ...LEGAL_DOCS.map((d) => `/legal/${d.slug}`)];
        const urls = [...new Set(paths)]
          .map((p) => `<url><loc>${BASE_URL}${p === "/" ? "/" : p}</loc></url>`)
          .join("");
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
          {
            headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" },
          },
        );
      },
    },
  },
});
