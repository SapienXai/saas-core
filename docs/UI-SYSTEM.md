# UI system

The default UI is inherited from the production ReserveVia management and
auth surfaces. The source of truth is the implementation in this repository,
not a screenshot or a new design language. The extraction removes product
content while retaining the interaction language.

## Primitives

`components/ui` contains the source-derived Radix and shadcn-style building
blocks: buttons, inputs, labels, forms, selects, checkboxes, switches, radio
groups, sliders, textareas, cards, tables, pagination, progress, skeletons,
tabs, accordions, collapsibles, scroll areas, resizable panels, calendars,
carousels, command menus, tooltips, hover cards, dropdown/context menus,
dialogs, alert dialogs, sheets, drawers, toasts, and Sonner integration.

The same primitive source is published from `@sapienx/saas-core-ui` with
declarations and stable subpath exports such as `/button`, `/dialog`,
`/shell`, and `/theme`. The integrated management shell stays in the app
template because it adapts server-backed Workspace context, navigation, auth,
and PWA data; moving that adapter would require changing its source contract.
That boundary does not alter its source-derived behavior.

Use these primitives as composed. They carry keyboard semantics, focus
restoration, portal behavior, data-state transitions, and disabled/loading
states that are easy to lose in a visual rewrite.

## Action feedback

An async action has a visible lifecycle:

```text
idle → pressed/pending → disabled + progress → success or error feedback
```

Buttons retain their dimensions while pending. Forms report field and server
errors close to the source control, then use a toast for an operation-level
result. Successful mutations refresh the affected surface without hiding the
confirmation. Failed mutations preserve user input and explain the next
action.

## Navigation and shell

The shell is full-height with one main scroll owner. The sidebar has expanded,
collapsed icon-rail, and mobile Sheet modes. Collapse persists locally;
collapsed icons keep accessible labels and tooltips. The header owns workspace
switching, account controls, notification entry, online state, and install
prompt behavior. Navigation active states and pending transitions remain
visible during route changes.

Do not add document-level scrolling to a management page. Tables and dense
data surfaces own horizontal scrolling on narrow screens, while the page keeps
safe-area padding and prevents accidental right-edge overflow.

## Overlays

Dialogs, sheets, drawers, popovers, dropdowns, select menus, command menus,
and tooltips are Radix-backed. They dismiss with Escape and outside interaction
where appropriate, trap focus when modal, restore focus to the trigger, lock
document scrolling when needed, and render through portals. Portal surfaces
follow the management or platform theme even though they render outside the
shell DOM subtree.

## Motion and preference

Motion communicates state: sidebar transitions, sheet movement, accordion
expansion, press feedback, loading indicators, and success arrival. It stays
subtle on routine actions. `prefers-reduced-motion: reduce` disables decorative
motion and shortens transitions while preserving state changes and feedback.

## Responsive behavior

Desktop uses the fixed sidebar and header composition. Tablet preserves the
content hierarchy without compressing controls below usable sizes. Mobile
switches to the Sheet navigation, keeps touch targets stable, respects
`env(safe-area-inset-*)`, and makes table/list transformations explicit.
Validate at 390px as well as desktop widths: inspect geometry, overflow,
focus, menu bounds, and scroll ownership—not just a successful HTTP response.

## Theme and accessibility

Theme preference persists for the management and platform surfaces. Light and
dark tokens cover cards, forms, tables, notifications, dialogs, popovers, and
select menus. Every icon-only control needs an accessible name; focus-visible
outlines remain visible; disabled and loading controls communicate state
without depending on color alone.

Future products may change palette, logo, and copy through product config and
product CSS. They should preserve this behavior contract and extend the
source-derived components instead of rebuilding them.
