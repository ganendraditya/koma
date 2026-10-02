import type { MangaImage } from '@core/contracts';
import { ProviderError } from '@core/errors';

export async function loadImageData(
  image: MangaImage,
  providerId: string,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
  signal?: AbortSignal
): Promise<{ base64Data: string; mimeType: string }> {
  if (image.base64Data) {
    const match = image.base64Data.match(/^data:(image\/[^;]+);base64,(.*)$/s);
    return {
      base64Data: match?.[2] ?? image.base64Data,
      mimeType: image.mimeType || match?.[1] || 'image/jpeg',
    };
  }
  if (!image.url)
    throw new ProviderError('Image data is missing.', 'KOMA_INVALID_IMAGE_ERROR', providerId);
  try {
    const response = await fetchFn(image.url, { signal });
    if (!response.ok) throw new Error('Image request failed');
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return {
      base64Data: btoa(binary),
      mimeType:
        image.mimeType || response.headers.get('content-type')?.split(';')[0] || 'image/jpeg',
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ProviderError('Could not load the manga image.', 'KOMA_IMAGE_LOAD_ERROR', providerId);
  }
}
