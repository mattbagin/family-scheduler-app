/** WMO weather codes (as Open-Meteo reports them) to a picture and a few words. */
const CODES: [number[], string, string, string?][] = [
  [[0], '☀️', 'Clear', '🌙'],
  [[1], '🌤️', 'Mostly sunny', '🌙'],
  [[2], '⛅', 'Partly cloudy', '☁️'],
  [[3], '☁️', 'Cloudy'],
  [[45, 48], '🌫️', 'Foggy'],
  [[51, 53, 55, 56, 57], '🌦️', 'Drizzle'],
  [[61, 63, 80, 81], '🌧️', 'Rain'],
  [[65, 82], '🌧️', 'Heavy rain'],
  [[66, 67], '🧊', 'Freezing rain'],
  [[71, 73, 77, 85], '🌨️', 'Snow'],
  [[75, 86], '❄️', 'Heavy snow'],
  [[95, 96, 99], '⛈️', 'Thunderstorms'],
];

export function weatherLook(code: number, isDay = true): { icon: string; text: string } {
  const hit = CODES.find(([codes]) => codes.includes(code));
  if (!hit) return { icon: '🌡️', text: 'Weather' };
  return { icon: !isDay && hit[3] ? hit[3] : hit[1], text: hit[2] };
}
