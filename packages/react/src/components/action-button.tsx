/**
 * action-button.tsx — Icon button with a tooltip, used across toolbars.
 */

import type { LucideIcon } from 'lucide-react';

import { Button } from '../primitives/button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip.js';

interface ActionButtonProps {
  icon: LucideIcon;
  label: string;
  variant?: 'destructive';
  onClick?: () => void;
}

export function ActionButton({ icon: Icon, label, variant, onClick }: ActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={'h-7 w-7 ' + (variant === 'destructive' ? 'hover:text-destructive' : '')}
          onClick={onClick}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">{label}</TooltipContent>
    </Tooltip>
  );
}
