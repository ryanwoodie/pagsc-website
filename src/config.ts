// Site settings that are not club facts. Club facts live in content/club-facts.yaml.

/**
 * The Google Apps Script web app that receives flight requests (apps-script/).
 * Ryan deploys it under the club's Google account and pastes its /exec URL here.
 * While empty, the form falls back to opening an email to the club, and the
 * page shows a [NEEDED] marker so the site is not launched this way.
 */
export const FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyKwvFK2BaFayMuv8GwQkr3f8JUTUv3GzGJbgGw6CsN4OjaUrSnPtYXeVE43X0cc-cCTA/exec';

/**
 * The welcome pack PDF, once exported, goes in public/welcome-pack.pdf.
 * Set to true when the file is there.
 */
export const WELCOME_PACK_READY = false;
