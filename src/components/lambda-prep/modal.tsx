"use client";

import type { ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

/**
 * Accessible modal shell built on the Radix Dialog primitives.
 *
 * The app already shipped the shadcn `Dialog` wrapper, but its styling is
 * Tailwind utility classes while every page here is styled from styles.css —
 * so both hand-rolled overlays ended up rolling their own semantics instead.
 * Radix supplies what the hand-rolled versions were missing: focus trapping,
 * focus restoration to the trigger, Escape dismissal, `aria-modal`, background
 * scroll lock and an inert rest-of-page. The visual layer stays in styles.css,
 * so moving onto it does not restyle anything.
 *
 * Content is rendered inside the overlay element (not beside it) because every
 * `.*-backdrop` rule in this project already centres its child with flexbox.
 */
export function ModalSurface({
  overlayClassName,
  className,
  describedBy,
  children,
  onPointerDownOutside,
}: {
  overlayClassName: string;
  className: string;
  /** id of the description element rendered inside, for screen readers. */
  describedBy?: string;
  children: ReactNode;
  onPointerDownOutside?: () => void;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClassName}>
        <DialogPrimitive.Content
          className={className}
          {...(describedBy ? { 'aria-describedby': describedBy } : {})}
          {...(onPointerDownOutside ? { onPointerDownOutside } : {})}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Overlay>
    </DialogPrimitive.Portal>
  );
}

export const ModalRoot = DialogPrimitive.Root;
export const ModalTrigger = DialogPrimitive.Trigger;
export const ModalClose = DialogPrimitive.Close;
/** Renders as <h2> unless `asChild` is used — Radix requires a title for the
 * dialog to be labelled, and warns on the console without one. */
export const ModalTitle = DialogPrimitive.Title;
export const ModalDescription = DialogPrimitive.Description;
