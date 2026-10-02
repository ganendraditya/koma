# BYOK providers

Koma sends manga images and recent dialogue directly to the selected provider. Choose a model that accepts images. OpenAI-compatible API support does not give a text-only model vision capabilities.

## Configure a provider

Open **Provider Settings (BYOK)** in the popup, select a provider, enter its credentials and model ID, then click **Save Settings**. Provider selection takes effect when saved. Switching the form between providers retains unsaved drafts while the popup is open; saving persists the selected profile.

| Provider          | API                           | Configuration                            |
| ----------------- | ----------------------------- | ---------------------------------------- |
| Google Gemini     | Gemini `generateContent`      | API key and Gemini model ID              |
| OpenAI            | OpenAI Responses              | API key and an image-capable model ID    |
| OpenAI-compatible | Chat Completions or Responses | API base URL, model ID, and optional key |

OpenAI defaults to `gpt-4.1-mini`. Suggestions include `gpt-5-mini` and `o4-mini`; model access depends on the provider account. The model input also accepts other IDs.

### Custom endpoints

Enter the **base URL**, including its version path, rather than the complete inference route:

- OpenAI-style server: `https://your-api.example/v1`
- OpenRouter: `https://openrouter.ai/api/v1`
- Local OpenAI-compatible server: `http://localhost:1234/v1`

Koma appends `/chat/completions` or `/responses` according to **API format**. Saving a custom endpoint requests Chrome access to its host. A denied request leaves the saved provider unchanged. HTTP is supported for local/self-hosted servers; use the scheme required by your endpoint.

Select **Prompt only** for servers without response-format support. **JSON object** and **Strict JSON schema** send the corresponding API constraints. Koma validates the final translation in all three modes. No automatic format fallback or second paid request is made after a rejection.

Local servers can leave the API key empty. Authenticated compatible endpoints use a Bearer token. Requests do not follow HTTP redirects.

## Reasoning

**Auto** selects Low for recognized OpenAI reasoning models. Unknown OpenAI IDs and compatible endpoints receive no reasoning-effort field in Auto mode, so the server uses its own default. Non-reasoning models also omit the control.

Other choices are Off, Minimal, Low, Medium, High, Extra high, and Maximum. The popup disables unsupported choices for known OpenAI models. For compatible endpoints, choose only efforts that the server and model support. Koma sends `reasoning.effort` for Responses and `reasoning_effort` for Chat Completions. Compatible services that require a different vendor-specific control can still run in Auto mode.

Some reasoning models cannot turn reasoning off. Omitting an effort or excluding reasoning text from the response does not disable the model's internal reasoning. Low is the reading-oriented default; higher effort can increase latency and token usage. Koma omits unsupported sampling parameters during reasoning and renders only the final translation.

OpenAI Responses reserves up to 16,384 output tokens for reasoning and final output. Compatible Chat Completions uses the server's configured token limit, avoiding assumptions about `max_tokens` versus `max_completion_tokens`. Incomplete output is rejected, including valid-looking JSON returned with `finish_reason: "length"`. The default translation deadline is 120 seconds, including image loading and final response consumption.

The capability table covers known OpenAI model families. Unknown IDs remain usable with Auto. See the provider's current model documentation for supported vision, output formats, and effort values:

- [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

## Credentials and migration

- **Remember key unchecked:** the key is stored in `chrome.storage.session` and expires with the browser session. Reopening the popup does not erase it.
- **Remember key checked:** the key is stored in extension local storage. This storage is not encrypted.
- Each provider has its own credentials and model settings. Changing provider does not copy its key to another provider.
- Clearing a key and saving removes it from that profile. Unchecking Remember key and saving moves a remembered key to session storage.
- Existing `koma_gemini_config` is migrated automatically, preserving the model, language, key, and storage preference. The legacy entry is removed after migration.

API keys are excluded from translation messages, cache identities, and diagnostic logs. The worker loads credentials from extension storage. Images are loaded in the reader context, then submitted to the worker as image data; the worker does not accept arbitrary reader-supplied URLs.

## Runtime and cache behavior

The runtime chain is `ContextAwareProvider → CachedTranslationProvider → ExtensionTranslationProvider`. The extension bridge delegates to a configured provider in the worker, returning only normalized results or Koma errors. Streaming is consumed internally; partial JSON and reasoning transcripts do not become overlays.

Ports send keepalive messages during translation and close after completion, cancellation, or timeout. Changing saved settings cancels outstanding work and resets the page's translation queue. Context remains available when changing providers. Cache identity includes the provider, model, endpoint, API format, response format, reasoning effort, target language, and narrative context; it does not include credentials.

## Troubleshooting

- **Authentication failed:** check the key and account access to the model.
- **Request rejected:** check image support, API format, response-format support, and reasoning effort. Auto and Prompt only are useful compatible-server settings.
- **Rate limit:** wait before retrying. Koma retains available `Retry-After` metadata.
- **Incomplete output:** lower reasoning effort, increase the compatible server's output limit, or retry.
- **Worker disconnected or timeout:** retry and check endpoint availability. The original image remains visible.

See [provider verification](BYOK_VERIFICATION.md) for automated coverage and recorded Chrome checks.
