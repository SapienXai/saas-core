/** CSS-only feedback: works during SSR and without WebGL or hydration. */
export function TransitionLoader({ label = "Loading", overlay = false }: { label?: string; overlay?: boolean }) {
  return <div className={`core-transition-loader${overlay ? " core-transition-overlay" : ""}`} role="status" aria-live="polite" aria-atomic="true">
    <div className="core-transition-card">
      <span className="core-transition-spinner" aria-hidden="true" />
      <span className="core-transition-label">{label}</span>
    </div>
  </div>
}
