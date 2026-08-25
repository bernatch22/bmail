/**
 * use-pane-resize.ts — Pointer-based resize behavior for a pane handle.
 *
 * Emits pixel deltas while dragging and manages the col/row-resize cursor.
 * Ported from PineCode's usePaneResize via bermail.
 */

import { useCallback, useRef, useState } from 'react';

interface UsePaneResizeOptions {
  direction?: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
}

export function usePaneResize({ direction = 'horizontal', onResize, onStart, onEnd }: UsePaneResizeOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const startPos = useRef(0);
  const isHorizontal = direction === 'horizontal';

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);

    startPos.current = isHorizontal ? event.clientX : event.clientY;
    setIsDragging(true);
    document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    onStart?.();

    const onMove = (moveEvent: PointerEvent) => {
      const current = isHorizontal ? moveEvent.clientX : moveEvent.clientY;
      const delta = current - startPos.current;
      startPos.current = current;
      onResize(delta);
    };

    const onUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      onEnd?.();
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [isHorizontal, onResize, onStart, onEnd]);

  return {
    handleProps: {
      onPointerDown,
      style: { cursor: isHorizontal ? 'col-resize' : 'row-resize', touchAction: 'none' as const },
    },
    isDragging,
  };
}
