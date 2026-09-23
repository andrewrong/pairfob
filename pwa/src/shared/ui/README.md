# Shared UI

Keep presentation and local interaction here; pass business state and actions in
from features. Shared UI must not import pages, domain stores or protocol clients.
The architecture tests enforce that dependency direction.

Use these existing modules before adding another visually equivalent control:

- `primitives/segmented-control`: `SegmentedControl` and `SegmentedOption` own
  radio semantics, selection classes, one tab stop, arrow/Home/End navigation
  and disabled-item skipping. Business callbacks still own selection changes.
  Use `activation="manual"` when choosing an option closes a menu or triggers
  another screen. Terminal options may use `as={PadChromeButton}` to retain
  native pointer/focus protection. Native radio inputs (such as attachment
  compression choices) already have browser keyboard behavior; keep them native.
- `primitives/navigation`: `BackBar` for titled navigation, `TopbarActions` for
  trailing page actions. The action group keeps intrinsic button widths, right
  alignment and wrapping. Its styles belong to shared navigation, not a feature.
- `primitives/selection-row`: `SelectionRow` for a selectable title/description
  row, with optional leading content and a status badge. Keep a separate delete
  or forget action outside the row button; never nest interactive elements.
- `overlay/dialog-lifecycle`: native opening, cancel/backdrop guards, closing,
  optional sheet drag and cleanup. `ModalFrame` and `SheetFrame` use it for
  promise-based dialogs; controlled portals can use the same hook directly.
  `presentModal` owns promise settlement and focus restoration for its dialogs.
  Controlled portals opt into `restoreFocus`; do not give both layers ownership.
- `overlay/sheet-content`: the shared sheet handle, heading, close target and
  scrollable body. Keep forms and validation in their owning feature.

Reuse `Button`, `EmptyState`, `StatusLine`, setting rows and menu primitives as
appropriate. `Button` deliberately retains native props and only defaults the
button type; it does not own business loading or mutation state. Specialized
terminal keys, board tabs and the camera scanner retain their own interactions.

## Visual language

Every screen draws from the same few rules; the values live as tokens in
`styles/tokens.scss`.

- **Agent status** is the `StatusGlyph` (ring = working, diamond = needs you,
  check = turn finished, hollow circle = idle, dashed = unknown). Colour sits on
  the glyph only (`--status-*`); the words beside it stay neutral. Coloured
  pills are for non-agent states such as a computer being online.
- **Object lists** (sessions, files, changes, computers, the switcher) are
  hairline rows (`--hairline`, `--row-min`). **Settings and forms** are grouped
  cards (`--group-bg`, `--group-radius`).
- **Sheets and menus**: consecutive `MenuItem`s form one card; a section title
  starts a new card; danger items form their own card after the rest; the
  plain cancel stands apart.
- **Controls**: every tappable target is at least 44px (`--h-control`,
  `--icon-hit`); form primaries are `--h-primary`; `--h-inline` is only the
  drawn shape of a chip inside its 44px target. One accent-filled primary per
  screen; danger is red text on a quiet fill.
- **Top bars**: full-screen chromes and settings-family pages share a 52px bar
  on `--bg` with a hairline below and a subhead-weight title.
