import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';
import { BugReportFab } from '@/components/BugReportFab';
import { PageBackButton } from '@/components/PageBackButton';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';

interface AppShellProps {
  children: React.ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  /** Hide the global Back control (rare; e.g. embedded/print layouts). */
  hideBackButton?: boolean;
}

export function AppShell({ children, breadcrumbs = [], hideBackButton = false }: AppShellProps) {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "4rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <SidebarInset className="flex flex-col flex-1 overflow-hidden">
          <AppHeader breadcrumbs={breadcrumbs} />
          <main className="flex-1 overflow-auto p-6 bg-background">
            {!hideBackButton ? (
              <div className="mb-4 flex items-center justify-start">
                <PageBackButton />
              </div>
            ) : null}
            {children}
          </main>
          <BugReportFab />
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
