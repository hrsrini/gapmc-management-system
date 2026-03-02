import { useState, useRef, useEffect } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Bell, LogOut, ChevronRight, User, RotateCcw } from 'lucide-react';
import type { ActivityLog } from '@shared/schema';

const NOTIFICATIONS_READ_KEY = 'gapmc_notifications_read_before';

function getReadBefore(): number {
  try {
    const s = sessionStorage.getItem(NOTIFICATIONS_READ_KEY);
    return s ? parseInt(s, 10) : 0;
  } catch {
    return 0;
  }
}

function setReadBeforeStorage(ts: number): void {
  try {
    sessionStorage.setItem(NOTIFICATIONS_READ_KEY, String(ts));
  } catch {}
}

interface AppHeaderProps {
  breadcrumbs?: { label: string; href?: string }[];
}

export function AppHeader({ breadcrumbs = [] }: AppHeaderProps) {
  const { user, logout } = useAuth();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const readBeforeRef = useRef(getReadBefore());
  const [, setNotifyUpdate] = useState(0);

  const { data: notifications = [] } = useQuery<ActivityLog[]>({
    queryKey: ['/api/activity'],
  });
  const recentNotifications = notifications.slice(0, 5);
  const latestTimestamp =
    recentNotifications.length > 0 && recentNotifications[0].timestamp
      ? new Date(recentNotifications[0].timestamp).getTime()
      : 0;
  const hasUnread = latestTimestamp > readBeforeRef.current;

  // When dropdown opens, mark current notifications as read and re-render
  useEffect(() => {
    if (notificationsOpen) {
      const readBefore = Math.max(latestTimestamp, Date.now());
      setReadBeforeStorage(readBefore);
      readBeforeRef.current = readBefore;
      setNotifyUpdate((n) => n + 1);
    }
  }, [notificationsOpen, latestTimestamp]);

  const markAllAsUnread = () => {
    setReadBeforeStorage(0);
    readBeforeRef.current = 0;
    setNotifyUpdate((n) => n + 1);
    setNotificationsOpen(false);
  };

  return (
    <header className="flex items-center justify-between h-16 px-4 border-b bg-card">
      <div className="flex items-center gap-4">
        <SidebarTrigger data-testid="button-sidebar-toggle" />
        <nav className="flex items-center gap-1 text-sm">
          {breadcrumbs.map((crumb, index) => (
            <div key={index} className="flex items-center gap-1">
              {index > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              {crumb.href ? (
                <Link href={crumb.href} className="text-muted-foreground hover:text-foreground">
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-foreground font-medium">{crumb.label}</span>
              )}
            </div>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <DropdownMenu open={notificationsOpen} onOpenChange={setNotificationsOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" data-testid="button-notifications" aria-label="Notifications">
              <Bell className="h-5 w-5" />
              {hasUnread && (
                <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive" aria-hidden />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            {recentNotifications.length > 0 && (
              <>
                <DropdownMenuItem
                  onClick={markAllAsUnread}
                  className="cursor-pointer text-muted-foreground"
                  data-testid="menu-mark-all-unread"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Mark all as unread
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {recentNotifications.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No new notifications
              </div>
            ) : (
              recentNotifications.map((log) => (
                <DropdownMenuItem key={log.id} className="flex flex-col items-start gap-0.5 py-3 cursor-default">
                  <span className="font-medium text-sm">{log.action}</span>
                  <span className="text-xs text-muted-foreground">{log.module} · {log.user}</span>
                  <span className="text-xs text-muted-foreground">
                    {log.timestamp ? new Date(log.timestamp).toLocaleString() : ''}
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2" data-testid="button-user-menu">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                  SA
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium hidden sm:inline-block">
                {user?.name || 'Super Admin'}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid="menu-profile">
              <User className="h-4 w-4 mr-2" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-destructive" data-testid="menu-logout">
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
