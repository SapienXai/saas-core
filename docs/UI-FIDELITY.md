# SaaS Core UI fidelity scorecard

SaaS Core 1.2 uses the ReserveVia implementation as a behavior and quality
reference. The result is a product-owned, provider-neutral package: no
ReserveVia routes, business entities, copy, database contracts or branding are
shipped in `@sapienx/saas-core-ui`.

This scorecard is the authoritative UI parity artifact. It evaluates API
shape, interaction behavior, accessibility, visual ownership and portability;
the older [inventory](UI-PARITY.md) remains useful as the source review log.

## Primitive scorecard

| ReserveVia reference | Core destination | API parity | Behavior parity | Accessibility parity | Visual parity | Status / boundary |
| --- | --- | --- | --- | --- | --- | --- |
| `components/ui/button.tsx` | `Button`, `buttonVariants` | High | High: variants, loading, `asChild` | High: focus, disabled, keyboard | High: semantic tokens | FULL — product may override tokens/classes |
| `components/ui/dialog.tsx` | `Dialog*` | High | Full: portal, focus trap, Escape, restore focus | Full: labelled title/description contract | High: overlay/content motion | FULL |
| `components/ui/alert-dialog.tsx` | `AlertDialog*` | High | Full: modal destructive confirmation | Full: Radix alert-dialog semantics | High | FULL |
| `components/ui/sheet.tsx` | `Sheet*` | High | Full: directional portal and dismissal | Full: dialog semantics and focus management | High: four directional variants | FULL |
| `components/ui/drawer.tsx` | `Drawer*` | High | Full: Vaul gesture-ready drawer | Full: labelled drawer contract | High | FULL |
| `components/ui/dropdown-menu.tsx` | `DropdownMenu*` | High | Full: keyboard roving focus, submenus, check/radio items | Full: menu roles and item state | High | FULL |
| `components/ui/select.tsx` | `Select*` | High | Full: keyboard selection, scroll viewport, portal | Full: combobox/listbox semantics | High | FULL — `NativeSelect` is an explicit progressive-enhancement helper |
| `components/ui/tooltip.tsx` | `Tooltip*` | High | Full: delayed portal tooltip and keyboard focus | High: non-essential hint only; essential content stays visible | High | FULL |
| `components/ui/popover.tsx` | `Popover*` | High | Full: anchor, portal, outside click, Escape | High: product supplies labelled content | High | FULL |
| `components/ui/tabs.tsx` | `Tabs*` | High | Full: roving focus and activation | Full: tablist/tab/tabpanel semantics | High | FULL |
| `components/ui/accordion.tsx` | `Accordion*` | High | Full: controlled disclosure and animation | Full: heading/button/content semantics | High | FULL |
| `components/ui/collapsible.tsx` | `Collapsible*` | High | Full: controlled disclosure | Full: trigger/content state | High | FULL |
| `components/ui/checkbox.tsx` | `Checkbox` | High | Full: controlled and indeterminate-ready | Full: checked state and label pairing | High | FULL |
| `components/ui/switch.tsx` | `Switch` | High | Full: controlled toggle | Full: switch role/state | High | FULL |
| `components/ui/radio-group.tsx` | `RadioGroup*` | High | Full: arrow-key group navigation | Full: radiogroup/radio semantics | High | FULL |
| `components/ui/slider.tsx` | `Slider` | High | Full: pointer and arrow-key adjustment | Full: value and label contract | High | FULL |
| `components/ui/toast.tsx` | `Toast*` | High | Full: queue, dismissal and live region | Full: Radix live-region semantics | High | FULL |
| `components/ui/sonner.tsx` | `Toaster`, `toast` | High | Full: app-level success/info/warning feedback | High: announced toast surface | High: light/dark theme sync | FULL |
| `components/ui/command.tsx` | `Command*` | High | Full: searchable keyboard command dialog | Full: cmdk dialog/list semantics | High | FULL |
| `components/ui/input-otp.tsx` | `InputOTP*` | High | Full: segmented entry, caret and disabled state | High: input-otp keyboard/paste contract | High | FULL — product supplies verification semantics |
| `components/ui/calendar.tsx` | `Calendar` | High | Full: month navigation and date selection | High: day-picker keyboard contract | High | FULL — no booking/domain rules |
| `components/ui/resizable.tsx` | `Resizable*` | High | Full: draggable panel handles | High: library handle semantics; product labels regions | High | FULL — persistence remains product-owned |
| `components/ui/carousel.tsx` | `Carousel*` | High | Full: Embla controls and keyboard shortcuts | High: labelled region/slides/controls | High | FULL — product chooses content and autoplay policy |
| `components/ui/context-menu.tsx` | `ContextMenu*` | High | Full: right-click/keyboard menu | Full: menu semantics | High | FULL |
| `components/ui/hover-card.tsx` | `HoverCard*` | High | Full: delayed hover/focus card | High: non-essential supplemental content | High | FULL |
| `components/ui/menubar.tsx` | `Menubar*` | High | Full: keyboard menu navigation | Full: menubar/menu semantics | High | FULL |
| `components/ui/navigation-menu.tsx` | `NavigationMenu*` | High | Full: responsive navigation disclosure | Full: navigation semantics | High | FULL |
| `components/ui/avatar.tsx`, `badge.tsx`, `card.tsx`, `progress.tsx`, `table.tsx` | Base slots | High | High | High | High | FULL |
| `components/ui/chart.tsx` | No chart engine export | Excluded | No misleading chart behavior | Product owns chart semantics | N/A | EXCLUDED — Core does not ship a metrics model or chart vendor |

## Composed surfaces

| ReserveVia source pattern | Core destination | Behavior and accessibility result | Ownership |
| --- | --- | --- | --- |
| `components/auth/reservevia-auth-shell.tsx` | `AuthShell` and generated auth routes | Same clear auth hierarchy, form labels, focus rings and server action boundary | Brand and copy remain product-owned |
| `components/manage/manage-shell.tsx` | `AppShell` / `AppShellClient` | Persistent desktop sidebar, collapsible state, mobile Sheet, safe navigation and account actions | Product supplies nav data and brand |
| `components/manage/manage-sidebar.tsx` | `Navigation`, `NavigationGroup` | Lucide icons, active state, badge state, disabled state and collapsed tooltips | Product owns grouping and routes |
| `components/manage/manage-header.tsx` | shell header, `ThemeToggle`, workspace switcher | Mobile-first header, theme preference and validated workspace form | Core owns shell mechanics; product owns identity |
| `components/onboarding/onboarding-shell.tsx` | generated `/onboarding` plus `DefaultSetupView` | Readiness is visible without claiming provider operation | Product owns onboarding domain steps |
| `components/setup/` and `components/platform/` | `DefaultSetupView`, `DefaultPlatformView` | Typed checks, warning/error states and separate operator boundary | Core provides neutral composition; product owns domain data |
| team/list/table patterns | `DefaultTeamView`, responsive table/card styles | Same information hierarchy across desktop table and mobile cards | Membership data and authorization remain server-owned |

## Non-negotiable boundaries

- `@sapienx/saas-core-ui` has no Supabase, Paddle, Resend, Vercel,
  repository, service-role or ReserveVia identity imports.
- Radix, Vaul, cmdk, input-otp, Embla, day-picker, resizable-panels, Sonner,
  CVA and Lucide are explicit UI dependencies; they are not hidden product
  adapters.
- `ThemeProvider` owns semantic tokens and system/light/dark preference.
  Portals inherit the same document token scope, and `Toaster` receives the
  resolved theme.
- The generated UI lab is at `/app/ui-lab`. It is product-owned and exists as
  a disposable proof surface for dialog, sheet, menu, select, popover,
  tooltip, tabs, accordion, form controls, command and toast behavior.
- `src/product/navigation.ts`, `src/styles/product.css`, theme JSON, product
  routes and product data remain replaceable. The CLI records their ownership
  in `.saas-core.json`; Core-managed runtime and migrations remain strict.

## Verification evidence

The release gate runs the source/unit suite, generated-app contract suite,
packed-artifact portability checks and the authenticated Chromium flow. The
browser flow exercises open/close and focus restoration for overlays, keyboard
and selection behavior, theme switching, toast/tooltip portals, mobile Sheet
navigation and 390px overflow. Fresh screenshots are stored under
`output/playwright/` when the browser gate is run locally.
