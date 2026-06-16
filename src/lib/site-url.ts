/** Site URL for metadata, canonical links, checkout redirects. Set via NEXT_PUBLIC_SITE_URL. */
export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}
