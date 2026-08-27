"use server"

import "server-only"
import { destroyScenario, SCENARIO_KEYS, seedScenario, type ScenarioKey, type ScenarioManifest } from "@/lib/dev/scenario-factory"

export type ScenarioPanelState = {
  success: boolean
  message: string
  manifest?: ScenarioManifest
}

const initialState: ScenarioPanelState = { success: false, message: "" }

function readScenarioKey(value: FormDataEntryValue | null): ScenarioKey {
  const key = String(value || "") as ScenarioKey
  if (!SCENARIO_KEYS.includes(key)) throw new Error("Unknown scenario.")
  return key
}

export async function seedScenarioAction(_previous: ScenarioPanelState = initialState, formData: FormData): Promise<ScenarioPanelState> {
  void _previous
  try {
    const manifest = await seedScenario(readScenarioKey(formData.get("scenario")))
    return { success: true, message: `Scenario ${manifest.key} hazırlandı.`, manifest }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function destroyScenarioAction(_previous: ScenarioPanelState = initialState, formData: FormData): Promise<ScenarioPanelState> {
  void _previous
  try {
    const manifest = JSON.parse(String(formData.get("manifest") || "null")) as ScenarioManifest | null
    if (!manifest) throw new Error("Scenario manifest bulunamadı.")
    await destroyScenario(manifest)
    return { success: true, message: `Scenario ${manifest.key} temizlendi.` }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) }
  }
}
