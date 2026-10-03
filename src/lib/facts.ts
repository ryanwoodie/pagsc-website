// Typed access to content/club-facts.yaml, the single source of truth for every fact.
// Every object is strict: a missing, extra or misspelled key fails the build.
import { z } from 'astro/zod';
import { parse } from 'yaml';
import raw from '../../content/club-facts.yaml?raw';

const url = z.url();
const price = z.number().nonnegative();

const membership = z.strictObject({ price: price, per: z.string(), who: z.string() });

const schema = z
  .strictObject({
    club: z.strictObject({
      name: z.string(),
      short_name: z.string(),
      founded: z.number().int(),
      status: z.string(),
      affiliations: z.array(z.string()).min(1),
    }),
    location: z.strictObject({
      airfield: z.string(),
      town: z.string(),
      highway: z.string(),
      drive_times: z.strictObject({ prince_albert: z.string(), saskatoon: z.string() }),
      distance_note: z.string(),
      carpool_from: z.array(z.string()).min(1),
    }),
    contact: z.strictObject({
      email: z.email(),
      phone: z.string().regex(/^\(\d{3}\) \d{3}-\d{4}$/),
      facebook: url,
      instagram: url,
      whatsapp_group: z.null(),
    }),
    links: z.strictObject({
      flying_schedule: url,
      membership_form: url,
      discovery_flight_payment: url,
      soar_manual_pdf: url,
      ground_school: url,
      winch_launch_videos: url,
      glider_flying_handbook: url,
      sac_youth_bursary: url,
      birch_hills_weather: url,
      cypa_forecast: url,
    }),
    discovery_flight: z.strictObject({
      price: price,
      group_price_each: price,
      group_minimum: z.number().int().positive(),
      duration_minutes: z.string(),
      launch: z.string(),
      launch_height_feet_min: z.number().int().positive(),
      launch_height_feet: z.number().int().positive(),
      max_weight_lbs: z.number().int().positive(),
      membership_required: z.boolean(),
      experience_required: z.boolean(),
      when: z.string(),
      weekdays: z.string(),
      season: z.string(),
      weather_cancellation: z.string(),
      bring: z.array(z.string()).min(1),
      day: z.array(z.string()).min(1),
    }),
    fees: z.strictObject({
      membership: z.strictObject({ regular: membership, junior: membership, youth_air_cadet: membership }),
      membership_notes: z.array(z.string()),
      winch_launch: price,
      glider_rental_per_hour: price,
      glider_rental_per_minute: price,
      instruction: price,
      typical_lesson_flight: z.strictObject({ minutes: z.number().positive(), cost: price, breakdown: z.string() }),
      payment: z.string(),
      guest_payment: z.string(),
    }),
    training: z.strictObject({
      start_age: z.union([z.literal('none'), z.number()]),
      solo_age: z.number().int(),
      licence_age: z.number().int(),
      who_can_learn: z.array(z.string()),
      steps: z.array(z.strictObject({ title: z.string(), text: z.string() })).length(5),
      come_regularly: z.string(),
    }),
    youth: z.strictObject({
      membership_price: price,
      bursary_sac: price,
      bursary_club_match: price,
      bursary_total: price,
      bursary_covers: z.string(),
      bursary_who: z.string(),
      bursaries_per_club: z.number().int().positive(),
      cadets: z.string(),
    }),
    power_pilots: z.strictObject({
      summary: z.string(),
      table: z.array(z.strictObject({ requirement: z.string(), from_scratch: z.string(), with_ppl: z.string() })),
      credit_back: z.strictObject({
        ppl_hours: z.number(),
        cpl_hours: z.number(),
        cpl_total_requirement_hours: z.number(),
      }),
    }),
    achievements: z.strictObject({
      longest_cross_country_km: z.number(),
      long_flight_hours: z.number(),
      world_distance_record_km: z.number(),
    }),
    badges: z.array(z.strictObject({ name: z.string(), detail: z.string() })).length(3),
    fleet: z
      .array(
        z.strictObject({
          name: z.string(),
          role: z.string(),
          description: z.string(),
          seats: z.number().int(),
          wingspan_m: z.number(),
          best_glide: z.string().regex(/^\d+:1$/),
          min_sink_ms: z.number(),
          empty_weight_kg: z.number(),
          introduced: z.number().int(),
        }),
      )
      .length(3),
  })
  // Figures that are stated twice in the file must agree.
  .refine((f) => f.youth.bursary_total === f.youth.bursary_sac + f.youth.bursary_club_match, {
    message: 'youth.bursary_total must equal bursary_sac + bursary_club_match',
  })
  .refine((f) => f.youth.membership_price === f.fees.membership.youth_air_cadet.price, {
    message: 'youth.membership_price must equal fees.membership.youth_air_cadet.price',
  })
  .refine((f) => Math.abs(f.fees.glider_rental_per_hour / 60 - f.fees.glider_rental_per_minute) < 0.001, {
    message: 'glider_rental_per_minute must be glider_rental_per_hour / 60',
  })
  .refine(
    (f) =>
      f.fees.typical_lesson_flight.cost ===
      f.fees.winch_launch + f.fees.typical_lesson_flight.minutes * f.fees.glider_rental_per_minute,
    { message: 'typical_lesson_flight.cost must equal one launch plus its minutes of glider time' },
  );

const result = schema.safeParse(parse(raw));
if (!result.success) {
  throw new Error(`content/club-facts.yaml is invalid:\n${z.prettifyError(result.error)}`);
}

export const facts = result.data;
export type Facts = typeof facts;

// ---- Formatting helpers. Pages format figures through these, never by hand. ----

/** $50, $0.50, $1,000 */
export function money(n: number): string {
  const whole = Number.isInteger(n);
  return '$' + n.toLocaleString('en-CA', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

/** 2,000 */
export function num(n: number): string {
  return n.toLocaleString('en-CA');
}

/** "Weekends and holidays" -> "weekends and holidays" */
export function lcfirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Discovery Flight facts */
export const df = facts.discovery_flight;
export const fees = facts.fees;

/** Glider time for the typical lesson flight, in dollars */
export const lessonGliderCost = fees.typical_lesson_flight.minutes * fees.glider_rental_per_minute;

/** "a $5 launch plus $5 of glider time" */
export const lessonBreakdown = `a ${money(fees.winch_launch)} launch plus ${money(lessonGliderCost)} of glider time`;

/** "25 minutes" -> "25 min" for tiles */
export function shortDuration(s: string): string {
  return s.replace(/\bminutes?\b/, 'min');
}

/** "1,500 to 2,000 feet" */
export const launchHeight = `${num(df.launch_height_feet_min)} to ${num(df.launch_height_feet)} feet`;

/** tel: link for the club phone */
export const telHref = 'tel:+1' + facts.contact.phone.replace(/\D/g, '');

/** Facebook page handle for display, e.g. PAGSC.Saskatchewan */
export const facebookHandle = new URL(facts.contact.facebook).pathname.replace(/\//g, '');

/** Instagram handle for display, e.g. pa.gliding */
export const instagramHandle = new URL(facts.contact.instagram).pathname.replace(/\//g, '');

/** "A, B and C" */
export function listJoin(items: string[]): string {
  if (items.length < 2) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

/** Google Maps search link for the airfield */
export const mapHref =
  'https://www.google.com/maps/search/?api=1&query=' +
  encodeURIComponent(`${facts.location.airfield}, ${facts.location.town}`);

/** Google Maps directions from a town to the airfield */
export function directionsHref(from: string): string {
  return (
    'https://www.google.com/maps/dir/?api=1&origin=' +
    encodeURIComponent(`${from}, Saskatchewan`) +
    '&destination=' +
    encodeURIComponent(`${facts.location.airfield}, ${facts.location.town}`)
  );
}

/** Embeddable map of the airfield (loaded only when the visitor asks for it) */
export const mapEmbedSrc =
  'https://www.google.com/maps?output=embed&q=' +
  encodeURIComponent(`${facts.location.airfield}, ${facts.location.town}`);
