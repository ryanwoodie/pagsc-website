// Questions and answers from content/pages/faq.md, with every figure bound to club-facts.yaml.
import { href } from './url';
import { facts, df, fees, money, lcfirst, lessonBreakdown, listJoin, launchHeight, soloLine } from './facts';

const t = facts.training;
const groundSchool = t.steps[2]!;

/** "Weekends and holidays, about 11 am to 5 pm for guest flights, weather permitting" */
export const guestHours = df.when.replace(/(\bpm\b)/, '$1 for guest flights');

/** "Some weekdays too, often on request" as a sentence */
export const weekdaysLine = `${df.weekdays}.`;

export type QA = { id: string; q: string; a: string };

const pilottraining = `<a href="${facts.links.ground_school}" rel="noopener">${new URL(facts.links.ground_school).host}</a>`;

export const firstFlights: QA[] = [
  {
    id: 'join-first',
    q: 'Do I have to join before my first flight?',
    a: `No. Try a ${money(df.price)} Discovery Flight first and join only if you love it.`,
  },
  {
    id: 'experience-gear',
    q: 'Do I need experience or my own gear?',
    a: 'No. The club provides the glider, the winch and free instruction.',
  },
  {
    id: 'safe',
    q: 'Is it safe to just try once?',
    a: "An experienced club pilot or instructor is in command. Gliding carries risk similar to other small-aircraft flying, and safety is the club's first priority.",
  },
  {
    id: 'how-long',
    q: 'How long is the flight?',
    a: `About ${df.duration_minutes} minutes, depending on the day's conditions. The winch launch takes you to about ${launchHeight}.`,
  },
  {
    id: 'weight',
    q: 'Is there a weight limit?',
    a: `Yes. The maximum weight for an introductory flight is ${df.max_weight_lbs} lbs.`,
  },
  {
    id: 'weather',
    q: 'What if the weather cancels my day?',
    a: "It happens. We rebook you at no charge, and a flight you've paid for carries over to the new date.",
  },
  {
    id: 'bring',
    q: 'What should I bring?',
    a: `A hat, sunscreen and sunglasses; water and lunch or snacks; layers, because it is cooler at altitude; and, if you haven't paid online, a way to pay (${fees.guest_payment.toLowerCase()}).`,
  },
  {
    id: 'expiry',
    q: 'Do prepaid or gift flights expire?',
    a: "No. A flight you've paid for never expires and can be rebooked at no charge. If you need a refund, just ask.",
  },
  {
    id: 'gift',
    q: 'Can I give a flight as a gift?',
    a: `Yes. <a href="${facts.links.discovery_flight_payment}" rel="noopener">Buy a Discovery Flight online</a> and we email you a printable certificate with its own code. The person flying books their date with the code on the <a href="${href('/discovery-flight/#request')}">booking calendar</a>, or by email.`,
  },
  {
    id: 'when',
    q: 'When do you fly?',
    a: `${guestHours}. ${weekdaysLine} The main season runs ${lcfirst(df.season)}.`,
  },
];

export const learning: QA[] = [
  {
    id: 'age',
    q: 'How old do I have to be?',
    a: `There is no minimum age to start training. You can fly solo at ${t.solo_age} and hold a full Glider Pilot Licence at ${t.licence_age}. Students need to reach the controls comfortably (roughly 5 ft tall) and be ready to learn (typically 12 and up).`,
  },
  {
    id: 'lesson-cost',
    q: 'What does a lesson cost?',
    a: `About ${money(fees.typical_lesson_flight.cost)} for a typical ${fees.typical_lesson_flight.minutes}-minute instructional flight for members: ${lessonBreakdown}. Instruction is free.`,
  },
  {
    id: 'flights-to-solo',
    q: 'How long does it take to go solo?',
    a: `${soloLine} The licence itself needs ${row('Solo flights').from_scratch} solo flights.`,
  },
  {
    id: 'medical',
    q: 'Do I need a medical?',
    a: "Most students use a Category 4 medical, a self-declaration with no doctor's visit. Do it early in training. A Category 1 or 3 medical also counts.",
  },
  {
    id: 'ground-school',
    q: 'Is there ground school?',
    a: `Yes: ${groundSchool.text.replace(/^(\d+ hours), self-directed or with pilottraining\.ca, then (Transport Canada's GLIDE written exam).*$/, `$1, self-directed or with ${pilottraining}, followed by $2.`)}`,
  },
  {
    id: 'how-often',
    q: 'How often should I come?',
    a: `As regularly as you can. ${t.come_regularly}`,
  },
  {
    id: 'pilot-licence',
    q: 'I already have a pilot licence. What carries over?',
    a: `With a PPL(A), ground school and the written exam are waived and you need ${ppl('Total flight time')}, not ${scratch('Total flight time')}. <a href="${href('/learn-to-fly/power-pilots/')}">More for power pilots</a>`,
  },
];

function row(requirement: string) {
  const r = facts.power_pilots.table.find((x) => x.requirement === requirement);
  if (!r) throw new Error(`power_pilots.table has no "${requirement}" row`);
  return r;
}
function ppl(requirement: string) {
  return row(requirement).with_ppl.replace(/hours?/, (h) => (h === 'hours' ? 'flight hours' : 'flight hour'));
}
function scratch(requirement: string) {
  return row(requirement).from_scratch.replace(/ hours?/, '');
}
export { ppl as pplHours, scratch as scratchHours };

/** The four used on the home page: joining first, safety, weather, what to bring. */
export const homeQuestions = ['join-first', 'safe', 'weather', 'bring'].map(
  (id) => firstFlights.find((x) => x.id === id)!,
);

/** "Before a first flight" on the Discovery Flight page (wording from discovery-flight.md). */
export const beforeFirstFlight: QA[] = [
  { ...firstFlights.find((x) => x.id === 'join-first')!, q: 'Do I have to join first?', id: 'df-join-first' },
  { ...firstFlights.find((x) => x.id === 'safe')!, id: 'df-safe' },
  { ...firstFlights.find((x) => x.id === 'weather')!, id: 'df-weather' },
  {
    id: 'df-gear',
    q: 'Do I need my own gear?',
    a: 'No. The club provides the glider, the winch and free instruction.',
  },
];

export const carpool = listJoin(facts.location.carpool_from);
