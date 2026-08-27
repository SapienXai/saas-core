import type { TranslationKey } from "@/i18n"

/**
 * Stable feature keys owned by the Core plan catalog. Product plans may turn
 * these capabilities on or off without changing the billing UI.
 */
export const PLAN_FEATURE_LABELS: Record<string, TranslationKey> = {
  workspaceManagement: "manage.planUsage.featureWorkspaceManagement",
  emailNotifications: "manage.planUsage.featureEmailNotifications",
  removeBranding: "manage.planUsage.featureRemoveBranding",
  customDomain: "manage.planUsage.featureCustomDomain",
  basicAnalytics: "manage.planUsage.featureAnalytics",
  csvExport: "manage.planUsage.featureCsv",
  activityHistory: "manage.planUsage.featureActivityHistory",
  automatedNotifications: "manage.planUsage.featureAutomatedNotifications",
  advancedReports: "manage.planUsage.featureAdvancedReports",
  customPWA: "manage.planUsage.featureCustomPwa",
  pushNotifications: "manage.planUsage.featurePush",
  multiWorkspace: "manage.planUsage.featureMultiWorkspace",
}
