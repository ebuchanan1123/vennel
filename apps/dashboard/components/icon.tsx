import type { SVGProps } from 'react';

const paths = {
  note: 'M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5',
  calendar: 'M3 5h18v16H3z M7 3v4 M17 3v4 M3 10h18 M7 14h2 M13 14h2 M7 18h2',
  mic: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8',
  stop: 'M5 5h14v14H5z',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  leads:
    'M21 8v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8 M3 8l9 6 9-6 M6 5h12a3 3 0 0 1 3 3H3a3 3 0 0 1 3-3',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  services: 'M3 7l9-4 9 4-9 4-9-4z M3 12l9 4 9-4 M3 17l9 4 9-4',
  document:
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z M14 2v6h6 M8 13h8 M8 17h5',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  chevron: 'M9 5l7 7-7 7',
  plus: 'M12 5v14 M5 12h14',
  search: 'M21 21l-5-5 M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13',
  sparkles: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3z M20 2v4 M18 4h4',
  check: 'M5 12l4 4L19 6',
  clock: 'M12 8v4l3 2 M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20',
  trend: 'M3 17l6-6 4 4 8-10 M15 5h6v6',
  money: 'M12 2v20 M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  alert:
    'M12 8v4 M12 16h.01 M10.3 3.9L1.8 18.1A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0z',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  close: 'M6 6l12 12 M6 18L18 6',
  phone:
    'M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7l.5 2.8a2 2 0 0 1-.6 2.1L8.7 11a16 16 0 0 0 4.3 4.3l1.4-1.3a2 2 0 0 1 2.1-.6l2.8.5a2 2 0 0 1 1.7 2z',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  print:
    'M6 9V3h12v6 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z M18 12h.01',
  edit: 'M12 20H4v-8 M16 3l5 5-11 11-5 1 1-5L16 3z',
  trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  link: 'M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
