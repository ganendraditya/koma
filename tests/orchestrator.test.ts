import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranslationOrchestrator } from '../core/orchestrator/orchestrator';
import { SiteAdapter } from '../adapters';
import { TranslationProvider, MangaImage, TranslationResult } from '../core/contracts';
import { IRenderer } from '../core/orchestrator/types';

describe('TranslationOrchestrator', () => {
  let mockAdapter: SiteAdapter;
  let mockProvider: TranslationProvider;
  let mockRenderer: IRenderer;

  beforeEach(() => {
    mockAdapter = {
      name: 'MockAdapter',
      matches: () => true,
      detectMangaImages: vi.fn().mockReturnValue([]),
      observeMangaImages: vi.fn().mockReturnValue(() => {}),
    };

    mockProvider = {
      id: 'mock-provider',
      name: 'Mock Provider',
      capabilities: () => ({ vision: true, ocr: true, translation: true, boundingBoxes: true }),
      translatePage: vi.fn(),
    };

    mockRenderer = {
      render: vi.fn(),
    };
  });
  it('translates the first untranslated image correctly', async () => {
    const images: MangaImage[] = [
      { id: 'img-1', url: 'blob:1', pageIndex: 0, width: 100, height: 100 },
      { id: 'img-2', url: 'blob:2', pageIndex: 1, width: 100, height: 100 },
    ];
    vi.mocked(mockAdapter.detectMangaImages).mockReturnValue(images);

    const result: TranslationResult = {
      pageId: 'page-1',
      imageId: 'img-1',
      sourceLanguage: 'ja',
      targetLanguage: 'id',
      bubbles: [],
    };

    let resolveTranslation: (val: TranslationResult) => void;
    const translationPromise = new Promise<TranslationResult>((resolve) => {
      resolveTranslation = resolve;
    });
    vi.mocked(mockProvider.translatePage).mockReturnValue(translationPromise);

    const orchestrator = new TranslationOrchestrator(mockProvider, mockAdapter, mockRenderer);

    await orchestrator.translateNext();

    expect(mockProvider.translatePage).toHaveBeenCalledWith({
      image: images[0],
      targetLanguage: 'id',
    });

    // Resolve the promise to let processing complete
    resolveTranslation!(result);
    // Wait a tick for promises to flush
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRenderer.render).toHaveBeenCalledWith(result);

    const state = orchestrator.getState().get('img-1');
    expect(state?.status).toBe('completed');
  });

  it('prevents duplicate requests for already completed images', async () => {
    const images: MangaImage[] = [
      { id: 'img-1', url: 'blob:1', pageIndex: 0, width: 100, height: 100 },
    ];
    vi.mocked(mockAdapter.detectMangaImages).mockReturnValue(images);

    const result: TranslationResult = {
      pageId: 'page-1',
      imageId: 'img-1',
      sourceLanguage: 'ja',
      targetLanguage: 'id',
      bubbles: [],
    };

    // Auto-resolve mock
    vi.mocked(mockProvider.translatePage).mockResolvedValue(result);

    const orchestrator = new TranslationOrchestrator(mockProvider, mockAdapter, mockRenderer);

    // First translation
    await orchestrator.translateNext();
    // Wait for the queue to pump
    await new Promise((r) => setTimeout(r, 0));

    expect(mockProvider.translatePage).toHaveBeenCalledTimes(1);

    // Second request should skip img-1 because it's completed
    await orchestrator.translateNext();
    expect(mockProvider.translatePage).toHaveBeenCalledTimes(1);
  });

  it('allows retrying failed translations', async () => {
    const images: MangaImage[] = [
      { id: 'img-1', url: 'blob:1', pageIndex: 0, width: 100, height: 100 },
    ];
    vi.mocked(mockAdapter.detectMangaImages).mockReturnValue(images);

    const error = new Error('Network timeout');
    vi.mocked(mockProvider.translatePage).mockRejectedValueOnce(error);

    const orchestrator = new TranslationOrchestrator(mockProvider, mockAdapter, mockRenderer);

    const onErrorHandler = vi.fn();

    // First try (fails)
    await orchestrator.translateNext({ onError: onErrorHandler });
    // wait for rejection
    await new Promise((r) => setTimeout(r, 0));

    expect(orchestrator.getState().get('img-1')?.status).toBe('failed');
    expect(onErrorHandler).toHaveBeenCalledWith('img-1', error);

    // Mock success for retry
    const result: TranslationResult = {
      pageId: 'page-1',
      imageId: 'img-1',
      sourceLanguage: 'ja',
      targetLanguage: 'id',
      bubbles: [],
    };
    vi.mocked(mockProvider.translatePage).mockResolvedValueOnce(result);

    // Retry
    await orchestrator.retry('img-1');
    // Wait for resolution
    await new Promise((r) => setTimeout(r, 0));

    expect(orchestrator.getState().get('img-1')?.status).toBe('completed');
    expect(mockRenderer.render).toHaveBeenCalledWith(result);
  });

  it('handles at least three consecutive manga images without manual state manipulation', async () => {
    const images: MangaImage[] = [
      { id: 'img-1', url: 'blob:1', pageIndex: 0, width: 100, height: 100 },
      { id: 'img-2', url: 'blob:2', pageIndex: 1, width: 100, height: 100 },
      { id: 'img-3', url: 'blob:3', pageIndex: 2, width: 100, height: 100 },
    ];
    vi.mocked(mockAdapter.detectMangaImages).mockReturnValue(images);

    vi.mocked(mockProvider.translatePage).mockImplementation((req) =>
      Promise.resolve({
        pageId: 'page-1',
        imageId: req.image.id,
        sourceLanguage: 'ja',
        targetLanguage: 'id',
        bubbles: [],
      })
    );

    // Concurrency limit 1 is default
    const orchestrator = new TranslationOrchestrator(mockProvider, mockAdapter, mockRenderer);

    // One call should trigger the queue pump to process all 3 eventually
    await orchestrator.translateNext();

    // Wait for the chain to complete
    await new Promise((r) => setTimeout(r, 10));

    expect(orchestrator.getState().get('img-1')?.status).toBe('completed');
    expect(orchestrator.getState().get('img-2')?.status).toBe('completed');
    expect(orchestrator.getState().get('img-3')?.status).toBe('completed');

    expect(mockProvider.translatePage).toHaveBeenCalledTimes(3);
    expect(mockRenderer.render).toHaveBeenCalledTimes(3);
  });
});
