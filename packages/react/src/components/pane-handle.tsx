/**
 * pane-handle.tsx — Resize divider between two panes.
 *
 * A one-pixel line with an invisible wider hit area for dragging and a
 * hover indicator. Ported from PineCode's PaneHandle via bermail.
 */

import { usePaneResize } from '../hooks/use-pane-resize.js';

interface PaneHandleProps {
  direction?: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
}

export function PaneHandle({ direction = 'horizontal', onResize, onStart, onEnd }: PaneHandleProps) {
  const resize = usePaneResize({ direction, onResize, onStart, onEnd });
  const isHorizontal = direction === 'horizontal';

  return (
    <div
      className="relative shrink-0"
      style={{
        width: isHorizontal ? '1px' : '100%',
        height: isHorizontal ? '100%' : '1px',
        background: 'hsl(var(--border))',
      }}
    >
      {/* Invisible wider hit area */}
      <div
        {...resize.handleProps}
        className="absolute z-20 transition-colors"
        style={{
          ...(isHorizontal
            ? { top: 0, bottom: 0, left: '-4px', width: '9px' }
            : { left: 0, right: 0, top: '-4px', height: '9px' }),
          ...resize.handleProps.style,
        }}
      />
      {/* Visible hover indicator */}
      {isHorizontal && (
        <div
          className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-[3px] h-8 rounded-full opacity-0 hover:opacity-100 transition-opacity"
          style={{ background: 'hsl(var(--primary) / 0.3)', pointerEvents: 'none' }}
        />
      )}
    </div>
  );
}
