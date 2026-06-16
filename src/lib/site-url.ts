/** Site URL for metadata, canonical links, checkout redirects. Netlify sets URL at build time. */
export function getSiteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.URL ??
    "http://localhost:3000"
  );
}
