/**
 * Fetch an image from a URL and return it as base64 with its MIME type.
 */
export interface FetchedImage {
  base64: string;
  mimeType: string;
}

export async function fetchImageAsBase64(url: string): Promise<FetchedImage> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image ${url}: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const mimeType = contentType.split(";")[0].trim();
  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");

  return { base64, mimeType };
}
