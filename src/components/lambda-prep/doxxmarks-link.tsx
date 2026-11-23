import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { doxxmarksUrl, type DoxxmarksEntry } from "@/lib/doxxmarks";
import { recordDoxxmarksClick } from "@/lib/outbound-tracking";

type DoxxmarksLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  /** Which entry point this is — becomes utm_medium and outbound_clicks.entry. */
  entry: DoxxmarksEntry;
  board?: string | null;
  classSlug?: string | null;
  subject?: string | null;
};

/**
 * The only way this site links to Doxxmarks. It always opens the destination
 * in a new tab, always carries `utm_source=lambda-prep` plus an entry-specific
 * `utm_medium`, and records the click for the admin analytics before the tab
 * takes over.
 */
export function DoxxmarksLink({
  entry,
  board,
  classSlug,
  subject,
  onClick,
  children,
  ...rest
}: DoxxmarksLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    recordDoxxmarksClick(entry, { board, classSlug, subject });
    onClick?.(event);
  }

  return (
    <a
      {...rest}
      href={doxxmarksUrl(entry, { board, classSlug, subject })}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
    >
      {children}
    </a>
  );
}
