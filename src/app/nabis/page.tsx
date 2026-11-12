import { redirect } from 'next/navigation';

// The Nabis label page was retired: those labels are made from designs now.
// Old bookmarks land on New run, where Nabis search still fills a design.
export default function NabisPage() {
  redirect('/runs/new');
}
