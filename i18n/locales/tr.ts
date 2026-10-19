import { en } from "@/i18n/locales/en"

type Localized<T> = T extends string ? string : T extends object ? { [K in keyof T]: Localized<T[K]> } : T

const turkishTranslations: Record<string, string> = {
  "Appearance": "Görünüm", "System": "Sistem", "Light": "Açık", "Dark": "Koyu",
  "Close": "Kapat", "Loading…": "Yükleniyor…", "Updating…": "Güncelleniyor…", "Next": "İleri", "Previous": "Önceki", "Language": "Dil",
  "Already have an account?": "Zaten hesabınız var mı?", "Back to sign in": "Girişe dön", "Check your inbox.": "Gelen kutunuzu kontrol edin.",
  "We’ve sent a verification link to": "Şu adrese doğrulama bağlantısı gönderdik:", "This link is invalid or expired.": "Bu bağlantı geçersiz veya süresi dolmuş.", "Request a new link to continue.": "Devam etmek için yeni bir bağlantı isteyin.",
  "Change email address": "E-posta adresini değiştir", "Didn’t receive the email?": "E-posta gelmedi mi?", "Open email app": "E-posta uygulamasını aç", "Email confirmed. Opening your workspace…": "E-posta doğrulandı. Çalışma alanınız açılıyor…", "Resend in {seconds}s": "{seconds} sn içinde yeniden gönder", "Waiting for confirmation…": "Doğrulama bekleniyor…", "or": "veya",
  "We can’t send confirmation emails right now. Please try again later.": "Şu anda onay e-postalarını gönderemiyoruz. Lütfen daha sonra tekrar deneyin.",
  "Create an account": "Hesap oluştur", "Email": "E-posta", "Forgot password?": "Şifrenizi mi unuttunuz?", "Password": "Şifre", "Sign in": "Giriş yap",
  "Create your account": "Hesabınızı oluşturun", "Create account": "Hesap oluştur", "Welcome back": "Tekrar hoş geldiniz", "Workspace": "Çalışma alanı",
  "Workspace management": "Çalışma alanı yönetimi", "Create workspace": "Çalışma alanı oluştur", "Current workspace": "Geçerli çalışma alanı",
  "Connected workspaces": "Bağlı çalışma alanları", "Team members": "Ekip üyeleri", "Workspaces": "Çalışma alanları", "Usage this period": "Bu dönemdeki kullanım",
  "Usage / period": "Kullanım / dönem", "Plan preview": "Plan önizlemesi", "Active plan": "Aktif plan", "Base plan": "Temel plan",
  "Notifications": "Bildirimler", "Enable notifications": "Bildirimleri etkinleştir", "Disable notifications": "Bildirimleri devre dışı bırak",
  "Management App": "Yönetim uygulaması", "Install App": "Uygulamayı yükle", "Save branding": "Marka ayarlarını kaydet",
  "Accept invitation": "Daveti kabul et", "Join {workspace}": "{workspace} alanına katıl", "Joining…": "Katılınıyor…", "workspace access": "çalışma alanı erişimi",
  "Billing details": "Fatura bilgileri", "Billing cycle": "Faturalandırma dönemi", "Monthly": "Aylık", "Annual": "Yıllık", "Change plan": "Planı değiştir", "Change billing cycle to {interval}?": "Faturalandırma dönemini {interval} olarak değiştir?", "Review the billing impact before confirming. Your plan and access stay in place.": "Onaylamadan önce faturalandırma etkisini inceleyin. Planınız ve erişiminiz korunur.", "Change the current billing cycle without changing your plan.": "Planınızı değiştirmeden mevcut faturalandırma dönemini değiştirin.", "Your current plan and access stay active until the end of this billing period. The selected billing cycle starts then.": "Mevcut planınız ve erişiminiz bu faturalandırma dönemi sonuna kadar aktif kalır. Seçilen faturalandırma dönemi bundan sonra başlar.", "Already scheduled": "Zaten zamanlandı", "Moving to Free will replace your scheduled change to {plan}.": "Ücretsiz plana geçiş, zamanlanmış {plan} değişikliğinin yerini alır.", "Billing cycle change": "Faturalandırma dönemi değişikliği", "Billing cycle change scheduled for {date}.": "Faturalandırma dönemi değişikliği {date} için planlandı.", "Your plan, features, and limits remain unchanged until the current period ends.": "Planınız, özellikleriniz ve limitleriniz mevcut dönem sonuna kadar değişmez.", "Price unavailable": "Fiyat kullanılamıyor", "Free": "Ücretsiz", "Free plan scheduled": "Ücretsiz plan zamanlandı", "Move to Free at period end": "Dönem sonunda ücretsiz plana geç", "Switch to {interval}": "{interval} faturalandırmaya geç",
  "Billing is not configured in this environment yet. The current workspace plan remains operational.": "Faturalandırma bu ortamda henüz ayarlanmadı. Mevcut çalışma alanı planı kullanılmaya devam eder.",
  "The {environment} price mapping is not configured for {plan}.": "{plan} için {environment} fiyat eşlemesi ayarlanmamış.",
  "Upgrade your plan": "Planınızı yükseltin", "Manage billing": "Faturalandırmayı yönet", "Payment method": "Ödeme yöntemi", "Invoices": "Faturalar",
  "Cancel": "İptal", "Start your {plan} plan?": "{plan} planını başlat?", "Review the amount due today and your recurring price before continuing to secure checkout.": "Güvenli ödemeye geçmeden önce bugün ödenecek tutarı ve yenileme fiyatını inceleyin.", "Due today": "Bugün ödenecek", "Recurring": "Yenileme", "Continue to secure checkout": "Güvenli ödemeye geç",
  "New recurring price": "Yeni yenileme fiyatı", "Effective date": "Geçerlilik tarihi", "Next billing date": "Sonraki faturalandırma tarihi", "Why are you leaving?": "Neden ayrılıyorsunuz?", "Optional feedback": "İsteğe bağlı geri bildirim",
  "Too expensive": "Çok pahalı", "Not using the workspace enough": "Çalışma alanını yeterince kullanmıyorum", "Seasonal or temporary pause": "Mevsimsel veya geçici ara", "Missing a feature": "Eksik bir özellik var", "Technical problems": "Teknik sorunlar", "Switching to another solution": "Başka bir çözüme geçiyorum", "Other": "Diğer",
}

function localize<T>(value: T): Localized<T> {
  if (typeof value === "string") return (turkishTranslations[value] ?? value) as Localized<T>
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, localize(child)])) as Localized<T>
  return value as Localized<T>
}

export const tr = localize(en)
