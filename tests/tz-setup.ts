// Devvit's runtime clock is UTC; run the tests the same way so date handling can't pass by accident on a US machine.
export default async function setup() {
  process.env.TZ = 'UTC';
}
