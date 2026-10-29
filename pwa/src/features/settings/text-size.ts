import { preferencesStore, setTextSize, type TextSize } from "./preferences-store";

export { TEXT_SIZES } from "./preferences-store";

/**
 * 文字大小: the root font-size of `<html>`, which every rem token scales with.
 * An unchosen size follows the viewport: 标准 on a phone, 大 from 768px up.
 */
export const TEXT_SIZE_PX: Record<TextSize, number> = { small: 14, standard: 16, large: 18, xlarge: 20 };

export const TEXT_SIZE_WIDE_MIN_WIDTH = 768;

export function effectiveTextSize(chosen: TextSize | null, viewportWidth: number): TextSize {
  if (chosen) return chosen;
  return viewportWidth >= TEXT_SIZE_WIDE_MIN_WIDTH ? "large" : "standard";
}

/** Write the effective size onto `<html>`. */
export function applyTextSize(): void {
  const size = effectiveTextSize(preferencesStore.get().textSize, window.innerWidth);
  document.documentElement.style.fontSize = `${TEXT_SIZE_PX[size]}px`;
}

export function chooseTextSize(size: TextSize): void {
  setTextSize(size);
  applyTextSize();
}
