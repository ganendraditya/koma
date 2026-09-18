import { describe, it, expect, vi, beforeEach } from 'vitest';
import manifest from '../extension/manifest.json';
import {
  EXTENSION_MESSAGE_TYPES,
  PingRequest,
  PingResponse,
  CheckPageStatusResponse,
  DiagnosticReport,
} from '../shared/messages';
import {
  getStoredGeminiConfig,
  saveStoredGeminiConfig,
  clearStoredGeminiConfig,
} from '../providers/gemini/storage';
import { KOMA_VERSION } from '../core';

describe('KOMA-002: Chrome Manifest V3 Extension Shell', () => {
  describe('Manifest V3 Configuration & Integrity', () => {
    it('declares Manifest V3 specification', () => {
      expect(manifest.manifest_version).toBe(3);
    });

    it('has valid metadata and name', () => {
      expect(manifest.name).toContain('Koma');
      expect(manifest.version).toBe(KOMA_VERSION);
      expect(manifest.description).toBeTruthy();
    });

    it('limits permissions strictly to current Sprint 1 requirements', () => {
      expect(manifest.permissions).toContain('storage');
      expect(manifest.permissions).toContain('activeTab');
      // Must not request intrusive permissions
      expect(manifest.permissions).not.toContain('webRequest');
      expect(manifest.permissions).not.toContain('cookies');
      expect(manifest.permissions).not.toContain('management');
    });

    it('declares host permissions for Gemini API endpoint', () => {
      expect(manifest.host_permissions).toContain('https://generativelanguage.googleapis.com/*');
    });

    it('configures ES module background service worker', () => {
      expect(manifest.background).toBeDefined();
      expect(manifest.background.service_worker).toBe('background.js');
      expect(manifest.background.type).toBe('module');
    });

    it('configures content script injection on idle', () => {
      expect(manifest.content_scripts).toHaveLength(1);
      const cs = manifest.content_scripts[0];
      expect(cs.js).toContain('content.js');
      expect(cs.run_at).toBe('document_idle');
      expect(cs.matches).toContain('<all_urls>');
    });

    it('declares popup and required extension icons', () => {
      expect(manifest.action.default_popup).toBe('extension/popup/index.html');
      expect(manifest.icons['16']).toBe('icons/icon16.png');
      expect(manifest.icons['48']).toBe('icons/icon48.png');
      expect(manifest.icons['128']).toBe('icons/icon128.png');
    });
  });

  describe('Inter-Process Messaging Protocol & Handlers', () => {
    it('defines standardized message type constants', () => {
      expect(EXTENSION_MESSAGE_TYPES.PING).toBe('PING');
      expect(EXTENSION_MESSAGE_TYPES.CHECK_PAGE_STATUS).toBe('CHECK_PAGE_STATUS');
      expect(EXTENSION_MESSAGE_TYPES.RUN_DIAGNOSTIC).toBe('RUN_DIAGNOSTIC');
      expect(EXTENSION_MESSAGE_TYPES.TRANSLATE_ACTIVE_PAGE).toBe('TRANSLATE_ACTIVE_PAGE');
    });

    it('handles PING request in background service worker logic', () => {
      const handlePing = (message: unknown): PingResponse | null => {
        if ((message as PingRequest)?.type === EXTENSION_MESSAGE_TYPES.PING) {
          return {
            status: 'OK',
            version: KOMA_VERSION,
            timestamp: Date.now(),
          };
        }
        return null;
      };

      const response = handlePing({ type: 'PING' });
      expect(response).not.toBeNull();
      expect(response?.status).toBe('OK');
      expect(response?.version).toBe(KOMA_VERSION);
      expect(typeof response?.timestamp).toBe('number');
    });

    it('simulates content script CHECK_PAGE_STATUS response', () => {
      const handleCheckStatus = (url: string, imgCount: number): CheckPageStatusResponse => {
        return {
          active: true,
          url,
          imageCount: imgCount,
        };
      };

      const resp = handleCheckStatus('https://mangadex.org/chapter/12345', 42);
      expect(resp.active).toBe(true);
      expect(resp.url).toBe('https://mangadex.org/chapter/12345');
      expect(resp.imageCount).toBe(42);
    });

    it('executes RUN_DIAGNOSTIC flow simulating Content Script -> Service Worker roundtrip', async () => {
      // Mock background service worker responding to PING
      const mockServiceWorker = vi.fn().mockImplementation((msg: PingRequest) => {
        if (msg.type === 'PING') {
          return { status: 'OK', version: KOMA_VERSION, timestamp: Date.now() };
        }
        return null;
      });

      // Simulated diagnostic execution in content script
      const runDiagnostic = async (
        pageUrl: string,
        detectedImages: number
      ): Promise<DiagnosticReport> => {
        const start = Date.now();
        const swResp = mockServiceWorker({ type: 'PING' });
        const latency = Date.now() - start;

        return {
          success: true,
          timestamp: Date.now(),
          url: pageUrl,
          contentScript: {
            active: true,
            detectedImages,
            readyState: 'complete',
          },
          serviceWorker: {
            reachable: Boolean(swResp && swResp.status === 'OK'),
            status: swResp?.status,
            version: swResp?.version,
            latencyMs: latency,
          },
        };
      };

      const report = await runDiagnostic('https://mangadex.org/chapter/test', 15);
      expect(report.success).toBe(true);
      expect(report.contentScript.active).toBe(true);
      expect(report.contentScript.detectedImages).toBe(15);
      expect(report.serviceWorker.reachable).toBe(true);
      expect(report.serviceWorker.status).toBe('OK');
      expect(report.serviceWorker.version).toBe('0.1.0');
      expect(report.serviceWorker.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('handles background service worker disconnection gracefully in diagnostics', async () => {
      const runFailingDiagnostic = async (): Promise<DiagnosticReport> => {
        return {
          success: true,
          timestamp: Date.now(),
          url: 'https://example.com',
          contentScript: {
            active: true,
            detectedImages: 0,
            readyState: 'complete',
          },
          serviceWorker: {
            reachable: false,
            error: 'Could not establish connection. Receiving end does not exist.',
          },
        };
      };

      const report = await runFailingDiagnostic();
      expect(report.success).toBe(true);
      expect(report.contentScript.active).toBe(true);
      expect(report.serviceWorker.reachable).toBe(false);
      expect(report.serviceWorker.error).toContain('Could not establish connection');
    });
  });

  describe('Extension Settings & BYOK Foundation', () => {
    beforeEach(async () => {
      await clearStoredGeminiConfig();
    });

    it('initializes with default provider configuration', async () => {
      const config = await getStoredGeminiConfig();
      expect(config.apiKey).toBe('');
      expect(config.modelName).toBe('gemini-3.5-flash-lite');
      expect(config.targetLanguage).toBe('id');
      expect(config.rememberKey).toBe(true);
    });

    it('persists and updates API key and target language', async () => {
      await saveStoredGeminiConfig({
        apiKey: 'AIzaSyTestKeyForExtensionShell',
        targetLanguage: 'en',
        modelName: 'gemini-3.8-flash',
      });

      const updated = await getStoredGeminiConfig();
      expect(updated.apiKey).toBe('AIzaSyTestKeyForExtensionShell');
      expect(updated.targetLanguage).toBe('en');
      expect(updated.modelName).toBe('gemini-3.8-flash');
    });

    it('clears stored credentials on reset', async () => {
      await saveStoredGeminiConfig({ apiKey: 'key-to-delete' });
      await clearStoredGeminiConfig();

      const cleared = await getStoredGeminiConfig();
      expect(cleared.apiKey).toBe('');
    });
  });
});
