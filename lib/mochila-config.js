// Configuration for the "Mochila de Emergencia" lead form forwarding.
//
// Submissions POSTed to /api/mochila are forwarded server-side to the Google
// Form "Mochila de Emergencia" (invisible to the visitor), so responses land
// in the owner's Google account with its native email notifications.
//
// The entry.N ids were extracted from the live form's FB_PUBLIC_LOAD_DATA_
// blob (2026-08-28). The form was originally created with ten questions and
// later reduced to six: Google keeps entry ids STABLE across question
// RENAMES, so two ids are deliberately reused under new meanings —
// entry.1279108321 (was "Edad") now carries "Apellido", and entry.604240819
// (was "Localidad") now carries "País"; the owner renames those questions in
// the Google Form to match. Ids only change if a question is deleted and
// re-created, in which case they must be re-extracted. The ids of the four
// dropped questions (sexo/fechaNacimiento/dni/direccion) are simply no
// longer sent. While any value here is null, /api/mochila answers 503
// not_configured and the frontend tells the visitor the form will be
// available soon.

export const mochilaConfig = {
  formResponseUrl:
    'https://docs.google.com/forms/d/e/1FAIpQLSd4WRhZYSs23pc0DcNWcnVC7Ock0egmLbyzL5YtlD9yHZ11MA/formResponse',
  fields: {
    nombre: 'entry.1744273040',
    apellido: 'entry.1279108321', // reused id — question being renamed from "Edad"
    pais: 'entry.604240819', // reused id — question being renamed from "Localidad"
    provincia: 'entry.609144006',
    telefono: 'entry.1728398379',
    email: 'entry.1476371417'
  }
};

/** True when the response URL and every field id are filled in. */
export function isConfigured(config = mochilaConfig) {
  return Boolean(
    config.formResponseUrl && Object.values(config.fields).every((id) => Boolean(id))
  );
}
