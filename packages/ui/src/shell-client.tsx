"use client"

import { useEffect, useState } from "react"
import type { NavigationGroup, NavItem } from "./shell.js"
import { cn } from "./utils.js"

export function MobileNavigation({ productName, items, groups }: { productName: string; items: NavItem[]; groups?: NavigationGroup[] }) {
  const [open, setOpen] = useState(false)
  useEffect(() => { if (!open) return; const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false) }; document.addEventListener("keydown", close); return () => document.removeEventListener("keydown", close) }, [open])
  const render = (item: NavItem) => <a href={item.href} key={item.href} className={cn("sc-mobile-nav-item", item.active && "sc-nav-item-active")} aria-current={item.active ? "page" : undefined} onClick={() => setOpen(false)}><span aria-hidden="true">{item.icon ?? "•"}</span>{item.label}</a>
  return <><button type="button" className="sc-icon-button sc-menu-button" aria-label={`Open ${productName} navigation`} aria-expanded={open} aria-controls="sc-mobile-navigation" onClick={() => setOpen(true)}><span aria-hidden="true">☰</span></button>{open && <div className="sc-mobile-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}><aside id="sc-mobile-navigation" className="sc-mobile-drawer" role="dialog" aria-modal="true" aria-label={`${productName} navigation`}><div className="sc-mobile-drawer-header"><strong>{productName}</strong><button type="button" className="sc-icon-button" aria-label="Close navigation" onClick={() => setOpen(false)}>×</button></div><nav className="sc-mobile-nav" aria-label="Mobile application navigation">{groups?.length ? groups.flatMap((group) => [<span className="sc-nav-group-label" key={`${group.label}-label`}>{group.label}</span>, ...group.items.map(render)]) : items.map(render)}</nav></aside></div>}</>
}
