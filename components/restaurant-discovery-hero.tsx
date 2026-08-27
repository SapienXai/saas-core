"use client"

import Link from "next/link"
import { Search } from "lucide-react"
import { useLanguage } from "@/context/language-context"
import {
  buildRestaurantDiscoveryHref,
  RESTAURANT_DISCOVERY_PRESETS,
  type RestaurantDiscoveryQuery,
} from "@/lib/restaurant-discovery"

type RestaurantDiscoveryHeroProps = {
  query: RestaurantDiscoveryQuery
}

export function RestaurantDiscoveryHero({ query }: RestaurantDiscoveryHeroProps) {
  const { getTranslation } = useLanguage()

  return (
    <section className="restaurant-discovery-hero" aria-labelledby="restaurant-discovery-title">
      <div className="marketing-container restaurant-discovery-hero-inner">
        <p className="marketing-eyebrow">{getTranslation("public.directory.eyebrow")}</p>
        <h1 id="restaurant-discovery-title">{getTranslation("public.directory.title")}</h1>
        <p className="restaurant-discovery-description">{getTranslation("public.directory.description")}</p>

        <form className="restaurant-discovery-search" action="/restaurants" method="get">
          <label className="sr-only" htmlFor="restaurant-discovery-search">
            {getTranslation("public.directory.searchPlaceholder")}
          </label>
          <div className="restaurant-discovery-search-field">
            <Search aria-hidden="true" />
            <input
              id="restaurant-discovery-search"
              name="q"
              type="search"
              defaultValue={query.q || ""}
              placeholder={getTranslation("public.directory.searchPlaceholder")}
              autoComplete="off"
            />
          </div>
          <button type="submit" className="restaurant-discovery-search-submit">
            {getTranslation("public.directory.searchAction")}
          </button>
        </form>

        <div className="restaurant-discovery-presets" aria-label={getTranslation("public.directory.presetsLabel")}>
          <span className="restaurant-discovery-presets-label">{getTranslation("public.directory.presetsLabel")}</span>
          <div className="restaurant-discovery-preset-scroll">
            {RESTAURANT_DISCOVERY_PRESETS.map((preset) => (
              <Link
                key={preset}
                href={buildRestaurantDiscoveryHref(query, { cuisine: query.cuisine === preset ? undefined : preset, page: 1 })}
                className={`restaurant-discovery-preset${query.cuisine === preset ? " is-active" : ""}`}
                aria-current={query.cuisine === preset ? "page" : undefined}
              >
                {preset}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
