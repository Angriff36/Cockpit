/**
 * Webhook dispatcher — sends POST requests to configured webhook URLs
 * on project lifecycle events. Fire-and-forget with retry logic.
 *
 * Usage:
 *   import { WebhookDispatcher } from './webhook.js';
 *   const wh = new WebhookDispatcher();
 *   wh.addConfig({ id, url, events: 'daemon.start,deploy.triggered', secret: '', enabled: true });
 *   wh.emit('daemon.start', { slug: 'my-app', name: 'My App' }, { pid: 1234 });
 */
import { createHmac } from 'crypto';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;     // base delay, doubled per attempt
const REQUEST_TIMEOUT_MS = 5000; // per webhook request

/**
 * In-memory webhook configuration store.
 * Configs are loaded from Supabase on daemon start and refreshed via the API.
 */
export class WebhookDispatcher {
  constructor(opts = {}) {
    /** @type {Map<string, { id: string, url: string, events: string[], secret: string, enabled: boolean, projectSlug: string }>} */
    this.configs = new Map();
    this.maxRetries = opts.maxRetries ?? MAX_RETRIES;
    this.retryDelay = opts.retryDelay ?? RETRY_DELAY_MS;
    this.timeout = opts.timeout ?? REQUEST_TIMEOUT_MS;
    /** @type {Array<{ id: string, webhookId: string, event: string, payload: object, status: string, statusCode: number|null, responseBody: string, attemptCount: number, createdAt: number }>} */
    this.deliveryLog = [];
    this.maxLogSize = opts.maxLogSize ?? 500;
  }

  /**
   * Register a webhook configuration.
   * @param {{ id: string, url: string, events: string, secret?: string, enabled?: boolean, projectSlug?: string }} config
   */
  addConfig(config) {
    const events = (config.events || '').split(',').map(e => e.trim()).filter(Boolean);
    this.configs.set(config.id, {
      id: config.id,
      url: config.url,
      events,
      secret: config.secret || '',
      enabled: config.enabled !== false,
      projectSlug: config.projectSlug || '',
    });
  }

  /**
   * Remove a webhook configuration.
   * @param {string} id
   */
  removeConfig(id) {
    this.configs.delete(id);
  }

  /**
   * Clear all configs.
   */
  clearConfigs() {
    this.configs.clear();
  }

  /**
   * Emit an event to all matching webhook configs.
   * Fire-and-forget: errors are logged but do not propagate.
   *
   * @param {string} eventType - e.g. 'daemon.start', 'deploy.triggered'
   * @param {{ slug: string, name: string }} project - project context
   * @param {object} [data={}] - event-specific data
   */
  emit(eventType, project, data = {}) {
    const payload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      project: { slug: project.slug, name: project.name || project.slug },
      data,
    };

    for (const [, config] of this.configs) {
      if (!config.enabled) continue;
      if (!config.events.includes(eventType)) continue;
      // Fire and forget — don't await
      this._deliver(config, payload).catch(() => {});
    }
  }

  /**
   * Deliver a webhook payload with retry logic.
   * @private
   */
  async _deliver(config, payload) {
    let lastError = null;
    let statusCode = null;
    let responseBody = '';

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const body = JSON.stringify(payload);
        const headers = {
          'Content-Type': 'application/json',
          'User-Agent': 'ldc-webhook/0.1.0',
          'X-Webhook-Event': payload.event,
          'X-Webhook-Delivery': this._generateDeliveryId(),
        };

        // Sign with HMAC-SHA256 if a secret is configured
        if (config.secret) {
          const sig = createHmac('sha256', config.secret).update(body).digest('hex');
          headers['X-Webhook-Signature'] = `sha256=${sig}`;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeout);

        const res = await fetch(config.url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timeout);
        statusCode = res.status;
        responseBody = await res.text().catch(() => '');

        if (res.status >= 200 && res.status < 300) {
          this._logDelivery(config.id, payload.event, payload, 'success', statusCode, responseBody, attempt + 1);
          return;
        }

        lastError = `HTTP ${res.status}`;
      } catch (err) {
        lastError = err.name === 'AbortError' ? 'Timeout' : err.message;
      }

      // Wait before retry (exponential backoff)
      if (attempt < this.maxRetries) {
        await new Promise(r => setTimeout(r, this.retryDelay * Math.pow(2, attempt)));
      }
    }

    this._logDelivery(config.id, payload.event, payload, 'failed', statusCode, lastError, this.maxRetries + 1);
  }

  /**
   * Log a delivery attempt.
   * @private
   */
  _logDelivery(webhookId, event, payload, status, statusCode, responseBody, attemptCount) {
    const entry = {
      id: this._generateDeliveryId(),
      webhookId,
      event,
      payload,
      status,
      statusCode,
      responseBody: (responseBody || '').slice(0, 500),
      attemptCount,
      createdAt: Date.now(),
    };

    this.deliveryLog.push(entry);
    if (this.deliveryLog.length > this.maxLogSize) {
      this.deliveryLog.shift();
    }
  }

  /**
   * Get recent delivery logs.
   * @param {object} [opts]
   * @param {string} [opts.status] - Filter by status
   * @param {number} [opts.limit] - Max entries (default 50)
   */
  getDeliveryLog(opts = {}) {
    let entries = this.deliveryLog;
    if (opts.status) {
      entries = entries.filter(e => e.status === opts.status);
    }
    return entries.slice(-(opts.limit || 50));
  }

  /**
   * Generate a unique delivery ID.
   * @private
   */
  _generateDeliveryId() {
    return `wh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
