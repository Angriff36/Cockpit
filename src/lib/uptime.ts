/**
 * Uptime tracking — stores port liveness samples in IndexedDB as a ring buffer
 * and provides stats computation (uptime %, flapping detection) for sparklines.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { openDB, type IDBPDatabase } from 'idb';
import type { UptimeSample, UptimeStats } from './types';

// ── Constants ──────────────────────────────────────────────────────────────────

const DB_NAME = 'cockpit-uptime';
const DB_VERSION = 1;
const STORE = 'samples';

/** Maximum samples per port (ring buffer cap). 288 * 30s = 24h */
const MAX_SAMPLES = 288;

/** Minimum interval between samples for the same port (ms) */
const SAMPLE_INTERVAL_MS = 30_000;

/** Flapping threshold: if transitions / samples > this ratio, service is flapping */
const FLAPPING_THRESHOLD = 0.3;

/** Minimum samples needed before flapping detection kicks in */
const MIN_SAMPLES_FOR_FLAPPING = 10;

// ── IndexedDB schema ───────────────────────────────────────────────────────────

interface UptimeDB {
  samples: {
    key: string; // composite: `${port}:${ts}`
    value: UptimeSample & { portKey: string }; // portKey = `${port}` for index
    indexes: { 'by-port': string };
  };
}

let dbPromise: Promise<IDBPDatabase<UptimeDB>> | null = null;

function getDB(): Promise<IDBPDatabase<UptimeDB>> {
  if (!dbPromise) {
    dbPromise = openDB<UptimeDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore(STORE, { keyPath: 'portKey' });
        store.createIndex('by-port', 'port');
      },
    });
  }
  return dbPromise;
}

// Key format: port:timestamp
function sampleKey(port: number, ts: number): string {
  return `${port}:${ts}`;
}

// ── Write samples ──────────────────────────────────────────────────────────────

/**
 * Record liveness samples for a set of ports. Only writes if enough time
 * has elapsed since the last sample for each port.
 */
export async function recordSamples(
  portStatus: Record<number, boolean>,
  lastSampleTime: React.MutableRefObject<Record<number, number>>,
): Promise<void> {
  const now = Date.now();
  const portsToRecord = Object.entries(portStatus).filter(([portStr]) => {
    const port = Number(portStr);
    const last = lastSampleTime.current[port] ?? 0;
    return now - last >= SAMPLE_INTERVAL_MS;
  });

  if (portsToRecord.length === 0) return;

  const db = await getDB();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.store;

  for (const [portStr, up] of portsToRecord) {
    const port = Number(portStr);
    const sample: UptimeSample & { portKey: string } = {
      port,
      ts: now,
      up: up as boolean,
      portKey: sampleKey(port, now),
    };
    await store.put(sample);
    lastSampleTime.current[port] = now;
  }

  await tx.done;

  // Prune old samples beyond MAX_SAMPLES per port
  for (const [portStr] of portsToRecord) {
    await prunePort(Number(portStr));
  }
}

async function prunePort(port: number): Promise<void> {
  const db = await getDB();
  const all = await db.getAllFromIndex(STORE, 'by-port', IDBKeyRange.only(String(port)));
  if (all.length <= MAX_SAMPLES) return;

  // Sort by timestamp descending, keep only MAX_SAMPLES newest
  all.sort((a, b) => b.ts - a.ts);
  const toDelete = all.slice(MAX_SAMPLES);

  const tx = db.transaction(STORE, 'readwrite');
  for (const s of toDelete) {
    await tx.store.delete(s.portKey);
  }
  await tx.done;
}

// ── Read samples & compute stats ───────────────────────────────────────────────

/**
 * Get all samples for a port, sorted by timestamp ascending (oldest first).
 */
export async function getSamples(port: number): Promise<UptimeSample[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex(STORE, 'by-port', IDBKeyRange.only(String(port)));
  all.sort((a, b) => a.ts - b.ts);
  return all.map(({ port: _p, ts, up }) => ({ port: _p, ts, up }));
}

/**
 * Compute uptime stats from a set of samples.
 */
export function computeStats(samples: UptimeSample[]): UptimeStats {
  if (samples.length === 0) {
    return { uptimePct: 0, totalSamples: 0, upCount: 0, transitions: 0, isFlapping: false, samples: [] };
  }

  const upCount = samples.filter(s => s.up).length;
  const uptimePct = Math.round((upCount / samples.length) * 100);

  // Count transitions (state changes between consecutive samples)
  let transitions = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].up !== samples[i - 1].up) transitions++;
  }

  const isFlapping =
    samples.length >= MIN_SAMPLES_FOR_FLAPPING &&
    transitions / samples.length > FLAPPING_THRESHOLD;

  return {
    uptimePct,
    totalSamples: samples.length,
    upCount,
    transitions,
    isFlapping,
    samples,
  };
}

/**
 * Get stats for multiple ports at once.
 */
export async function getStatsForPorts(ports: number[]): Promise<Map<number, UptimeStats>> {
  const statsMap = new Map<number, UptimeStats>();
  await Promise.all(
    ports.map(async (port) => {
      const samples = await getSamples(port);
      statsMap.set(port, computeStats(samples));
    }),
  );
  return statsMap;
}

// ── React hook ─────────────────────────────────────────────────────────────────

/**
 * Hook that tracks uptime for monitored ports.
 *
 * - Records samples from portStatus on each poll (throttled to SAMPLE_INTERVAL_MS)
 * - Exposes per-port UptimeStats for sparkline rendering
 * - Re-computes stats whenever new samples are recorded
 */
export function useUptimeTracker(portStatus: Record<number, boolean>) {
  const [statsMap, setStatsMap] = useState<Map<number, UptimeStats>>(new Map());
  const lastSampleTime = useRef<Record<number, number>>({});
  const portStatusRef = useRef(portStatus);
  portStatusRef.current = portStatus;

  const ports = Object.keys(portStatus).map(Number);

  // Record samples whenever portStatus changes
  useEffect(() => {
    if (Object.keys(portStatus).length === 0) return;

    let cancelled = false;

    recordSamples(portStatus, lastSampleTime).then(() => {
      if (cancelled) return;
      // Refresh stats after recording
      getStatsForPorts(ports).then(map => {
        if (!cancelled) setStatsMap(map);
      });
    });

    return () => { cancelled = true; };
  }, [portStatus]);

  // Initial load of stats
  useEffect(() => {
    if (ports.length === 0) return;
    let cancelled = false;
    getStatsForPorts(ports).then(map => {
      if (!cancelled) setStatsMap(map);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ports.join(',')]);

  const getStats = useCallback(
    (port: number): UptimeStats | undefined => statsMap.get(port),
    [statsMap],
  );

  return { statsMap, getStats };
}
