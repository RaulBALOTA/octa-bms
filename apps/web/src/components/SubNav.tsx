import { NavLink } from 'react-router-dom';
import clsx from 'clsx';

/** Second-level navigation inside a module (e.g. HR: Employees | Leave). */
export function SubNav({
  items,
}: {
  items: { label: string; to: string; badge?: number }[];
}) {
  return (
    <div className="mb-4 flex gap-1 border-b border-border">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end
          className={({ isActive }) =>
            clsx(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
              isActive
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )
          }
        >
          {item.label}
          {item.badge !== undefined && item.badge > 0 && (
            <span className="ml-1.5 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-white">
              {item.badge}
            </span>
          )}
        </NavLink>
      ))}
    </div>
  );
}
