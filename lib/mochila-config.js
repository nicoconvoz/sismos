// Configuration for the "Mochila de Emergencia" lead form forwarding.
//
// Submissions POSTed to /api/mochila are forwarded server-side to the Google
// Form "Mochila de Emergencia" (invisible to the visitor), so responses land
// in the owner's Google account with its native email notifications.
//
// The entry.N ids below were extracted from the live form's
// FB_PUBLIC_LOAD_DATA_ blob (2026-08-28) and match its questions one-to-one.
// If the form's questions are ever removed and re-created, their ids change
// and must be re-extracted; while any value is null, /api/mochila answers
// 503 not_configured and the frontend tells the visitor the form will be
// available soon.

export const mochilaConfig = {
  formResponseUrl:
    'https://docs.google.com/forms/d/e/1FAIpQLSd4WRhZYSs23pc0DcNWcnVC7Ock0egmLbyzL5YtlD9yHZ11MA/formResponse',
  fields: {
    nombre: 'entry.1744273040',
    edad: 'entry.1279108321',
    sexo: 'entry.81745726',
    fechaNacimiento: 'entry.1552233435',
    dni: 'entry.1287333651',
    telefono: 'entry.1728398379',
    localidad: 'entry.604240819',
    provincia: 'entry.609144006',
    direccion: 'entry.2076082258',
    email: 'entry.1476371417'
  }
};

/** True when the response URL and every field id are filled in. */
export function isConfigured(config = mochilaConfig) {
  return Boolean(
    config.formResponseUrl && Object.values(config.fields).every((id) => Boolean(id))
  );
}
