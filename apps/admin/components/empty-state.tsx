import Link from 'next/link';

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">⌕</span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action && (
        <Link className="button button-primary" href={action.href}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
