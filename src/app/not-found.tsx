import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { PageTitle } from '@/components/PageTitle';
import { EmptyState } from '@/components/EmptyState';

export default function NotFound() {
  return (
    <AppShell>
      <PageTitle title="Page not found" />
      <div className="flex-1 overflow-auto">
        <div className="page-container">
          <EmptyState
            as="h1"
            title="This page doesn’t exist"
            body="The link may be old, or the page was moved."
            actions={<>
              <Link href="/runs" className="btn btn-primary">Go to print runs</Link>
              <Link href="/designer" className="btn btn-secondary">Designs</Link>
            </>}
          />
        </div>
      </div>
    </AppShell>
  );
}
