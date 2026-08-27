"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Plus, Trash2, Edit, GripVertical } from "lucide-react"
import { toast } from "@/hooks/use-toast"
import type { Restaurant } from "@/types/supabase"
import { useLanguage } from "@/context/language-context"
import type { TranslationKey } from "@/i18n"

export interface ReservationAreaFormData {
  id?: string
  clientId?: string
  name: string
  description: string
  is_active: boolean
  display_order: number
  opening_time: string
  closing_time: string
  time_slot_duration: number | null
  max_party_size: number | null
  min_party_size: number | null
  advance_booking_days: number | null
  min_advance_hours: number | null
  allowed_days_of_week: number[] | null
  blocked_dates: string[]
  max_concurrent_reservations: number | null
  useRestaurantDefaults: boolean
}

interface ReservationAreasFormProps {
  restaurant: Restaurant
  areas: ReservationAreaFormData[]
  onAreasChange: (areas: ReservationAreaFormData[]) => void
}

const defaultAreaNames = [
  "Main Dining",
  "Beach",
  "Deck",
  "Terrace",
  "Salon",
  "Garden",
  "Rooftop",
  "Private Room",
  "Bar Area",
  "Patio"
]

const dayNames: { value: number; key: TranslationKey }[] = [
  { value: 1, key: "reservationAreas.dayMonday" },
  { value: 2, key: "reservationAreas.dayTuesday" },
  { value: 3, key: "reservationAreas.dayWednesday" },
  { value: 4, key: "reservationAreas.dayThursday" },
  { value: 5, key: "reservationAreas.dayFriday" },
  { value: 6, key: "reservationAreas.daySaturday" },
  { value: 7, key: "reservationAreas.daySunday" },
]

export function ReservationAreasForm({ restaurant, areas, onAreasChange }: ReservationAreasFormProps) {
  const { getTranslation } = useLanguage()
  const [editingArea, setEditingArea] = useState<string | null>(null)

  const createNewArea = (): ReservationAreaFormData => ({
    clientId: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    description: "",
    is_active: true,
    display_order: areas.length,
    opening_time: restaurant.opening_time || "09:00",
    closing_time: restaurant.closing_time || "22:00",
    time_slot_duration: null,
    max_party_size: null,
    min_party_size: null,
    advance_booking_days: null,
    min_advance_hours: null,
    allowed_days_of_week: null,
    blocked_dates: [],
    max_concurrent_reservations: null,
    useRestaurantDefaults: true
  })

  const addArea = () => {
    const newArea = createNewArea()
    const updated = [...areas, newArea]
    onAreasChange(updated)
    setEditingArea(newArea.clientId!)
  }

  const removeArea = (index: number) => {
    const newAreas = areas.filter((_, i) => i !== index)
    onAreasChange(newAreas)
    setEditingArea(null)
    toast({
      title: getTranslation("reservationAreas.removed"),
      description: getTranslation("reservationAreas.removedDescription")
    })
  }

  const updateArea = (index: number, updates: Partial<ReservationAreaFormData>) => {
    const newAreas = areas.map((a, i) => (i === index ? { ...a, ...updates } : a))
    
    // If switching to use restaurant defaults, clear area-specific settings
    if (updates.useRestaurantDefaults) {
      newAreas[index] = {
        ...newAreas[index],
        time_slot_duration: null,
        max_party_size: null,
        min_party_size: null,
        advance_booking_days: null,
        min_advance_hours: null,
        allowed_days_of_week: null
      }
    }
    
    onAreasChange(newAreas)
  }

  const handleDayToggle = (areaIndex: number, day: number, checked: boolean) => {
    const area = areas[areaIndex]
    const currentDays = area.allowed_days_of_week || restaurant.allowed_days_of_week || [1, 2, 3, 4, 5, 6, 7]
    
    const newDays = checked
      ? [...currentDays, day].sort()
      : currentDays.filter(d => d !== day)
    
    updateArea(areaIndex, { allowed_days_of_week: newDays })
  }

  const getEffectiveValue = (areaValue: any, restaurantValue: any, defaultValue: any) => {
    return areaValue !== null ? areaValue : (restaurantValue || defaultValue)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{getTranslation("reservationAreas.title")}</h3>
          <p className="text-sm text-muted-foreground">
            {getTranslation("reservationAreas.description")}
          </p>
        </div>
        <Button type="button" onClick={addArea} size="sm">
          <Plus className="h-4 w-4 mr-2" />
          {getTranslation("reservationAreas.add")}
        </Button>
      </div>

      {areas.length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-muted-foreground">
              <p>{getTranslation("reservationAreas.empty")}</p>
              <p className="text-sm mt-1">{getTranslation("reservationAreas.emptyHint")}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {areas.map((area, index) => {
          const isEditing =
            editingArea === area.id || (!!area.clientId && editingArea === area.clientId) || editingArea === `new-${index}`
          const effectiveDays = area.allowed_days_of_week || restaurant.allowed_days_of_week || [1, 2, 3, 4, 5, 6, 7]
          
          return (
            <Card key={area.id || area.clientId || `new-${index}`} className={isEditing ? "border-primary" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <GripVertical className="h-4 w-4 text-muted-foreground cursor-move" />
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {area.name || getTranslation("reservationAreas.newArea")}
                        {!area.is_active && <Badge variant="secondary">{getTranslation("reservationAreas.inactive")}</Badge>}
                      </CardTitle>
                      {area.description && (
                        <p className="text-sm text-muted-foreground mt-1">{area.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingArea(isEditing ? null : (area.id || area.clientId || `new-${index}`))}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeArea(index)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              
              {isEditing && (
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor={`area-name-${index}`}>{getTranslation("reservationAreas.nameRequired")}</Label>
                      <Input
                        id={`area-name-${index}`}
                        value={area.name}
                        onChange={(e) => updateArea(index, { name: e.target.value })}
                        placeholder={getTranslation("reservationAreas.namePlaceholder")}
                        list={`area-names-${index}`}
                      />
                      <datalist id={`area-names-${index}`}>
                        {defaultAreaNames.map(name => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor={`area-description-${index}`}>{getTranslation("reservationAreas.descriptionLabel")}</Label>
                      <Textarea
                        id={`area-description-${index}`}
                        value={area.description}
                        onChange={(e) => updateArea(index, { description: e.target.value })}
                        placeholder={getTranslation("reservationAreas.descriptionPlaceholder")}
                        rows={2}
                      />
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id={`area-active-${index}`}
                      checked={area.is_active}
                      onCheckedChange={(checked) => updateArea(index, { is_active: checked })}
                    />
                    <Label htmlFor={`area-active-${index}`}>{getTranslation("reservationAreas.active")}</Label>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div className="flex items-center space-x-2">
                      <Switch
                        id={`use-defaults-${index}`}
                        checked={area.useRestaurantDefaults}
                        onCheckedChange={(checked) => updateArea(index, { useRestaurantDefaults: checked })}
                      />
                      <Label htmlFor={`use-defaults-${index}`}>{getTranslation("reservationAreas.useDefaults")}</Label>
                    </div>

                    {!area.useRestaurantDefaults && (
                      <div className="space-y-4 pl-6 border-l-2 border-muted">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor={`opening-time-${index}`}>{getTranslation("reservationAreas.openingTime")}</Label>
                            <Input
                              id={`opening-time-${index}`}
                              type="time"
                              value={area.opening_time}
                              onChange={(e) => updateArea(index, { opening_time: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`closing-time-${index}`}>{getTranslation("reservationAreas.closingTime")}</Label>
                            <Input
                              id={`closing-time-${index}`}
                              type="time"
                              value={area.closing_time}
                              onChange={(e) => updateArea(index, { closing_time: e.target.value })}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor={`slot-duration-${index}`}>{getTranslation("reservationAreas.timeSlot")}</Label>
                            <Input
                              id={`slot-duration-${index}`}
                              type="number"
                              min="15"
                              max="240"
                              step="15"
                              value={area.time_slot_duration || ""}
                              onChange={(e) => updateArea(index, { time_slot_duration: e.target.value ? parseInt(e.target.value) : null })}
                              placeholder={restaurant.time_slot_duration?.toString() || "30"}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`min-party-${index}`}>{getTranslation("reservationAreas.minParty")}</Label>
                            <Input
                              id={`min-party-${index}`}
                              type="number"
                              min="1"
                              value={area.min_party_size || ""}
                              onChange={(e) => updateArea(index, { min_party_size: e.target.value ? parseInt(e.target.value) : null })}
                              placeholder={restaurant.min_party_size?.toString() || "1"}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`max-party-${index}`}>{getTranslation("reservationAreas.maxParty")}</Label>
                            <Input
                              id={`max-party-${index}`}
                              type="number"
                              min="1"
                              value={area.max_party_size || ""}
                              onChange={(e) => updateArea(index, { max_party_size: e.target.value ? parseInt(e.target.value) : null })}
                              placeholder={restaurant.max_party_size?.toString() || "12"}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`max-concurrent-${index}`}>{getTranslation("reservationAreas.maxConcurrent")}</Label>
                            <Input
                              id={`max-concurrent-${index}`}
                              type="number"
                              min="1"
                              value={area.max_concurrent_reservations || ""}
                              onChange={(e) => updateArea(index, { max_concurrent_reservations: e.target.value ? parseInt(e.target.value) : null })}
                              placeholder={getTranslation("marketing.unlimited")}
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label>{getTranslation("reservationAreas.availableDays")}</Label>
                          <div className="flex flex-wrap gap-2">
                            {dayNames.map(({ value, key }) => (
                              <div key={value} className="flex items-center space-x-2">
                                <Checkbox
                                  id={`day-${index}-${value}`}
                                  checked={effectiveDays.includes(value)}
                                  onCheckedChange={(checked) => handleDayToggle(index, value, checked as boolean)}
                                />
                                <Label htmlFor={`day-${index}-${value}`} className="text-sm">{getTranslation(key)}</Label>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditingArea(null)
                        if (!area.id) {
                          // Remove unsaved new area
                          removeArea(index)
                        }
                      }}
                    >
                      {getTranslation("reservationAreas.cancel")}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        if (!area.name?.trim()) {
                          toast({
                            title: getTranslation("reservationAreas.error"),
                            description: getTranslation("reservationAreas.nameRequiredError"),
                            variant: "destructive"
                          })
                          return
                        }
                        setEditingArea(null)
                      }}
                    >
                      {getTranslation("reservationAreas.save")}
                    </Button>
                  </div>
                </CardContent>
              )}
              
              {!isEditing && (
                <CardContent className="pt-0">
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div className="flex justify-between">
                      <span>{getTranslation("reservationAreas.hours")}:</span>
                      <span>
                        {getEffectiveValue(area.opening_time, restaurant.opening_time, "09:00")} - 
                        {getEffectiveValue(area.closing_time, restaurant.closing_time, "22:00")}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>{getTranslation("reservationAreas.partySize")}:</span>
                      <span>
                        {getEffectiveValue(area.min_party_size, restaurant.min_party_size, 1)} - 
                        {getEffectiveValue(area.max_party_size, restaurant.max_party_size, 12)} {getTranslation("reservationAreas.people")}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>{getTranslation("reservationAreas.timeSlots")}:</span>
                      <span>{getEffectiveValue(area.time_slot_duration, restaurant.time_slot_duration, 30)} {getTranslation("reservationAreas.minutes")}</span>
                    </div>
                    {area.max_concurrent_reservations && (
                      <div className="flex justify-between">
                        <span>{getTranslation("reservationAreas.maxConcurrent")}:</span>
                        <span>{area.max_concurrent_reservations} {getTranslation("reservationAreas.reservations")}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
