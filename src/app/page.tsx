import { redirect } from 'next/navigation';

// Root now routes to Runs (the day-to-day "do work" surface). Formats
// moved to /formats; Designer stays at /designer.
export default function Home() {
  redirect('/runs');
}
