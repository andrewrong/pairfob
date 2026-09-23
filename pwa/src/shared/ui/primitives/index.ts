/**
 * Shared presentation and interaction primitives.
 *
 * Components own local presentation and interaction, never business state. None imports
 * application state, the paint loop, or a page model, and none of them looks up
 * `#app`. Localized copy is either passed in as a prop or resolved through
 * `lib/i18n`, which is a leaf copy table with no application dependency.
 */
export { Button } from "./button";
export { Spinner } from "./spinner";
export { Brand, StatusDot, StatusGlyph, StatusLine, type GlyphStatus, type StatusTone } from "./status";
export { Feedback, type FeedbackValue } from "./feedback";
export { EmptyState, type EmptyFigure, type EmptySpec } from "./empty-state";
export { BackBar, BackButton, Chevron, TopbarActions } from "./navigation";
export { GroupToggle, SectionTitle } from "./grouping";
export { HelpButton, SetHeading, SetNavRow, SetRow } from "./definition-row";
export { SegmentedControl, SegmentedOption } from "./segmented-control";
export { SelectionRow } from "./selection-row";
