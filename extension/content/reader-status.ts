import type { ReadingSessionState } from '@core/orchestrator';
import styles from './reader-status.css?inline';

type ReaderAction = 'pause' | 'translate';

export class ReaderStatusView {
  private readonly host: HTMLDivElement;
  private readonly panel: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly details: HTMLElement;
  private readonly counts: HTMLElement;
  private readonly countdown: HTMLElement;
  private readonly action: HTMLButtonElement;
  private readonly pause: HTMLButtonElement;
  private readonly collapse: HTMLButtonElement;
  private readonly expand: HTMLButtonElement;
  private currentAction: ReaderAction = 'pause';
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    onAction: (action: ReaderAction) => void,
    private readonly root: Document = document
  ) {
    this.host = root.createElement('div');
    this.host.setAttribute('data-koma-reader-status', 'true');
    this.host.lang = 'en';
    this.host.dir = 'ltr';
    this.host.style.cssText = `all: initial !important; position: fixed !important;
      bottom: max(12px, env(safe-area-inset-bottom)) !important;
      right: max(12px, env(safe-area-inset-right)) !important;
      max-width: calc(100vw - 24px) !important; z-index: 2147483647 !important;
      display: block !important;`;
    const shadow = this.host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${styles}</style>
      <section id="panel" aria-label="Koma translation status">
        <header><h2>Koma</h2><button type="button" class="collapse" aria-expanded="true" aria-controls="panel">Hide Status</button></header>
        <p class="summary" role="status" aria-live="polite" aria-atomic="true"></p>
        <p class="details"></p>
        <p class="counts"></p>
        <p class="cooldown" hidden></p>
        <button type="button" class="action"></button>
        <button type="button" class="pause" hidden>Pause</button>
      </section>
      <button type="button" class="expand" aria-expanded="false" aria-controls="panel" hidden></button>`;
    this.panel = shadow.querySelector('section')!;
    this.summary = shadow.querySelector('.summary')!;
    this.details = shadow.querySelector('.details')!;
    this.counts = shadow.querySelector('.counts')!;
    this.countdown = shadow.querySelector('.cooldown')!;
    this.action = shadow.querySelector('.action')!;
    this.pause = shadow.querySelector('.pause')!;
    this.collapse = shadow.querySelector('.collapse')!;
    this.expand = shadow.querySelector('.expand')!;
    this.collapse.addEventListener('click', () => this.setCollapsed(true));
    this.expand.addEventListener('click', () => this.setCollapsed(false));
    this.action.addEventListener('click', () => onAction(this.currentAction));
    this.pause.addEventListener('click', () => onAction('pause'));
    this.host.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.panel.hidden) {
        event.stopPropagation();
        this.setCollapsed(true);
      }
    });
    this.setCollapsed(false, false);
  }

  private setCollapsed(collapsed: boolean, moveFocus = true): void {
    this.panel.hidden = collapsed;
    this.expand.hidden = !collapsed;
    this.collapse.setAttribute('aria-expanded', String(!collapsed));
    this.host.style.setProperty(
      'width',
      collapsed ? 'auto' : 'min(22rem, calc(100vw - 24px))',
      'important'
    );
    this.expand.textContent = `Koma: ${this.summary.textContent || 'Preparing translation'}`;
    this.expand.setAttribute('aria-label', `${this.expand.textContent}. Show Status`);
    this.summary.setAttribute('aria-live', collapsed ? 'off' : 'polite');
    this.expand.setAttribute('aria-live', collapsed ? 'polite' : 'off');
    this.expand.setAttribute('aria-atomic', 'true');
    if (moveFocus) (collapsed ? this.expand : this.collapse).focus();
  }

  private mount(): void {
    if (!this.host.isConnected) this.root.body?.append(this.host);
  }

  private setSummary(text: string): void {
    if (this.summary.textContent !== text) this.summary.textContent = text;
    const compact = `Koma: ${text}`;
    if (this.expand.textContent !== compact) {
      this.expand.textContent = compact;
      this.expand.setAttribute('aria-label', `${compact}. Show Status`);
    }
    this.summary.setAttribute('aria-live', this.panel.hidden ? 'off' : 'polite');
    this.expand.setAttribute('aria-live', this.panel.hidden ? 'polite' : 'off');
  }

  preparing(): void {
    this.clearTimer();
    this.mount();
    this.setSummary('Preparing translation');
    this.details.textContent = 'Loading your provider settings.';
    this.counts.hidden = true;
    this.countdown.hidden = true;
    this.action.textContent = 'Preparing';
    this.action.disabled = true;
    this.pause.hidden = true;
  }

  showError(message: string): void {
    this.clearTimer();
    this.mount();
    this.setSummary('Translation could not start');
    this.details.textContent = `${message} Check Provider Settings in the Koma popup, then retry.`;
    this.counts.hidden = true;
    this.countdown.hidden = true;
    this.currentAction = 'translate';
    this.action.textContent = 'Retry Translation';
    this.action.disabled = false;
    this.pause.hidden = true;
  }

  update(state: ReadingSessionState): void {
    this.clearTimer();
    this.mount();
    const paused = state.status === 'paused';
    const remainingMs = Math.max(0, (state.cooldownUntil ?? 0) - Date.now());
    const remaining = Math.ceil(remainingMs / 1000);
    const cooling = !paused && remaining > 0;
    this.setSummary(
      paused
        ? 'Translation paused'
        : cooling
          ? 'Rate limit reached'
          : state.activeCount
            ? 'Translating pages'
            : state.queuedCount
              ? 'Pages queued'
              : state.error
                ? 'Translation needs attention'
                : state.acceptedCount
                  ? 'Pages ready'
                  : 'Waiting for manga images'
    );
    const description = paused
      ? 'Resume to translate pages near your viewport.'
      : cooling
        ? 'Waiting before sending more pages. Failed pages need an explicit retry.'
        : state.error
          ? `${state.error} Retry the visible page, or check Provider Settings in the Koma popup.`
          : state.activeCount || state.queuedCount
            ? 'Working on the current reading window.'
            : state.acceptedCount
              ? 'Translated pages are ready. Scroll to translate more nearby pages.'
              : 'Load or scroll to a manga image. Translation will start when it is available.';
    this.details.textContent = `${description}${state.overlaysVisible ? '' : ' Overlays are hidden.'}`;
    this.counts.hidden = false;
    this.counts.textContent = `${state.acceptedCount} pages ready, ${state.activeCount} active, ${state.queuedCount} queued`;
    this.countdown.hidden = !cooling;
    this.countdown.textContent = cooling ? `Wait ${remaining}s before retrying.` : '';
    this.currentAction = paused || state.error ? 'translate' : 'pause';
    this.action.textContent = paused ? 'Resume' : state.error ? 'Retry Visible Page' : 'Pause';
    this.action.disabled = cooling && this.currentAction === 'translate';
    this.pause.hidden =
      paused || !state.error || (!cooling && !state.activeCount && !state.queuedCount);
    if (cooling) {
      this.timer = setTimeout(() => this.update(state), remainingMs - (remaining - 1) * 1000);
    }
  }

  private clearTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  remove(): void {
    this.clearTimer();
    this.host.remove();
    this.setCollapsed(false, false);
  }
}
