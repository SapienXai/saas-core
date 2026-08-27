import { getLocaleConfig, resolveLanguage, type SupportedLanguage } from "@/i18n/config"

type PrivacyMessages = {
  title: string
  introduction: string
  dataControllerLabel: string
  contactLabel: string
  retentionPeriod: string
  recipients: readonly string[]
  sections: readonly {
    heading: string
    paragraphs?: readonly string[]
    items?: readonly string[]
  }[]
  rightsParagraph: string
  rightsRequest: string
  closeLabel: string
}

export const privacyEn: PrivacyMessages = {
  title: "Privacy Notice",
  introduction: "{controller} processes your personal data in connection with the reservation service provided in {country}, as described below.",
  dataControllerLabel: "Business",
  contactLabel: "Contact",
  retentionPeriod: "Reservation and communication records are retained for the applicable retention and limitation periods, then deleted, destroyed, or anonymized.",
  recipients: [
    "The relevant business and authorized employees managing the reservation",
    "Reservation infrastructure and reservation-related communication providers",
    "Authorized public institutions and parties to whom disclosure is legally required",
  ],
  sections: [
    {
      heading: "Information collected",
      items: [
        "Name, phone number, and email address",
        "Restaurant, date, time, party size, area, and reservation type",
        "Special requests and reservation-related transaction records",
      ],
    },
    {
      heading: "How we use it",
      items: [
        "Creating, verifying, and managing the reservation",
        "Communicating reservation status, changes, and cancellations",
        "Evaluating customer requests and operating the service",
        "Meeting applicable legal obligations and managing disputes",
      ],
    },
    {
      heading: "Processing basis",
      paragraphs: ["Data is processed on the legal basis applicable to providing the reservation service, conducting related communication, meeting applicable obligations, and supporting legitimate operational needs."],
    },
    { heading: "Potential recipients" },
    { heading: "Retention period" },
    { heading: "Your rights" },
  ],
  rightsParagraph: "You may request information about your personal data, correction of incomplete or inaccurate data, deletion or destruction where applicable, and exercise other rights available under the applicable privacy laws.",
  rightsRequest: "Requests can be sent by email to {email}.",
  closeLabel: "Close notice",
}

export const privacyTr: PrivacyMessages = {
  title: "Gizlilik Bildirimi",
  introduction: "{controller}, {country} üzerinden verdiğiniz rezervasyon hizmeti kapsamında kişisel verilerinizi aşağıdaki amaçlarla işler.",
  dataControllerLabel: "İşletme",
  contactLabel: "İletişim",
  retentionPeriod: "Rezervasyon ve iletişim kayıtları, ilgili saklama ve zamanaşımı süreleri boyunca tutulur; süre sonunda silinir, yok edilir veya anonimleştirilir.",
  recipients: [
    "Rezervasyonu yöneten ilgili işletme ve yetkili çalışanları",
    "Rezervasyon altyapısı ve rezervasyonla ilgili iletişim hizmeti sağlayıcıları",
    "Yetkili kamu kurum ve kuruluşları ile hukuken aktarım yapılması gereken taraflar",
  ],
  sections: [
    {
      heading: "Toplanan bilgiler",
      items: [
        "Ad, telefon numarası ve e-posta adresi",
        "Restoran, tarih, saat, kişi sayısı, alan ve rezervasyon türü bilgileri",
        "Özel talepler ve rezervasyonla bağlantılı işlem kayıtları",
      ],
    },
    {
      heading: "Kullanım amaçları",
      items: [
        "Rezervasyonun oluşturulması, doğrulanması ve yönetilmesi",
        "Rezervasyon durumu, değişiklikleri ve iptalleri hakkında iletişim kurulması",
        "Müşteri taleplerinin değerlendirilmesi ve hizmet operasyonlarının yürütülmesi",
        "Uygulanabilir yasal yükümlülüklerin yerine getirilmesi ve uyuşmazlıkların yönetilmesi",
      ],
    },
    {
      heading: "İşleme dayanağı",
      paragraphs: ["Veriler, rezervasyon hizmetinin sunulması, iletişimin yürütülmesi, uygulanabilir yükümlülüklerin yerine getirilmesi ve işletmenin meşru operasyonel ihtiyaçları için geçerli olan hukuki dayanaklara göre işlenir."],
    },
    { heading: "Paylaşılabilecek taraflar" },
    { heading: "Saklama süresi" },
    { heading: "Haklarınız" },
  ],
  rightsParagraph: "Kişisel verileriniz hakkında bilgi talep edebilir, eksik veya yanlış verilerin düzeltilmesini, şartları oluştuğunda silinmesini ya da yok edilmesini isteyebilir ve uygulanabilir mevzuat kapsamındaki diğer haklarınızı kullanabilirsiniz.",
  rightsRequest: "Taleplerinizi {email} adresine e-posta göndererek iletebilirsiniz.",
  closeLabel: "Bildirimi kapat",
}

export const privacyEs: PrivacyMessages = {
  title: "Aviso de privacidad",
  introduction: "{controller} trata tus datos personales en relación con el servicio de reservas prestado en {country}, como se describe a continuación.",
  dataControllerLabel: "Empresa",
  contactLabel: "Contacto",
  retentionPeriod: "Los registros de reservas y comunicaciones se conservan durante los plazos de conservación y prescripción aplicables; después se eliminan, destruyen o anonimizan.",
  recipients: [
    "La empresa correspondiente y el personal autorizado que gestiona la reserva",
    "Los proveedores de infraestructura de reservas y de comunicaciones relacionadas con las reservas",
    "Las instituciones públicas autorizadas y las partes a las que la ley exija comunicar la información",
  ],
  sections: [
    {
      heading: "Información recopilada",
      items: [
        "Nombre, número de teléfono y dirección de email",
        "Restaurante, fecha, hora, número de personas, área y tipo de reserva",
        "Solicitudes especiales y registros de transacciones relacionados con la reserva",
      ],
    },
    {
      heading: "Cómo la utilizamos",
      items: [
        "Crear, verificar y gestionar la reserva",
        "Comunicar el estado, los cambios y las cancelaciones de la reserva",
        "Evaluar las solicitudes de los clientes y operar el servicio",
        "Cumplir las obligaciones legales aplicables y gestionar controversias",
      ],
    },
    {
      heading: "Base del tratamiento",
      paragraphs: ["Los datos se tratan sobre la base jurídica aplicable a la prestación del servicio de reservas, las comunicaciones relacionadas, el cumplimiento de las obligaciones aplicables y las necesidades operativas legítimas."],
    },
    { heading: "Posibles destinatarios" },
    { heading: "Plazo de conservación" },
    { heading: "Tus derechos" },
  ],
  rightsParagraph: "Puedes solicitar información sobre tus datos personales, la corrección de datos incompletos o inexactos, su eliminación o destrucción cuando corresponda, así como ejercer los demás derechos previstos por la normativa de privacidad aplicable.",
  rightsRequest: "Puedes enviar tus solicitudes por correo electrónico a {email}.",
  closeLabel: "Cerrar aviso",
}

export const privacyMessages: Record<SupportedLanguage, PrivacyMessages> = { en: privacyEn, tr: privacyTr, es: privacyEs }

export function getPrivacyMessages(language: string | null | undefined) {
  const resolvedLanguage = resolveLanguage(language)
  return { language: resolvedLanguage, locale: getLocaleConfig(resolvedLanguage).intl, messages: privacyMessages[resolvedLanguage] }
}
