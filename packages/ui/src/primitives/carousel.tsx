"use client"

import * as React from "react"
import useEmblaCarousel, { type UseEmblaCarouselType } from "embla-carousel-react"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { cn } from "../utils.js"
import { Button, type ButtonProps } from "./base.js"

type CarouselApi = UseEmblaCarouselType[1]
type CarouselProps = { opts?: Parameters<typeof useEmblaCarousel>[0]; plugins?: Parameters<typeof useEmblaCarousel>[1]; orientation?: "horizontal" | "vertical"; setApi?: (api: CarouselApi) => void }
type CarouselContextValue = { carouselRef: ReturnType<typeof useEmblaCarousel>[0]; api: CarouselApi; opts: CarouselProps["opts"]; plugins: CarouselProps["plugins"]; orientation: CarouselProps["orientation"]; setApi: CarouselProps["setApi"]; scrollPrev: () => void; scrollNext: () => void; canScrollPrev: boolean; canScrollNext: boolean }
const CarouselContext = React.createContext<CarouselContextValue | null>(null)
function useCarousel() { const context = React.useContext(CarouselContext); if (!context) throw new Error("useCarousel must be used within a <Carousel />"); return context }
const Carousel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & CarouselProps>(({ orientation = "horizontal", opts, plugins, setApi, className, children, ...props }, ref) => {
  const [carouselRef, api] = useEmblaCarousel({ ...opts, axis: orientation === "horizontal" ? "x" : "y" }, plugins)
  const [canScrollPrev, setCanScrollPrev] = React.useState(false)
  const [canScrollNext, setCanScrollNext] = React.useState(false)
  const onSelect = React.useCallback((nextApi: CarouselApi) => { if (!nextApi) return; setCanScrollPrev(nextApi.canScrollPrev()); setCanScrollNext(nextApi.canScrollNext()) }, [])
  const scrollPrev = React.useCallback(() => api?.scrollPrev(), [api])
  const scrollNext = React.useCallback(() => api?.scrollNext(), [api])
  React.useEffect(() => { if (!api) return; setApi?.(api); onSelect(api); api.on("reInit", onSelect); api.on("select", onSelect); return () => { api.off("reInit", onSelect); api.off("select", onSelect) } }, [api, onSelect, setApi])
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => { if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); scrollPrev() } if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); scrollNext() } }
  return <CarouselContext.Provider value={{ carouselRef, api, opts, plugins, orientation, scrollPrev, scrollNext, canScrollPrev, canScrollNext, setApi }}><div ref={ref} role="region" aria-roledescription="carousel" tabIndex={0} onKeyDown={onKeyDown} className={cn("sc-carousel", className)} {...props}>{children}</div></CarouselContext.Provider>
})
Carousel.displayName = "Carousel"
const CarouselContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => { const { carouselRef, orientation } = useCarousel(); return <div ref={carouselRef} className="sc-carousel-viewport"><div ref={ref} className={cn("sc-carousel-track", orientation === "vertical" && "sc-carousel-track-vertical", className)} {...props} /></div> })
CarouselContent.displayName = "CarouselContent"
const CarouselItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => <div ref={ref} role="group" aria-roledescription="slide" className={cn("sc-carousel-item", className)} {...props} />)
CarouselItem.displayName = "CarouselItem"
const CarouselPrevious = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = "outline", size = "icon", ...props }, ref) => { const { orientation, scrollPrev, canScrollPrev } = useCarousel(); return <Button ref={ref} variant={variant} size={size} aria-label="Previous slide" className={cn("sc-carousel-control", orientation === "horizontal" ? "sc-carousel-prev" : "sc-carousel-prev-vertical", className)} disabled={!canScrollPrev} onClick={scrollPrev} {...props}><ArrowLeft aria-hidden="true" /><span className="sc-sr-only">Previous slide</span></Button> })
CarouselPrevious.displayName = "CarouselPrevious"
const CarouselNext = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = "outline", size = "icon", ...props }, ref) => { const { orientation, scrollNext, canScrollNext } = useCarousel(); return <Button ref={ref} variant={variant} size={size} aria-label="Next slide" className={cn("sc-carousel-control", orientation === "horizontal" ? "sc-carousel-next" : "sc-carousel-next-vertical", className)} disabled={!canScrollNext} onClick={scrollNext} {...props}><ArrowRight aria-hidden="true" /><span className="sc-sr-only">Next slide</span></Button> })
CarouselNext.displayName = "CarouselNext"
export { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext, useCarousel }
export type { CarouselApi, CarouselProps }
