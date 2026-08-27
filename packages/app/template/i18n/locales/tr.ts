import { en } from "@/i18n/locales/en"

type Localized<T> = T extends string ? string : T extends object ? { [K in keyof T]: Localized<T[K]> } : T

const turkishTranslations: Record<string, string> = {
  "Close": "Kapat", "Loading…": "Yükleniyor…", "Updating…": "Güncelleniyor…", "Next": "İleri", "Previous": "Önceki", "Language": "Dil",
  "Already have an account?": "Zaten hesabınız var mı?", "Back to sign in": "Girişe dön", "Check your inbox": "Gelen kutunuzu kontrol edin",
  "Create an account": "Hesap oluştur", "Email": "E-posta", "Forgot password?": "Şifrenizi mi unuttunuz?", "Password": "Şifre", "Sign in": "Giriş yap",
  "Create your account": "Hesabınızı oluşturun", "Create account": "Hesap oluştur", "Welcome back": "Tekrar hoş geldiniz", "Workspace": "Çalışma alanı",
  "Workspace management": "Çalışma alanı yönetimi", "Create workspace": "Çalışma alanı oluştur", "Current workspace": "Geçerli çalışma alanı",
  "Connected workspaces": "Bağlı çalışma alanları", "Team members": "Ekip üyeleri", "Workspaces": "Çalışma alanları", "Activity this period": "Bu dönemdeki aktivite",
  "Activity / period": "Aktivite / dönem", "Plan preview": "Plan önizlemesi", "Active plan": "Aktif plan", "Free plan": "Ücretsiz plan",
  "Notifications": "Bildirimler", "Enable notifications": "Bildirimleri etkinleştir", "Disable notifications": "Bildirimleri devre dışı bırak",
  "Management App": "Yönetim uygulaması", "Install App": "Uygulamayı yükle", "Save branding": "Marka ayarlarını kaydet",
  "Accept invitation": "Daveti kabul et", "Join {workspace}": "{workspace} alanına katıl", "Joining…": "Katılınıyor…", "workspace access": "çalışma alanı erişimi",
  "Billing details": "Fatura bilgileri", "Billing cycle": "Faturalandırma dönemi", "Monthly": "Aylık", "Annual": "Yıllık", "Change plan": "Planı değiştir",
  "Upgrade your plan": "Planınızı yükseltin", "Manage billing": "Faturalandırmayı yönet", "Payment method": "Ödeme yöntemi", "Invoices": "Faturalar",
}

function localize<T>(value: T): Localized<T> {
  if (typeof value === "string") return (turkishTranslations[value] ?? value) as Localized<T>
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, localize(child)])) as Localized<T>
  return value as Localized<T>
}

export const tr = localize(en)
