// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MangaDexAdapter } from '@adapters';
import fixture from './fixtures/mangadex-reader.html?raw';

const chapterId = 'f4d00fe4-ed62-446b-a144-5f3d42ca923c';
const chapterUrl = `https://mangadex.org/chapter/${chapterId}`;
const stops: Array<() => void> = [];

function setLoaded(image: HTMLImageElement, width = 800, height = 1200) {
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
  });
}

function setup(url = chapterUrl) {
  document.body.innerHTML = fixture;
  const getUrl = vi.fn(() => url);
  const adapter = new MangaDexAdapter(document, getUrl);
  document.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => setLoaded(image));
  return { adapter, getUrl };
}

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('MangaDex adapter', () => {
  it('matches chapter routes only, including page numbers, query strings, and hashes', () => {
    const { adapter } = setup();
    for (const url of [chapterUrl, `${chapterUrl}/12?foo=bar#reader`, `${chapterUrl}/`]) {
      expect(adapter.matches(url)).toBe(true);
    }
    for (const url of [
      'not a URL',
      'https://mangadex.org/',
      `https://mangadex.org/title/${chapterId}`,
      `${chapterUrl}/edit`,
      `${chapterUrl}/0`,
      'https://mangadex.org/chapter/not-a-uuid',
      `https://mangadex.org.evil.example/chapter/${chapterId}`,
      `https://forums.mangadex.org/chapter/${chapterId}`,
      `ftp://mangadex.org/chapter/${chapterId}`,
    ]) {
      expect(adapter.matches(url)).toBe(false);
    }
  });

  it('returns loaded reader pages in chapter order, excluding UI assets and ads', () => {
    const { adapter } = setup();
    const images = adapter.detectMangaImages();

    expect(images.map((image) => image.pageIndex)).toEqual([0, 2]);
    expect(images[0]).toMatchObject({
      id: `mangadex:${chapterId}:0`,
      url: 'blob:https://mangadex.org/first',
      width: 800,
      height: 1200,
      aspectRatio: 800 / 1200,
      metadata: { site: 'mangadex', chapterId },
    });
    expect(adapter.detectMangaImages()).toEqual(images);
  });

  it('keeps IDs and page indices stable across lazy loading, duplicate nodes, and blob replacement', () => {
    const { adapter } = setup();
    const before = adapter.detectMangaImages();
    const second = document.querySelector<HTMLImageElement>('img[alt^="2-"]')!;
    second.src = 'blob:https://mangadex.org/second';
    setLoaded(second);

    const first = document.querySelector<HTMLImageElement>('.md--reader-pages img[alt^="1-"]')!;
    const duplicate = first.cloneNode(true) as HTMLImageElement;
    setLoaded(duplicate);
    first.parentElement!.append(duplicate);
    first.src = 'blob:https://mangadex.org/reloaded';
    first.alt = '1-dddddddddddddddddddddddddddddddd.jpg';

    const after = adapter.detectMangaImages();
    expect(after.map((image) => image.pageIndex)).toEqual([0, 1, 2]);
    expect(after[0].id).toBe(before[0].id);
    expect(after[2].id).toBe(before[1].id);
    expect(after[0].url).toBe(first.src);
    first.remove();
    duplicate.remove();
    expect(adapter.detectMangaImages().map((image) => image.pageIndex)).toEqual([1, 2]);
    document.querySelector('.md--reader-pages')!.append(duplicate);
    expect(adapter.detectMangaImages()[0].id).toBe(before[0].id);
  });

  it('ignores incomplete, broken, and invalid-source images', () => {
    const { adapter } = setup();
    const first = document.querySelector<HTMLImageElement>('img[alt^="1-"]')!;
    const third = document.querySelector<HTMLImageElement>('img[alt^="3-"]')!;
    Object.defineProperty(first, 'complete', { configurable: true, value: false });
    setLoaded(third, 0, 0);
    expect(adapter.detectMangaImages()).toEqual([]);

    setLoaded(first);
    for (const src of [
      'javascript:alert(1)',
      'blob:https://other.example/id',
      'data:text/html,bad',
    ]) {
      first.src = src;
      expect(adapter.detectMangaImages()).toEqual([]);
    }
  });

  it('uses the loaded responsive source and resolves relative URLs against the reader page', () => {
    const { adapter } = setup();
    const first = document.querySelector<HTMLImageElement>('img[alt^="1-"]')!;
    first.src = '/data/page.png';
    expect(adapter.detectMangaImages()[0].url).toBe('https://mangadex.org/data/page.png');
    Object.defineProperty(first, 'currentSrc', { value: 'https://cdn.example/full.png' });
    expect(adapter.detectMangaImages()[0].url).toBe('https://cdn.example/full.png');
  });

  it('returns an empty result for unsupported pages or absent reader markup', () => {
    const { adapter, getUrl } = setup('https://example.com/');
    expect(adapter.detectMangaImages()).toEqual([]);
    getUrl.mockReturnValue(chapterUrl);
    document.body.innerHTML = '<img src="/cover.jpg">';
    expect(adapter.detectMangaImages()).toEqual([]);
  });

  it('observes lazy loads and DOM insertion, suppresses unchanged snapshots, and disconnects', async () => {
    const { adapter } = setup();
    const onChange = vi.fn();
    const stop = adapter.observeMangaImages(onChange);
    stops.push(stop);
    expect(onChange.mock.calls[0][0]).toHaveLength(2);

    const second = document.querySelector<HTMLImageElement>('img[alt^="2-"]')!;
    second.src = 'blob:https://mangadex.org/second';
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    setLoaded(second);
    second.dispatchEvent(new Event('load'));
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(
      onChange.mock.lastCall![0].map((image: { pageIndex: number }) => image.pageIndex)
    ).toEqual([0, 1, 2]);

    const fourth = document.createElement('img');
    fourth.className = 'img';
    fourth.alt = '4-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.png';
    fourth.src = 'blob:https://mangadex.org/fourth';
    setLoaded(fourth);
    document.querySelector('.md--reader-pages')!.append(fourth);
    await vi.waitFor(() => expect(onChange.mock.lastCall![0]).toHaveLength(4));

    const count = onChange.mock.calls.length;
    document.querySelector('header')!.append(document.createElement('span'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onChange).toHaveBeenCalledTimes(count);
    fourth.remove();
    stop();
    second.dispatchEvent(new Event('load'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onChange).toHaveBeenCalledTimes(count);
  });

  it('detects a reader mounted after startup and stops reporting images after SPA navigation', async () => {
    const { adapter, getUrl } = setup('https://mangadex.org/');
    document.body.innerHTML = '';
    const onChange = vi.fn();
    stops.push(adapter.observeMangaImages(onChange));
    expect(onChange.mock.lastCall![0]).toEqual([]);

    getUrl.mockReturnValue(chapterUrl);
    document.body.innerHTML = fixture;
    document.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => setLoaded(image));
    await vi.waitFor(() => expect(onChange.mock.lastCall![0]).toHaveLength(2));
    const ids = onChange.mock.lastCall![0].map((image: { id: string }) => image.id);
    getUrl.mockReturnValue(chapterUrl.replace(chapterId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'));
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(onChange.mock.lastCall![0][0].id).not.toBe(ids[0]));

    getUrl.mockReturnValue('https://mangadex.org/titles');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(onChange.mock.lastCall![0]).toEqual([]));
  });
});
