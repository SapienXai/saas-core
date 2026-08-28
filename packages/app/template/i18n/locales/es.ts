import { en } from "@/i18n/locales/en"

type Localized<T> = T extends string ? string : T extends object ? { [K in keyof T]: Localized<T[K]> } : T

const spanishTranslations: Record<string, string> = {
  "Close": "Cerrar", "Please enter a valid email address.": "Introduce una dirección de correo electrónico válida.", "Loading…": "Cargando…", "Updating…": "Actualizando…", "Next": "Siguiente", "Previous": "Anterior", "Language": "Idioma",
  "Already have an account?": "¿Ya tienes una cuenta?", "Back to sign in": "Volver a iniciar sesión", "Check your inbox": "Revisa tu bandeja de entrada",
  "Create an account": "Crear una cuenta", "Email": "Correo electrónico", "Forgot password?": "¿Has olvidado tu contraseña?", "Password": "Contraseña", "Sign in": "Iniciar sesión",
  "Create your account": "Crea tu cuenta", "Create account": "Crear cuenta", "Welcome back": "Te damos la bienvenida", "Workspace": "Espacio de trabajo",
  "Workspace management": "Gestión del espacio de trabajo", "Create workspace": "Crear espacio de trabajo", "Current workspace": "Espacio de trabajo actual",
  "Workspace created successfully. The public address was already in use, so we used “{slug}”.": "El espacio de trabajo se ha creado correctamente. La dirección pública ya estaba en uso, así que hemos utilizado «{slug}».",
  "Paddle {environment} price mapping is not configured for {plan}.": "La correspondencia de precios de Paddle para {environment} no está configurada para {plan}.",
  "Connected workspaces": "Espacios de trabajo conectados", "Keep teams, settings, and activity in one place.": "Mantén equipos, ajustes y actividad en un solo lugar.",
  "Ready for your workflow": "Listo para tu forma de trabajar", "Bring the tools your team uses into one calm workspace.": "Reúne las herramientas de tu equipo en un espacio de trabajo tranquilo.",
  "One place to manage it all": "Un solo lugar para gestionarlo todo", "Plan, team, settings, and activity in one workspace.": "Plan, equipo, ajustes y actividad en un solo espacio de trabajo.",
  "Ready for your team.": "Listo para tu equipo.", "Your workspace, managed in one place.": "Tu espacio de trabajo, gestionado en un solo lugar.", "SAAS CORE · BUILT FOR TEAMS": "SAAS CORE · CREADO PARA EQUIPOS",
  "A CALMER WAY TO WORK": "UNA FORMA MÁS TRANQUILA DE TRABAJAR", "SaaS Core home": "Inicio de SaaS Core", "New to SaaS Core?": "¿Es tu primera vez en SaaS Core?",
  "Sign in to your SaaS Core account.": "Inicia sesión en tu cuenta de SaaS Core.", "Start managing your workspace in one place.": "Empieza a gestionar tu espacio de trabajo en un solo lugar.",
  "Set a new password for your SaaS Core account.": "Establece una nueva contraseña para tu cuenta de SaaS Core.", "Team members": "Miembros del equipo", "Workspaces": "Espacios de trabajo",
  "Usage this period": "Uso de este periodo", "Usage / period": "Uso / periodo", "Plan preview": "Vista previa del plan", "Active plan": "Plan activo", "Base plan": "Plan base",
  "Notifications": "Notificaciones", "Enable notifications": "Activar notificaciones", "Disable notifications": "Desactivar notificaciones", "Management App": "Aplicación de gestión", "Install App": "Instalar aplicación", "Save branding": "Guardar marca",
  "Accept invitation": "Aceptar invitación", "Join {workspace}": "Unirse a {workspace}", "Joining…": "Uniéndose…", "workspace access": "acceso al espacio de trabajo",
  "Billing details": "Datos de facturación", "Billing cycle": "Ciclo de facturación", "Monthly": "Mensual", "Annual": "Anual", "Change plan": "Cambiar de plan", "Upgrade your plan": "Mejorar tu plan", "Manage billing": "Gestionar facturación", "Payment method": "Método de pago", "Invoices": "Facturas",
  "Remove platform branding": "Eliminar la marca de la plataforma", "Activity history": "Historial de actividad", "Branded management app": "Aplicación de gestión con marca", "Multi-workspace management": "Gestión de varios espacios de trabajo",
  "Get more capacity and control as your workspace grows.": "Obtén más capacidad y control a medida que crece tu espacio de trabajo.", "More usage headroom": "Más margen de uso", "More activity context": "Más contexto de actividad", "More team control": "Más control del equipo",
  "The first professional upgrade.": "La primera mejora profesional.", "Add your own domain, bring in a small team, and keep more activity history.": "Añade tu propio dominio, incorpora un equipo pequeño y conserva más historial de actividad.", "For teams that need more control.": "Para equipos que necesitan más control.", "Go further with richer reports, longer history, and a branded management app.": "Avanza con informes más completos, un historial más largo y una aplicación de gestión con marca.", "A clear workspace for growing teams.": "Un espacio de trabajo claro para equipos en crecimiento.", "Run multiple workspaces with one team, shared controls, and advanced reporting.": "Gestiona varios espacios de trabajo con un equipo, controles compartidos e informes avanzados.",
  "Welcome to {plan}": "Te damos la bienvenida a {plan}", "You've upgraded to {plan}": "Has cambiado al plan {plan}", "Downgrade scheduled to {plan}": "Cambio al plan {plan} programado", "Your billing is updated": "Tu facturación se ha actualizado", "Continue to your workspace": "Continuar a tu espacio de trabajo",
}

function localize<T>(value: T): Localized<T> {
  if (typeof value === "string") return (spanishTranslations[value] ?? value) as Localized<T>
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, localize(child)])) as Localized<T>
  return value as Localized<T>
}

export const es = localize(en)
