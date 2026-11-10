import { AppShell } from '@/components/AppShell';
import { PageTitle } from '@/components/PageTitle';
import { PageState, StateActions } from '@/components/EmptyState';

export default function NotFound() {
  return (
    <AppShell>
      <PageTitle title="Page not found" />
      <PageState
        title="This page doesn’t exist"
        body="The link may be old, or the page was moved."
        actions={<StateActions back={{ href: '/runs', label: 'Go to Runs' }} />}
      />
    </AppShell>
  );
}
