import { getLocaleConfig, resolveLanguage, type SupportedLanguage } from "@/i18n/config"

type PrivacyMessages = {
  title: string
  introduction: string
  dataControllerLabel: string
  contactLabel: string
  retentionPeriod: string
  recipients: readonly string[]
  sections: readonly { heading: string; paragraphs?: readonly string[]; items?: readonly string[] }[]
  rightsParagraph: string
  rightsRequest: string
  closeLabel: string
}

const privacyEn: PrivacyMessages = {
  title: "Privacy Notice",
  introduction: "{controller} processes your personal data while providing the workspace service in {country}, as described below.",
  dataControllerLabel: "Organization",
  contactLabel: "Contact",
  retentionPeriod: "Workspace and communication records are retained for the applicable retention periods, then deleted, destroyed, or anonymized.",
  recipients: ["Authorized workspace members and service operators", "Infrastructure and communication providers", "Authorized public institutions where legally required"],
  sections: [
    { heading: "Information collected", items: ["Account and contact details", "Workspace membership and configuration", "Security, usage, and communication records"] },
    { heading: "How we use it", items: ["Creating and securing accounts and workspaces", "Managing membership, access, and notifications", "Operating, supporting, and improving the service", "Meeting applicable legal obligations"] },
    { heading: "Processing basis", paragraphs: ["Data is processed on the legal basis applicable to providing the workspace service, communicating with users, meeting applicable obligations, and supporting legitimate operational needs."] },
    { heading: "Potential recipients" },
    { heading: "Retention period" },
    { heading: "Your rights" },
  ],
  rightsParagraph: "You may request information about your personal data, correction of incomplete or inaccurate data, deletion where applicable, and exercise other rights available under applicable privacy laws.",
  rightsRequest: "Requests can be sent by email to {email}.",
  closeLabel: "Close notice",
}

const privacyTr: PrivacyMessages = {
  title: "Gizlilik Bildirimi",
  introduction: "{controller}, {country} içinde çalışma alanı hizmetini sunarken kişisel verilerinizi aşağıdaki amaçlarla işler.",
  dataControllerLabel: "Kuruluş",
  contactLabel: "İletişim",
  retentionPeriod: "Çalışma alanı ve iletişim kayıtları ilgili saklama süreleri boyunca tutulur; süre sonunda silinir, yok edilir veya anonimleştirilir.",
  recipients: ["Yetkili çalışma alanı üyeleri ve hizmet yöneticileri", "Altyapı ve iletişim hizmeti sağlayıcıları", "Kanunen gerekli olduğunda yetkili kamu kurumları"],
  sections: [
    { heading: "Toplanan bilgiler", items: ["Hesap ve iletişim bilgileri", "Çalışma alanı üyeliği ve yapılandırması", "Güvenlik, kullanım ve iletişim kayıtları"] },
    { heading: "Kullanım amaçları", items: ["Hesap ve çalışma alanlarını oluşturmak ve güvenliğini sağlamak", "Üyelik, erişim ve bildirimleri yönetmek", "Hizmeti işletmek, desteklemek ve geliştirmek", "Uygulanabilir yasal yükümlülükleri yerine getirmek"] },
    { heading: "İşleme dayanağı", paragraphs: ["Veriler, çalışma alanı hizmetinin sunulması, kullanıcılarla iletişim kurulması, uygulanabilir yükümlülüklerin yerine getirilmesi ve kuruluşun meşru operasyonel ihtiyaçları için geçerli hukuki dayanaklara göre işlenir."] },
    { heading: "Paylaşılabilecek taraflar" },
    { heading: "Saklama süresi" },
    { heading: "Haklarınız" },
  ],
  rightsParagraph: "Kişisel verileriniz hakkında bilgi talep edebilir, eksik veya yanlış verilerin düzeltilmesini, şartları oluştuğunda silinmesini isteyebilir ve uygulanabilir mevzuat kapsamındaki diğer haklarınızı kullanabilirsiniz.",
  rightsRequest: "Taleplerinizi {email} adresine e-posta göndererek iletebilirsiniz.",
  closeLabel: "Bildirimi kapat",
}

const privacyEs: PrivacyMessages = {
  title: "Aviso de privacidad",
  introduction: "{controller} trata tus datos personales al prestar el servicio de espacios de trabajo en {country}, como se describe a continuación.",
  dataControllerLabel: "Organización",
  contactLabel: "Contacto",
  retentionPeriod: "Los registros del espacio de trabajo y de comunicaciones se conservan durante los plazos aplicables; después se eliminan, destruyen o anonimizan.",
  recipients: ["Miembros autorizados y operadores del servicio", "Proveedores de infraestructura y comunicaciones", "Instituciones públicas autorizadas cuando la ley lo exige"],
  sections: [
    { heading: "Información recopilada", items: ["Datos de cuenta y contacto", "Membresía y configuración del espacio de trabajo", "Registros de seguridad, uso y comunicaciones"] },
    { heading: "Cómo la utilizamos", items: ["Crear y proteger cuentas y espacios de trabajo", "Gestionar membresía, acceso y notificaciones", "Operar, prestar soporte y mejorar el servicio", "Cumplir las obligaciones legales aplicables"] },
    { heading: "Base del tratamiento", paragraphs: ["Los datos se tratan sobre la base jurídica aplicable a la prestación del servicio de espacios de trabajo, las comunicaciones, el cumplimiento de obligaciones y las necesidades operativas legítimas."] },
    { heading: "Posibles destinatarios" },
    { heading: "Plazo de conservación" },
    { heading: "Tus derechos" },
  ],
  rightsParagraph: "Puedes solicitar información sobre tus datos personales, la corrección de datos incompletos o inexactos, su eliminación cuando corresponda y ejercer los demás derechos previstos por la normativa aplicable.",
  rightsRequest: "Puedes enviar tus solicitudes por correo electrónico a {email}.",
  closeLabel: "Cerrar aviso",
}

export const privacyMessages: Record<SupportedLanguage, PrivacyMessages> = { en: privacyEn, tr: privacyTr, es: privacyEs }

export function getPrivacyMessages(language: string | null | undefined) {
  const resolvedLanguage = resolveLanguage(language)
  return { language: resolvedLanguage, locale: getLocaleConfig(resolvedLanguage).intl, messages: privacyMessages[resolvedLanguage] }
}
