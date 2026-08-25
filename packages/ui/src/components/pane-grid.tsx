/**
 * pane-grid.tsx — Renders the pane layout driven by usePaneGrid.
 *
 * Flex-sized panes, drag handles between visible ones, and smooth
 * open/close animations. Ported from PineCode's PaneGrid via bermail.
 */

import { Fragment, useCallback, useRef } from 'react';

import type { PaneGridState } from '../hooks/use-pane-grid.js';
import { PaneHandle } from './pane-handle.js';

interface PaneGridProps {
  grid: PaneGridState;
  renderPane: (paneId: string) => React.ReactNode;
}

export function PaneGrid({ grid, renderPane }: PaneGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const onResizeStart = useCallback(() => {
    grid.draggingPane.current = true;
  }, [grid]);

  const onResizeEnd = useCallback(() => {
    setTimeout(() => { grid.draggingPane.current = false; }, 50);
  }, [grid]);

  const isDragging = grid.draggingPane.current;
  const visibleIds = grid.visiblePanes.map((pane) => pane.id);

  return (
    <div ref={containerRef} className="flex flex-1 min-w-0 min-h-0 h-screen">
      {grid.panes.map((pane) => {
        const visibleCount = grid.visiblePanes.length;

        // Flex sizing — hidden panes collapse to 0, single visible takes 100%
        const flex = !pane.visible
          ? '0 0 0px'
          : visibleCount === 1
            ? '1 1 0%'
            : `${pane.flex} 1 0%`;

        // Close animation
        const isClosing = !pane.visible;
        const transform = isClosing ? 'scale(0.97)' : 'scale(1)';
        const opacity = isClosing ? 0 : 1;

        // Animate unless actively dragging
        const transition = isDragging
          ? {}
          : {
              transition:
                'flex 0.25s cubic-bezier(0.4, 0, 0.2, 1), transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease-out',
            };

        // Handle between visible panes
        const visibleIdx = visibleIds.indexOf(pane.id);
        const showHandle = pane.visible && visibleIdx > 0;

        return (
          <Fragment key={pane.id}>
            {showHandle && (
              <PaneHandle
                direction="horizontal"
                onResize={(delta) => {
                  const width = containerRef.current?.getBoundingClientRect().width ?? 800;
                  const prevId = visibleIds[visibleIdx - 1];
                  grid.resize(prevId, pane.id, delta, width);
                }}
                onStart={onResizeStart}
                onEnd={onResizeEnd}
              />
            )}

            <div
              data-pane-id={pane.id}
              className="min-w-0 min-h-0 flex flex-col"
              style={{
                flex,
                overflow: 'hidden',
                position: 'relative',
                transform,
                opacity,
                ...transition,
                ...(isClosing ? { pointerEvents: 'none' as const } : {}),
                ...(pane.id === 'list' && pane.visible ? { minWidth: '335px' } : {}),
              }}
            >
              {renderPane(pane.id)}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
