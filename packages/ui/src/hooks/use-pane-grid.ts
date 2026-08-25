/**
 * use-pane-grid.ts — State for the three-pane layout (list/display/compose).
 *
 * Manages pane order, flex sizing, visibility and resize math, persisting
 * flex and visibility to localStorage so the layout survives a refresh.
 * Ported from PineCode's usePaneGrid via bermail.
 */

import { useCallback, useRef, useState } from 'react';

export interface PaneDef {
  id: string;
  flex: number;
  minFlex: number;
  visible: boolean;
}

const DEFAULT_PANES: Array<{ id: string; flex: number; minFlex: number }> = [
  { id: 'list', flex: 1.0, minFlex: 0.45 },
  { id: 'display', flex: 1.6, minFlex: 0.6 },
  { id: 'compose', flex: 1.2, minFlex: 0.5 },
];

const DEFAULT_VISIBILITY: Record<string, boolean> = {
  list: true,
  display: true,
  compose: false,
};

const FLEX_STORAGE_KEY = 'bmail_flex';
const VISIBILITY_STORAGE_KEY = 'bmail_panes';

// ─── localStorage helpers ──────────────────────────────

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* ignore */ }
}

// ─── Hook ──────────────────────────────────────────────

export function usePaneGrid() {
  // ── Flex sizing (persisted) ──
  const [flexMap, setFlexMap] = useState<Record<string, number>>(() => {
    const saved = loadJSON<Record<string, number> | null>(FLEX_STORAGE_KEY, null);
    if (saved && typeof saved === 'object') {
      for (const pane of DEFAULT_PANES) {
        if (saved[pane.id] == null) saved[pane.id] = pane.flex;
      }
      return saved;
    }

    const map: Record<string, number> = {};
    DEFAULT_PANES.forEach((pane) => { map[pane.id] = pane.flex; });
    return map;
  });

  // ── Visibility (persisted) ──
  const [visibility, setVisibility] = useState<Record<string, boolean>>(() => {
    const saved = loadJSON<Record<string, boolean> | null>(VISIBILITY_STORAGE_KEY, null);
    if (saved && typeof saved === 'object') {
      // Ensure all panes have a value
      for (const pane of DEFAULT_PANES) {
        if (saved[pane.id] == null) saved[pane.id] = DEFAULT_VISIBILITY[pane.id] ?? false;
      }
      return saved;
    }
    return { ...DEFAULT_VISIBILITY };
  });

  const draggingPane = useRef(false);

  const paneOrder = DEFAULT_PANES.map((pane) => pane.id);

  const panes: PaneDef[] = paneOrder.map((id) => {
    const def = DEFAULT_PANES.find((pane) => pane.id === id)!;
    return {
      id,
      flex: flexMap[id] ?? def.flex,
      minFlex: def.minFlex,
      visible: visibility[id] ?? false,
    };
  });

  const visiblePanes = panes.filter((pane) => pane.visible);

  // ── Resize between two adjacent panes ──
  const resize = useCallback((leftId: string, rightId: string, deltaPixels: number, containerWidth: number) => {
    setFlexMap((previous) => {
      const totalFlex = paneOrder.reduce((sum, id) => sum + (previous[id] ?? 1), 0);
      const pixelsPerFlex = containerWidth / totalFlex;
      const deltaFlex = deltaPixels / pixelsPerFlex;

      const leftDef = DEFAULT_PANES.find((pane) => pane.id === leftId) ?? { minFlex: 0.2 };
      const rightDef = DEFAULT_PANES.find((pane) => pane.id === rightId) ?? { minFlex: 0.2 };

      const newLeft = Math.max(leftDef.minFlex, (previous[leftId] ?? 1) + deltaFlex);
      const newRight = Math.max(rightDef.minFlex, (previous[rightId] ?? 1) - deltaFlex);

      const next = { ...previous, [leftId]: newLeft, [rightId]: newRight };
      saveJSON(FLEX_STORAGE_KEY, next);
      return next;
    });
  }, [paneOrder]);

  // ── Visibility actions (persisted) ──
  const togglePane = useCallback((id: string) => {
    setVisibility((previous) => {
      const next = { ...previous, [id]: !previous[id] };
      saveJSON(VISIBILITY_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const showPane = useCallback((id: string) => {
    setVisibility((previous) => {
      const next = { ...previous, [id]: true };
      saveJSON(VISIBILITY_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const hidePane = useCallback((id: string) => {
    setVisibility((previous) => {
      const next = { ...previous, [id]: false };
      saveJSON(VISIBILITY_STORAGE_KEY, next);
      return next;
    });
  }, []);

  /** Programmatically set a pane's flex value */
  const setFlex = useCallback((id: string, value: number) => {
    setFlexMap((previous) => {
      const next = { ...previous, [id]: value };
      saveJSON(FLEX_STORAGE_KEY, next);
      return next;
    });
  }, []);

  return {
    panes,
    visiblePanes,
    paneOrder,
    flexMap,
    draggingPane,
    resize,
    togglePane,
    showPane,
    hidePane,
    setFlex,
  };
}

export type PaneGridState = ReturnType<typeof usePaneGrid>;
