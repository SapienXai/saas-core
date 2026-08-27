import { resolveLanguage, type SupportedLanguage } from "@/i18n/config"
import type { LocaleMessages, TranslationReplacements } from "@/i18n/types"

const emailEn = {
  common: {
    ctaFallback: "If the button does not work, use this link:",
    footer: "Workspace notifications",
  },
  invitation: {
    subject: "You've been invited to join {workspace}",
    preheader: "Join {workspace} with your team.",
    eyebrow: "Team invitation",
    title: "You're invited to join your team",
    intro: "{inviter} invited you to join <strong>{workspace}</strong>.",
    role: "Role",
    access: "Workspace access",
    noticeTitle: "A secure invitation",
    notice: "This link is personal to <strong>{email}</strong> and expires on <strong>{expires}</strong>.",
    cta: "Accept invitation",
    footer: "If you were not expecting this invitation, you can safely ignore this email. No account changes happen unless you use the button above.",
    text: "{inviterPlain} invited you to join {workspacePlain}.\n\nRole: {role}\nAccess: {access}\n\nAccept invitation: {url}\n\nThis invitation expires on {expires}. If you were not expecting it, you can safely ignore this email.",
  },
} as const

const emailTr = {
  common: {
    ctaFallback: "Düğme çalışmıyorsa bu bağlantıyı kullanın:",
    footer: "Çalışma alanı bildirimleri",
  },
  invitation: {
    subject: "{workspace} çalışma alanına katılmaya davet edildiniz",
    preheader: "Ekibinizle {workspace} çalışma alanına katılın.",
    eyebrow: "Ekip daveti",
    title: "Ekibinize katılmaya davet edildiniz",
    intro: "{inviter}, sizi <strong>{workspace}</strong> çalışma alanına davet etti.",
    role: "Rol",
    access: "Çalışma alanı erişimi",
    noticeTitle: "Güvenli davet",
    notice: "Bu bağlantı <strong>{email}</strong> adresine özeldir ve <strong>{expires}</strong> tarihinde sona erer.",
    cta: "Daveti kabul et",
    footer: "Bu daveti beklemiyorsanız e-postayı güvenle yok sayabilirsiniz. Yukarıdaki düğmeyi kullanmadığınız sürece hesabınızda değişiklik yapılmaz.",
    text: "{inviterPlain}, sizi {workspacePlain} çalışma alanına davet etti.\n\nRol: {role}\nErişim: {access}\n\nDaveti kabul et: {url}\n\nBu davet {expires} tarihinde sona erer. Bu daveti beklemiyorsanız e-postayı güvenle yok sayabilirsiniz.",
  },
} as const satisfies LocaleMessages<typeof emailEn>

const emailEs = {
  common: {
    ctaFallback: "Si el botón no funciona, utiliza este enlace:",
    footer: "Notificaciones del espacio de trabajo",
  },
  invitation: {
    subject: "Te han invitado a unirte a {workspace}",
    preheader: "Únete a {workspace} con tu equipo.",
    eyebrow: "Invitación al equipo",
    title: "Te han invitado a unirte a tu equipo",
    intro: "{inviter} te ha invitado a unirte a <strong>{workspace}</strong>.",
    role: "Rol",
    access: "Acceso al espacio de trabajo",
    noticeTitle: "Una invitación segura",
    notice: "Este enlace es personal para <strong>{email}</strong> y caduca el <strong>{expires}</strong>.",
    cta: "Aceptar invitación",
    footer: "Si no esperabas esta invitación, puedes ignorar este email. No se realizarán cambios en tu cuenta salvo que uses el botón anterior.",
    text: "{inviterPlain} te ha invitado a unirte a {workspacePlain}.\n\nRol: {role}\nAcceso: {access}\n\nAceptar invitación: {url}\n\nEsta invitación caduca el {expires}. Si no la esperabas, puedes ignorar este email.",
  },
} as const satisfies LocaleMessages<typeof emailEn>

export const emailMessages = { en: emailEn, tr: emailTr, es: emailEs } as const satisfies Record<SupportedLanguage, LocaleMessages<typeof emailEn>>

export type EmailMessages = typeof emailEn

export function getEmailMessages(language: string | null | undefined): EmailMessages {
  return emailMessages[resolveLanguage(language)] as EmailMessages
}

export function interpolateEmail(template: string, replacements: TranslationReplacements) {
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return Object.entries(replacements).reduce(
    (result, [placeholder, value]) => result.replace(new RegExp(`{${escapeRegExp(placeholder)}}`, "g"), String(value)),
    template,
  )
}
