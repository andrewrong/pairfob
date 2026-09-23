import { createContext, useContext, type ReactNode } from "react";

/**
 * In-sheet navigation. A follow-up step (a form, a sub-menu, a live panel)
 * pushes a page into the open sheet instead of closing it and presenting a new
 * dialog, so the context, height and focus stay with one surface and Back
 * returns to where the reader came from.
 */
export type SheetPage = {
  /** Stable identity: re-pushing the same key replaces nothing, it stacks. */
  key: string;
  title: string;
  render: () => ReactNode;
};

export type SheetNav = {
  push(page: SheetPage): void;
  pop(): void;
  /** 1 at the root page. */
  depth: number;
};

export const SheetNavContext = createContext<SheetNav | null>(null);

/** The enclosing sheet's navigation; null outside a stacked sheet. */
export function useSheetNav(): SheetNav | null {
  return useContext(SheetNavContext);
}
